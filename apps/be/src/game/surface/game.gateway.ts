import { Logger } from '@dunx/core';
import {
  Gateway,
  OnClose,
  OnMessage,
  OnOpen,
  OnUpgrade,
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
 * The one socket. Chat, notifications and the game all arrive here.
 *
 * ## Why one gateway and not two
 *
 * The NestJS version had two `@WebSocketGateway()` classes, and Nest merged them
 * onto a single socket.io server - so a browser opened one connection and received
 * both `chatMessage` and `gameTick` on it. dunx mounts a gateway as a **route**, so
 * two classes means two paths, two connections, and two upgrades to authenticate.
 * A path claimed by two gateways is a boot error rather than a merge.
 *
 * One connection is the behaviour worth keeping, so this is one class - and the
 * only way to make it smaller is to keep every `@OnX` here and move the bodies
 * out. What is left is transport: subscribe, parse, delegate, send. The upgrade is
 * `SocketAuthService`, a bet and a cash-out are `BetActionsService`, the connect
 * frames are `GameStateService`, and the seed pool is `ClientSeedService`.
 *
 * ## The upgrade does not refuse anonymous callers
 *
 * The template's `EventsGateway` returned a 401 from `@OnUpgrade` when there was no
 * session. This one must not: watching the rocket climb is what a visitor does
 * before signing up, and the crash history and the lobby are public. A spectator
 * gets `context.player === null`, and every handler that spends money checks it.
 */
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
   * Wires the engine's per-tick auto-cashout callback.
   *
   * The engine cannot do this itself, and must not: injecting `AutoCashOutService`
   * would give the clock a path to `GameBetService` and through it to the wallet,
   * where today its only game dependency is `GameRoundRepository`.
   *
   * It is registered *after* the engine's own `onInit` has run its boot recovery,
   * because providers construct in dependency order - so a round that was
   * mid-flight resumes ticking a moment before this sweep is armed. Survivable
   * rather than overlooked: the engine reads the handler per tick, and `sweep`
   * claims each entry with `hdel` before it pays, so the cost is a couple of ticks
   * of precision and never a double payout.
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
   * Subscribing is per-socket, which is the half that has to stay here; the frames
   * a new client is owed are a projection, so they come from `GameStateService`.
   * They go straight down this socket rather than being published - the round as
   * this client sees it, its own scrollback, its own identity and its own balance.
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
   * Send one frame to one socket, under a name of our choosing, with the payload
   * checked against that name.
   *
   * This exists because of a sharp edge worth stating: dunx replies to
   * `@OnMessage('x')` by sending the handler's **return value back under `x`**. So
   * `placeBet` returning an ack would reach the client as `{"event":"placeBet"}`,
   * and the client listens for `betAck`. The names differ on purpose - a request
   * and its acknowledgement are not the same event - so every handler here sends
   * explicitly and returns nothing.
   *
   * An e2e test caught this. Without it every ack in the UI would have been
   * silently dropped, which looks exactly like a bet that did nothing.
   *
   * `ServerPayloads` is the merged map from `@firecracker/contracts`: this is the
   * one socket the game, the chat and the rooms all ride, so a frame leaving here
   * can be any of them - and `data: unknown` was the last untyped `send` left.
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
   * Open a one-to-one room with another player and subscribe this socket to it.
   *
   * Idempotent by construction: the room id is a hash of the two user ids sorted,
   * so both sides compute the same one and "create" and "join" are the same
   * operation. `roomId` is accepted for a client re-joining a room it already
   * knows about - a reconnect - and `targetUserId` for opening a new one.
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

    // Subscribing is per-socket, which is why this lives in the gateway and not
    // in the service: the service owns the room, the gateway owns the connection.
    socket.subscribe(playerChatTopic(room.roomId));

    // To this socket: the room it now belongs to. Telling the other participant
    // is the service's, because it goes to their own topic rather than a socket.
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

    // `send` re-checks membership against Redis rather than trusting that this
    // socket subscribed - the subscription is a client-side fact, and a room id
    // is a hash of two user ids rather than a secret.
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
   * Global chat, folded in from the template's `EventsGateway`.
   *
   * The ack goes out under `chatAck`, explicitly, like every other handler here.
   * Returning it instead sent it back as a `chatMessage` - the name the client had
   * just used to ask - so both rejections below were dropped in the browser and a
   * spectator typing into the lobby saw the input clear and nothing else.
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
   * No log line here. `SocketLoggingMiddleware` wraps `@OnClose` even for a gateway
   * that declares none, and its entry carries the `connectionId` and the connection's
   * duration - which this one could not - so a second one would be the same event
   * written twice.
   */
  @OnClose()
  closed(): void {
    // After the close, so the count no longer includes this socket.
    this.#broadcastUserCount();
  }

  /**
   * Subscribers on **this node**. Bun counts its own sockets and cannot count
   * another process's, so with more than one web node this is a per-node figure
   * rather than a global one. Single-node today; worth remembering before the
   * `app` service is ever scaled.
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
