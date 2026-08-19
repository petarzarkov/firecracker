import { describe, expect, mock, test } from 'bun:test';
import type { Logger } from '@dunx/core';
import type { PubSub } from '@dunx/http';
import { SocketPublisher } from './events.publisher.js';

/**
 * A frame is best-effort; a database transition is not.
 *
 * `PubSub.publishEvent` throws once the server has stopped, and a job handler that
 * publishes *after* committing then fails on work it had already done. BullMQ retries
 * it, the commit happens twice, and for `game.round.schedule` that is a duplicate
 * round - which is how a stuck-round backlog builds up one `ctrl-c` at a time.
 *
 * `RelayPublisher` always had this rule; this is the half that did not.
 */
const logger = (): Logger =>
  ({ warn: mock(() => undefined) }) as unknown as Logger;

describe('SocketPublisher', () => {
  test('publishes through PubSub on the happy path', () => {
    const publishEvent = mock(() => undefined);
    const log = logger();

    new SocketPublisher({ publishEvent } as unknown as PubSub, log).publish(
      'game',
      'tick',
      { multiplier: 1.5 },
    );

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('a stopped server is a warning, never a throw', () => {
    const log = logger();
    const pubsub = {
      publishEvent: mock(() => {
        throw new Error('PubSub has no server yet.');
      }),
    } as unknown as PubSub;

    const publisher = new SocketPublisher(pubsub, log);

    // The assertion is the absence of a throw: a job handler calling this after its
    // transaction committed must not be failed by it.
    expect(() => publisher.publish('game', 'phaseChange', {})).not.toThrow();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
