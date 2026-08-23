import { Logger } from '@dunx/core';
import {
  Gateway,
  OnClose,
  OnMessage,
  OnOpen,
  OnUpgrade,
  Public,
  PubSub,
  type Socket,
} from '@dunx/http';
import type { ServerPayloads } from '@firecracker/contracts';
import type { BunRequest } from 'bun';
import { PLAYER_CHAT_EVENTS, playerChatTopic } from '../../chat/chat.events.js';
import { ChatService } from '../../chat/services/chat.service.js';
import { PlayerChatService } from '../../chat/services/player-chat.service.js';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import {
  CLIENT_EVENTS,
  EVENTS,
  publishSocket,
  TOPICS,
  Topics,
  type ChatAckPayload,
} from '../../notifications/events/events.js';
import { UserRole } from '../../users/schema/user.schema.js';
import { CrashEngineService } from '../engine/crash-engine.service.js';
import { ClientSeedService } from '../fairness/client-seed.service.js';
import {
  GAME_CLIENT_EVENTS,
  GAME_EVENTS,
  GAME_TOPIC,
  type SeedAckPayload,
} from '../game.events.js';
import { GameMessages } from './game.messages.js';
import { GameRoundStatus } from '../rounds/game-round.schema.js';
import { AutoCashOutService } from '../betting/auto-cashout.service.js';
import { GameStateService } from './game-state.service.js';
import { BetActionsService } from './bet-actions.service.js';
import {
  SocketAuthService,
  type GameSocketContext,
} from './socket-auth.service.js';

/**
 * The one socket. Chat, notifications and the game all arrive here, because dunx
 * mounts a gateway as a route and a second class would be a second connection to
 * authenticate. Everything here is transport: subscribe, parse, delegate, send.
 *
 * A spectator gets `context.player === null` - the upgrade never refuses an
 * anonymous caller - and every handler that spends money checks it.
 */
/**
 * **`@Public()`, or a spectator never gets through the door.**
 *
 * `SessionGuard` is global middleware and dunx guards a route unless it is told
 * otherwise, so the upgrade was answered with a 401 before it ever reached
 * `@OnUpgrade` - which is written for anonymous callers, as is `SocketAuthService`,
 * as is every handler that checks `player !== null`. All of that was unreachable:
 * the browser saw `Connection closed before receiving a handshake response`, and
 * the client hid it behind a login form, so nobody found out.
 */
@Public()
@Gateway('/ws')
export class GameGateway {
  constructor(
    private readonly sessions: SocketAuthService,
    private readonly engine: CrashEngineService,
    private readonly actions: BetActionsService,
    private readonly autoCashOut: AutoCashOutService,
    private readonly state: GameStateService,
    private readonly clientSeeds: ClientSeedService,
    private readonly playerChat: PlayerChatService,
    private readonly chat: ChatService,
    private readonly events: EventsPublisher,
    private readonly pubsub: PubSub,
    private readonly logger: Logger,
  ) {}

  /**
   * Wires the engine's per-tick auto-cashout callback. The engine must not do this
   * itself: injecting `AutoCashOutService` would give the clock a path to the
   * wallet, where today its only game dependency is `GameRoundRepository`.
   *
   * Armed a moment after boot recovery resumes a mid-flight round, since providers
   * construct in dependency order. Survivable, not overlooked: `sweep` claims each
   * entry with `hdel` before paying, so the cost is ticks of precision, never a
   * double payout.
   */
  onInit(): void {
    this.engine.registerAutoCashOutHandler((roundId, multiplierX100) => {
      void this.autoCashOut
        .sweep(roundId, multiplierX100)
        .catch((error: unknown) =>
          this.logger.error('auto-cashout sweep failed', {
            roundId,
            reason: (error as Error).message,
          }),
        );
    });
  }

  /**
   * The session, if there is one. Returning a `Response` here would refuse the
   * upgrade, and this gateway never does - see `SocketAuthService`, which also
   * explains why a token may arrive in the query string.
   */
  @OnUpgrade()
  upgrade(req: BunRequest): Promise<GameSocketContext> {
    return this.sessions.context(req);
  }

  /**
   * Subscribing is per-socket and stays here; the frames a new client is owed are a
   * projection from `GameStateService`. They go straight down this socket rather
   * than being published - they are this client's own identity and balance.
   */
  @OnOpen()
  async opened(socket: Socket<GameSocketContext>): Promise<void> {
    const { player } = socket.data.context;

    socket.subscribe(GAME_TOPIC);
    socket.subscribe(TOPICS.CHAT);
    if (player !== null) {
      socket.subscribe(Topics.user(player.userId));
      if (player.roles.includes(UserRole.ADMIN))
        socket.subscribe(TOPICS.ADMINS);
    }

    this.#broadcastUserCount();

    for (const frame of await this.state.connectFrames(player)) {
      socket.send(JSON.stringify(frame));
    }
  }

  /**
   * One frame, under a name of our choosing, payload checked against that name.
   *
   * dunx replies to `@OnMessage('x')` by sending the handler's **return value back
   * under `x`**, so a returned ack would reach the client as `{"event":"placeBet"}`
   * while it listens for `betAck`. Every handler here sends and returns nothing.
   */
  #send<E extends keyof ServerPayloads>(
    socket: Socket<GameSocketContext>,
    event: E,
    data: ServerPayloads[E],
  ): void {
    socket.send(JSON.stringify({ event, data }));
  }

  @OnMessage(GAME_CLIENT_EVENTS.PLACE_BET)
  async placeBet(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<void> {
    const ack = await this.actions.place(socket.data.context.player, data);
    this.#send(socket, GAME_EVENTS.BET_ACK, ack);
  }

  @OnMessage(GAME_CLIENT_EVENTS.CASH_OUT)
  cashOut(data: unknown, socket: Socket<GameSocketContext>): void {
    const ack = this.actions.cashOut(socket.data.context.player, data);
    this.#send(socket, GAME_EVENTS.CASH_OUT_ACK, ack);
  }

  @OnMessage(GAME_CLIENT_EVENTS.SUBMIT_CLIENT_SEED)
  async submitSeed(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<void> {
    this.#send(
      socket,
      GAME_EVENTS.SEED_ACK,
      await this.#submitSeed(data, socket),
    );
  }

  async #submitSeed(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<SeedAckPayload> {
    const seed = GameMessages.parseSeed(data);
    if (seed === null) {
      return { success: false, error: 'A seed is 1 to 128 characters' };
    }

    const roundId = this.engine.roundId;
    if (this.engine.phase !== GameRoundStatus.WAITING || roundId === null) {
      return {
        success: false,
        error: 'Client seeds are only accepted during the waiting phase',
      };
    }

    // A spectator has no user id, so they are keyed by connection - see
    // `ClientSeedService.contribute` for why the key matters.
    const { player } = socket.data.context;
    await this.clientSeeds.contribute(
      roundId,
      player?.userId ?? crypto.randomUUID(),
      seed,
    );

    return { success: true };
  }

  /**
   * Idempotent by construction: the room id is a hash of the two sorted user ids,
   * so both sides compute the same one and "create" and "join" are one operation.
   * `roomId` is a reconnect, `targetUserId` opens a new room.
   */
  @OnMessage(GAME_CLIENT_EVENTS.JOIN_PLAYER_CHAT)
  async joinPlayerChat(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<void> {
    const { player } = socket.data.context;
    if (player === null) return;

    const request = GameMessages.parseJoinChat(data);
    if (request === null) return;

    const room =
      request.roomId !== undefined
        ? await this.playerChat.find(request.roomId, player.userId)
        : request.targetUserId !== undefined
          ? await this.playerChat.open(player.userId, request.targetUserId)
          : null;

    if (room === null) {
      this.#send(socket, PLAYER_CHAT_EVENTS.SYSTEM_MESSAGE, {
        roomId: request.roomId ?? '',
        message: 'That conversation is not available.',
        timestamp: new Date().toISOString(),
        type: 'leave',
      });
      return;
    }

    // The service owns the room, the gateway owns the connection.
    socket.subscribe(playerChatTopic(room.roomId));

    // Telling the *other* participant is the service's, because that goes to their
    // topic rather than to a socket.
    this.#send(socket, PLAYER_CHAT_EVENTS.ROOM_JOINED, room);
    this.playerChat.joined(room, player.userId, player.username);
  }

  @OnMessage(GAME_CLIENT_EVENTS.SEND_PLAYER_CHAT)
  async sendPlayerChat(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<void> {
    const { player } = socket.data.context;
    if (player === null) return;

    const request = GameMessages.parsePlayerMessage(data);
    if (request === null) return;

    // `send` re-checks membership rather than trusting the subscription: that is a
    // client-side fact, and a room id is a hash of two user ids, not a secret.
    await this.playerChat.send(request.roomId, player.userId, request.message);
  }

  @OnMessage(GAME_CLIENT_EVENTS.LEAVE_PLAYER_CHAT)
  leavePlayerChat(data: unknown, socket: Socket<GameSocketContext>): void {
    const { player } = socket.data.context;
    if (player === null) return;

    const roomId = GameMessages.parseRoomId(data);
    if (roomId === null) return;

    socket.unsubscribe(playerChatTopic(roomId));
    this.playerChat.announce(roomId, player.username, 'leave');
  }

  /**
   * `chatAck`, explicitly. Returning it sent it back under `chatMessage` instead,
   * so both rejections below were dropped in the browser and a spectator typing
   * into the lobby saw the input clear and nothing else.
   */
  @OnMessage(CLIENT_EVENTS.CHAT_MESSAGE)
  globalChat(data: unknown, socket: Socket<GameSocketContext>): void {
    this.#send(socket, EVENTS.CHAT_ACK, this.#globalChat(data, socket));
  }

  #globalChat(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): ChatAckPayload {
    const { player } = socket.data.context;
    if (player === null) return { error: 'Login required to chat' };

    const text = GameMessages.parseChat(data);
    if (text === null) {
      return { error: 'a chat message is a string of 1 to 1000 characters' };
    }

    this.chat.say(player, text);
    return { delivered: 1 };
  }

  /**
   * No log line: `SocketLoggingMiddleware` already writes one carrying the
   * `connectionId` and the connection's duration, which this could not.
   */
  @OnClose()
  closed(): void {
    // After the close, so the count no longer includes this socket.
    this.#broadcastUserCount();
  }

  /**
   * Subscribers on **this node**: Bun cannot count another process's sockets, so
   * this becomes a per-node figure the moment `app` is scaled past one replica.
   */
  #broadcastUserCount(): void {
    publishSocket(
      this.events,
      GAME_TOPIC,
      EVENTS.USER_COUNT,
      this.pubsub.subscriberCount(GAME_TOPIC),
    );
  }
}
