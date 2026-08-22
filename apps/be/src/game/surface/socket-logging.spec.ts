import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Logger, LogLevel, provide } from '@dunx/core';
import { HttpError, HttpStatusCode } from '@dunx/http';
import {
  createTestServer,
  RecordingLogger,
  type RecordedLog,
  type TestServer,
} from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { EnvConfig } from '../../config/env.validation.js';
import { AppHttpOptions } from '../../http.options.js';
import {
  dropTestNamespaces,
  testNamespace,
} from '../../test-support/namespace.js';
import { BetActionsService } from './bet-actions.service.js';

/**
 * The socket's observability, against a real `Bun.serve` and a real `WebSocket`. A
 * spec rather than a unit test because none of it is the app's code: what was in
 * doubt is whether a throwing handler still escapes to `console.error`, and a fake
 * socket could only prove the shape of the entry.
 */
let server: TestServer;
let logger: RecordingLogger;
let consoleErrors: unknown[][];
const originalConsoleError = console.error;

/** Distinctive, so "is any of this in a log line?" is one substring search. */
const CHAT_TEXT = 'lobby-secret-9c2f';
const BET_AMOUNT = 424_242;

const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  QUEUE_CONSUME: 'false',
  THROTTLE_LIMIT: '10000',
  ...testNamespace(),
};

/**
 * Both money handlers throw, on both channels: `place` is awaited by an `async`
 * handler and `cashOut` is called by a synchronous one, and `observe` reports the
 * two differently.
 */
const broken = {
  place: () => {
    throw new Error('redis is gone');
  },
  cashOut: () => {
    throw new HttpError(HttpStatusCode.BAD_REQUEST, 'no such round');
  },
} as unknown as BetActionsService;

const fields = (record: RecordedLog): Record<string, unknown> =>
  record.params[0] as Record<string, unknown>;

const at = (level: LogLevel, event: string): RecordedLog[] =>
  logger.at(level).filter((record) => fields(record)?.['event'] === event);

const waitFor = async <T>(
  get: () => T | undefined,
  what: string,
): Promise<T> => {
  for (let attempt = 0; attempt < 300; attempt++) {
    const value = get();
    if (value !== undefined) return value;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const connect = async (): Promise<WebSocket> => {
  const url = `${server.url.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('refused')), {
      once: true,
    });
  });
  return socket;
};

const frame = (socket: WebSocket, event: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event}`)), 5000);
    const listener = (message: MessageEvent): void => {
      if (
        (JSON.parse(String(message.data)) as { event: string }).event !== event
      ) {
        return;
      }
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      resolve();
    };
    socket.addEventListener('message', listener);
  });

const send = (socket: WebSocket, event: string, data: unknown): void => {
  socket.send(JSON.stringify({ event, data }));
};

beforeAll(async () => {
  logger = new RecordingLogger();
  server = await createTestServer({
    modules: [AppModule.forRoot({ source })],
    prefix: 'api',
    ...AppHttpOptions.for(EnvConfig.validate(source)),
    requestLogging: false,
    overrides: [
      provide(Logger, { useValue: logger }),
      provide(BetActionsService, { useValue: broken }),
    ],
  });
  console.error = (...args: unknown[]): void => {
    consoleErrors.push(args);
  };
});

afterAll(async () => {
  console.error = originalConsoleError;
  await server.close();
  await dropTestNamespaces();
});

beforeEach(() => {
  logger.clear();
  consoleErrors = [];
});

describe('the socket writes a request log of its own', () => {
  test('a connect, a handled frame and a disconnect share one connection id', async () => {
    const socket = await connect();

    const opened = await waitFor(
      () => at(LogLevel.DEBUG, 'connect')[0],
      'connect',
    );
    const connectionId = fields(opened)['connectionId'];
    expect(connectionId).toBeString();
    expect(fields(opened)['path']).toBe('/ws');

    const acked = frame(socket, 'chatAck');
    send(socket, 'chatMessage', CHAT_TEXT);
    await acked;

    const handled = await waitFor(
      () => at(LogLevel.DEBUG, 'chatMessage')[0],
      'the chatMessage entry',
    );
    expect(handled.message).toBe('/ws chatMessage');
    expect(fields(handled)['connectionId']).toBe(connectionId);
    expect(fields(handled)['gateway']).toBe('GameGateway');

    socket.close();
    const closed = await waitFor(
      () => at(LogLevel.DEBUG, 'disconnect')[0],
      'disconnect',
    );
    expect(fields(closed)['connectionId']).toBe(connectionId);

    // Nothing was promoted: the whole connection is debug.
    expect(logger.at(LogLevel.INFO)).toBeEmpty();
    expect(logger.at(LogLevel.WARN)).toBeEmpty();
    expect(logger.at(LogLevel.ERROR)).toBeEmpty();
  });

  /**
   * The tick is published ten times a second per socket. Nothing routes it inbound,
   * so a client that sent one would otherwise reach the unclaimed-frame entry -
   * which is the line `events: { gameTick: false }` exists to stop.
   */
  test('gameTick is logged nowhere, at any level', async () => {
    const socket = await connect();
    await waitFor(() => at(LogLevel.DEBUG, 'connect')[0], 'connect');

    send(socket, 'gameTick', { multiplierX100: 150 });
    // A fence: frames on one socket are dispatched in order, so an ack for the
    // second means the first has already been through the chain.
    const acked = frame(socket, 'chatAck');
    send(socket, 'chatMessage', CHAT_TEXT);
    await acked;
    await waitFor(() => at(LogLevel.DEBUG, 'chatMessage')[0], 'the fence');

    expect(JSON.stringify(logger.entries)).not.toInclude('gameTick');
    socket.close();
  });

  /**
   * The hole this closes: with no socket middleware, `@dunx/http` sends a throwing
   * handler to `defaultOnError`, which is a bare `console.error` - no level, no
   * masking, invisible to `LOG_LEVEL`.
   */
  test('a throwing handler writes one structured error, and no console line', async () => {
    const socket = await connect();
    const opened = await waitFor(
      () => at(LogLevel.DEBUG, 'connect')[0],
      'connect',
    );

    send(socket, 'placeBet', { betAmountCents: BET_AMOUNT, isDemo: true });

    const failure = await waitFor(
      () => logger.at(LogLevel.ERROR)[0],
      'the error entry',
    );
    expect(logger.at(LogLevel.ERROR)).toHaveLength(1);
    expect(failure.message).toBe('socket handler failed');
    expect(fields(failure)).toMatchObject({
      gateway: 'GameGateway',
      path: '/ws',
      event: 'placeBet',
      connectionId: fields(opened)['connectionId'],
      status: HttpStatusCode.INTERNAL_SERVER_ERROR,
    });
    expect((fields(failure)['err'] as Error).message).toBe('redis is gone');
    expect(consoleErrors).toBeEmpty();

    socket.close();
  });

  /**
   * `errorLevel` is `debug` on the logging middleware for this: the frame entry
   * still records that the frame failed, but the graded line is the reporter's, so
   * one failure is one `error`.
   */
  test('the frame entry records the failure without a second error line', async () => {
    const socket = await connect();
    await waitFor(() => at(LogLevel.DEBUG, 'connect')[0], 'connect');

    send(socket, 'placeBet', { betAmountCents: BET_AMOUNT, isDemo: true });
    const traced = await waitFor(
      () => at(LogLevel.DEBUG, 'placeBet')[0],
      'the placeBet frame entry',
    );

    expect(fields(traced)['err']).toBeInstanceOf(Error);
    expect(logger.at(LogLevel.ERROR)).toHaveLength(1);
    socket.close();
  });

  /** A caller's mistake is not an incident, so the app's ErrorMapper grades it. */
  test('an error the ErrorMapper recognises is a warn, not an error', async () => {
    const socket = await connect();
    await waitFor(() => at(LogLevel.DEBUG, 'connect')[0], 'connect');

    send(socket, 'cashOut', { roundId: 'nope' });

    const refused = await waitFor(
      () => logger.at(LogLevel.WARN)[0],
      'the warn entry',
    );
    expect(refused.message).toBe('socket handler failed');
    expect(fields(refused)).toMatchObject({
      event: 'cashOut',
      status: HttpStatusCode.BAD_REQUEST,
    });
    expect(logger.at(LogLevel.ERROR)).toBeEmpty();

    socket.close();
  });

  /**
   * `payload: false` is the default and stays it. A chat body and a DM cross this
   * socket, and `LOG_MASK_FIELDS` masks by field name - it cannot reach a payload
   * logged wholesale.
   */
  test('no frame body reaches a log line, on the failing path either', async () => {
    const socket = await connect();
    await waitFor(() => at(LogLevel.DEBUG, 'connect')[0], 'connect');

    const acked = frame(socket, 'chatAck');
    send(socket, 'chatMessage', CHAT_TEXT);
    await acked;
    send(socket, 'placeBet', { betAmountCents: BET_AMOUNT, isDemo: true });
    await waitFor(() => logger.at(LogLevel.ERROR)[0], 'the error entry');

    const written = JSON.stringify(
      logger.entries.map((record) => [record.message, record.params]),
    );
    expect(written).not.toInclude(CHAT_TEXT);
    expect(written).not.toInclude(String(BET_AMOUNT));
    socket.close();
  });
});
