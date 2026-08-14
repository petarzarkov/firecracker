/* oxlint-disable max-lines -- This is the app's entire realtime surface, and dunx
   mounts one gateway per path: the game, global chat and player DMs share a single
   connection, so their handlers share a single class. Splitting it would mean a
   second WebSocket, which is the thing the class comment explains we do not want.
   The logic is already out - see game.messages.ts, game-state.service.ts,
   auto-cashout.service.ts and player-chat.service.ts. What is left is transport. */
import { Auth, rolesOf } from '@dunx/auth';
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
import { RedisConnection } from '@dunx/infra/redis';
import type { BunRequest } from 'bun';
import { AppConfigService } from '../config/app.config.service.js';
import { EventsPublisher } from '../notifications/events/events.publisher.js';
import { EVENTS, TOPICS, userTopic } from '../notifications/events/events.js';
import { UserRole } from '../users/schema/user.schema.js';
import { CrashEngineService } from './engine/crash-engine.service.js';
import {
  GAME_CLIENT_EVENTS,
  GAME_EVENTS,
  GAME_TOPIC,
  playerChatTopic,
  PLAYER_CHAT_EVENTS,
  type BetAckPayload,
  type CashOutAckPayload,
  type SeedAckPayload,
} from './game.events.js';
import { toMultiplier } from './game.math.js';
import { GameRoundStatus } from './schema/game-round.schema.js';
import { GameBetService } from './services/game-bet.service.js';
import {
  clientSeedsKey,
  GameRoundService,
} from './services/game-round.service.js';
import { ChatService } from '../chat/services/chat.service.js';
import { AutoCashOutService } from './services/auto-cashout.service.js';
import { PlayerChatService } from './services/player-chat.service.js';
import { GameStateService } from './services/game-state.service.js';
import { WalletService } from './services/wallet.service.js';
import {
  parseBet,
  parseChat,
  parseJoinChat,
  parsePlayerMessage,
  parseRoomId,
  parseSeed,
  playerFacing,
} from './game.messages.js';

/** Who is on the far end of a socket. `null` for a spectator. */
export interface SocketPlayer {
  readonly userId: string;
  readonly email: string;
  readonly username: string;
  readonly roles: readonly string[];
}

export interface GameSocketContext {
  readonly player: SocketPlayer | null;
}

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
 * One connection is the behaviour worth keeping, so this is one class. The
 * template's `EventsGateway` was folded into it and deleted; what stops this from
 * becoming a god object is that it holds no logic - every handler validates, calls
 * a service, and publishes.
 *
 * ## The upgrade does not refuse anonymous callers
 *
 * `EventsGateway` returned a 401 from `@OnUpgrade` when there was no session. This
 * one must not: watching the rocket climb is what a visitor does before signing up,
 * and the crash history and the lobby are public. A spectator gets
 * `context.player === null`, and every handler that spends money checks for it.
 */
@Gateway('/ws')
export class GameGateway {
  constructor(
    private readonly auth: Auth,
    private readonly engine: CrashEngineService,
    private readonly rounds: GameRoundService,
    private readonly bets: GameBetService,
    private readonly wallets: WalletService,
    private readonly autoCashOut: AutoCashOutService,
    private readonly state: GameStateService,
    private readonly playerChat: PlayerChatService,
    private readonly chat: ChatService,
    private readonly redis: RedisConnection,
    private readonly events: EventsPublisher,
    private readonly pubsub: PubSub,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * Wires the engine's per-tick auto-cashout callback.
   *
   * The engine cannot do this itself: the pending cashouts live in a Redis hash
   * this class writes on `placeBet`, and the engine has no business knowing about
   * it. It is a callback rather than an injection because the engine ticks on a
   * timer and must not hold a reference to a socket layer that may not exist -
   * `GameModule.forRoot({ engine: false })` builds the engine nowhere near this.
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
   * upgrade, and this gateway never does - see the class note.
   *
   * ## Why a token can arrive in the query string
   *
   * A browser's `WebSocket` constructor takes a URL and nothing else: there is no
   * way to set an `Authorization` header on the handshake. That leaves the cookie,
   * and better-auth issues its session cookie `SameSite=Lax`, which a browser sends
   * on top-level navigations and **not** on a cross-origin WebSocket upgrade. In
   * development the client is on Vite's port and the API is on its own, so the
   * cookie never arrives and every socket would be anonymous.
   *
   * So `?token=` is read as a fallback and turned into the `Authorization` header
   * better-auth's `bearer()` plugin already understands. The cookie is still
   * preferred and is what production uses, where the client is served same-origin.
   *
   * The token must be **percent-encoded** by the caller: better-auth issues base64,
   * which routinely contains `/`, `+` and `=`, and an unencoded `+` arrives here as
   * a space. `URL.searchParams.set` does this for free, which is what the client
   * shim uses.
   *
   * A token in a query string is worth being uncomfortable about - it lands in
   * server access logs and in `Referer` on any request the page makes afterwards.
   * It is acceptable here because it is only reached for cross-origin development,
   * and because the alternative is developing against an app where nobody is ever
   * logged in. It is **not** a pattern to copy onto an HTTP route.
   */
  @OnUpgrade()
  async upgrade(req: BunRequest): Promise<GameSocketContext> {
    const principal = await this.auth.api
      .getSession({ headers: authHeaders(req) })
      .catch(() => null);

    if (principal === null) return { player: null };

    const { user } = principal;
    return {
      player: {
        userId: user.id,
        email: user.email,
        username: user.name || user.email.split('@')[0] || user.id,
        roles: rolesOf(user),
      },
    };
  }

  @OnOpen()
  async opened(socket: Socket<GameSocketContext>): Promise<void> {
    const { player } = socket.data.context;

    socket.subscribe(GAME_TOPIC);
    socket.subscribe(TOPICS.CHAT);
    if (player !== null) {
      socket.subscribe(userTopic(player.userId));
      if (player.roles.includes(UserRole.ADMIN))
        socket.subscribe(TOPICS.ADMINS);
    }

    this.#broadcastUserCount();

    // Straight down this socket, not published: it is this client's own view of
    // the round, and nobody else's business.
    socket.send(
      JSON.stringify({
        event: GAME_EVENTS.ROUND_STATE,
        data: this.state.snapshot(),
      }),
    );

    // The chat scrollback, for the same reason. A player who reloads mid-round
    // should not find an empty chat window - see `ChatService`, which keeps it in
    // Redis rather than in the database the bet path is writing to.
    socket.send(
      JSON.stringify({
        event: EVENTS.CHAT_HISTORY,
        data: await this.chat.history(),
      }),
    );

    if (player !== null) {
      // `{ payload }` because that is the envelope the client's `updateUser`
      // already destructures. The wire shape is the client's to dictate; there is
      // no reason to rename it here and edit React for the privilege.
      socket.send(
        JSON.stringify({
          event: EVENTS.CONNECTED,
          data: {
            payload: {
              id: player.userId,
              email: player.email,
              displayName: player.username,
            },
          },
        }),
      );
      // The demo wallet, created on first sight, so a new player has something to
      // bet with before they have done anything.
      const demo = this.wallets.getWallet(player.userId, true);
      socket.send(
        JSON.stringify({
          event: GAME_EVENTS.WALLET_UPDATED,
          data: { balanceCents: demo.balanceCents, isDemo: true },
        }),
      );
    }
  }

  /**
   * Send one frame to one socket, under a name of our choosing.
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
   */
  #reply(
    socket: Socket<GameSocketContext>,
    event: string,
    data: unknown,
  ): void {
    socket.send(JSON.stringify({ event, data }));
  }

  // ── Inbound ───────────────────────────────────────────────────────────────

  @OnMessage(GAME_CLIENT_EVENTS.PLACE_BET)
  async placeBet(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<void> {
    this.#reply(
      socket,
      GAME_EVENTS.BET_ACK,
      await this.#placeBet(data, socket),
    );
  }

  async #placeBet(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<BetAckPayload> {
    const { player } = socket.data.context;
    if (player === null) {
      return { success: false, error: 'Login required to place bets' };
    }

    const parsed = parseBet(data);
    if (parsed === null) {
      return { success: false, error: 'Invalid bet' };
    }

    if (this.engine.phase !== GameRoundStatus.WAITING) {
      return {
        success: false,
        error: 'Bets are only accepted during the waiting phase',
      };
    }

    const roundId = this.engine.roundId;
    if (roundId === null) {
      return { success: false, error: 'No active round' };
    }

    const { betAmountCents, isDemo, autoCashOutAt } = parsed;

    try {
      const bet = this.bets.placeBet(
        player.userId,
        roundId,
        betAmountCents,
        isDemo,
      );

      // Contribute entropy on the player's behalf. `HSETNX` so an explicit seed
      // submitted through `submitClientSeed` is never overwritten by this.
      await this.redis
        .send('HSETNX', [
          clientSeedsKey(roundId),
          player.userId,
          this.rounds.autoClientSeed(),
        ])
        .catch(() => undefined);

      if (autoCashOutAt !== undefined) {
        await this.autoCashOut.store(
          roundId,
          player.userId,
          player.username,
          autoCashOutAt,
          isDemo,
        );
      }

      const wallet = this.wallets.getWallet(player.userId, isDemo);
      this.events.publish(
        userTopic(player.userId),
        GAME_EVENTS.WALLET_UPDATED,
        { balanceCents: wallet.balanceCents, isDemo },
      );
      this.events.publish(GAME_TOPIC, GAME_EVENTS.BET_PLACED, {
        userId: player.userId,
        username: player.username,
        betAmountCents: bet.betAmountCents,
        isDemo,
      });

      return {
        success: true,
        userId: player.userId,
        username: player.username,
        betAmountCents: bet.betAmountCents,
      };
    } catch (error) {
      return {
        success: false,
        error: playerFacing(error, 'Failed to place bet'),
      };
    }
  }

  /**
   * The multiplier is read **before** anything async, which is the whole point of
   * the ordering here. `currentMultiplierX100` is a synchronous read of the
   * engine's clock; re-reading it after the write would pay whatever the curve had
   * climbed to in the meantime rather than what the player saw.
   */
  @OnMessage(GAME_CLIENT_EVENTS.CASH_OUT)
  cashOut(data: unknown, socket: Socket<GameSocketContext>): void {
    this.#reply(socket, GAME_EVENTS.CASH_OUT_ACK, this.#cashOut(data, socket));
  }

  #cashOut(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): CashOutAckPayload {
    const { player } = socket.data.context;
    if (player === null) {
      return { success: false, error: 'Login required to cash out' };
    }

    const roundId = this.engine.roundId;
    if (roundId === null) {
      return { success: false, error: 'No active round' };
    }

    const multiplierX100 =
      this.engine.currentMultiplierX100() ?? this.engine.graceMultiplierX100();
    if (multiplierX100 === null) {
      return { success: false, error: 'Round is not currently running' };
    }

    /**
     * Which wallet, decided by the **bet**, not by the client.
     *
     * `BetPanel` sends a bare `socket.emit('cashOut')` with no payload, so
     * defaulting to real money here meant looking for a bet that did not exist
     * and rejecting every demo cash-out - silently, because a rejection is an ack
     * rather than an error. That shipped, and only a browser caught it.
     *
     * The old gateway kept `client.data.isDemo` on the socket. Reading the bet row
     * is better than that was: it survives a reconnect, it cannot drift from the
     * database, and it is right when a player has bets in both modes.
     */
    const requested =
      typeof data === 'object' && data !== null && 'isDemo' in data
        ? Boolean((data as { isDemo?: unknown }).isDemo)
        : undefined;

    const open = this.bets.findActiveByRoundAndUserAnyMode(
      roundId,
      player.userId,
    );
    if (open === undefined) {
      return { success: false, error: 'No active bet found for this round' };
    }
    const isDemo = requested ?? open.isDemo;

    try {
      const bet = this.bets.cashOut(
        player.userId,
        roundId,
        multiplierX100,
        isDemo,
      );
      const wallet = this.wallets.getWallet(player.userId, isDemo);
      const multiplier = toMultiplier(multiplierX100);

      this.events.publish(
        userTopic(player.userId),
        GAME_EVENTS.WALLET_UPDATED,
        { balanceCents: wallet.balanceCents, isDemo },
      );
      this.events.publish(GAME_TOPIC, GAME_EVENTS.BET_CASHED_OUT, {
        username: player.username,
        multiplier,
        payoutCents: bet.payoutCents ?? 0,
        isDemo,
      });

      return {
        success: true,
        multiplier,
        payoutCents: bet.payoutCents ?? 0,
      };
    } catch (error) {
      return {
        success: false,
        error: playerFacing(error, 'Failed to cash out'),
      };
    }
  }

  @OnMessage(GAME_CLIENT_EVENTS.SUBMIT_CLIENT_SEED)
  async submitSeed(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<void> {
    this.#reply(
      socket,
      GAME_EVENTS.SEED_ACK,
      await this.#submitSeed(data, socket),
    );
  }

  async #submitSeed(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<SeedAckPayload> {
    const seed = parseSeed(data);
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

    // Keyed by user where there is one, so a player cannot stuff the pool with
    // one seed per socket. A spectator still contributes, keyed by connection.
    const { player } = socket.data.context;
    const field = player?.userId ?? crypto.randomUUID();
    const key = clientSeedsKey(roundId);

    await this.redis.hset(key, { [field]: seed });
    await this.redis.expire(
      key,
      Math.ceil(this.config.get('game').waitingPhaseMs / 1000) + 30,
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

    const request = parseJoinChat(data);
    if (request === null) return;

    const room =
      request.roomId !== undefined
        ? await this.playerChat.find(request.roomId, player.userId)
        : request.targetUserId !== undefined
          ? await this.playerChat.open(player.userId, request.targetUserId)
          : null;

    if (room === null) {
      this.#reply(socket, PLAYER_CHAT_EVENTS.SYSTEM_MESSAGE, {
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

    // To this socket: the room it now belongs to. To the other participant's own
    // topic: the same room, so their client opens a window without polling.
    this.#reply(socket, PLAYER_CHAT_EVENTS.ROOM_JOINED, room);
    for (const participant of room.participants) {
      if (participant === player.userId) continue;
      this.events.publish(
        userTopic(participant),
        PLAYER_CHAT_EVENTS.ROOM_CREATED,
        room,
      );
    }
    this.playerChat.announce(room.roomId, player.username, 'join');
  }

  @OnMessage(GAME_CLIENT_EVENTS.SEND_PLAYER_CHAT)
  async sendPlayerChat(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): Promise<void> {
    const { player } = socket.data.context;
    if (player === null) return;

    const request = parsePlayerMessage(data);
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

    const roomId = parseRoomId(data);
    if (roomId === null) return;

    socket.unsubscribe(playerChatTopic(roomId));
    this.playerChat.announce(roomId, player.username, 'leave');
  }

  /** Global chat, folded in from the template's `EventsGateway`. */
  @OnMessage('chatMessage')
  globalChat(
    data: unknown,
    socket: Socket<GameSocketContext>,
  ): { delivered: number } | { error: string } {
    const { player } = socket.data.context;
    if (player === null) return { error: 'Login required to chat' };

    const text = parseChat(data);
    if (text === null) {
      return { error: 'a chat message is a string of 1 to 1000 characters' };
    }

    // Recorded before it is published, so a client that reloads immediately after
    // sending still sees its own line. The write is synchronous, so "before" is
    // real rather than a race that usually wins.
    const line = {
      username: player.username,
      message: text,
      timestamp: new Date().toISOString(),
    };

    this.events.publish(TOPICS.CHAT, EVENTS.MESSAGE, line);
    // After the broadcast: everyone watching has it, and a failed write costs the
    // scrollback rather than the message.
    this.chat.record(line);
    return { delivered: 1 };
  }

  @OnClose()
  closed(socket: Socket<GameSocketContext>, code: number): void {
    this.logger.debug('socket closed', {
      userId: socket.data.context.player?.userId ?? null,
      code,
    });
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
    this.events.publish(
      GAME_TOPIC,
      EVENTS.USER_COUNT,
      this.pubsub.subscriberCount(GAME_TOPIC),
    );
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Subscribers on this node, for the lobby's player count. */
  get spectators(): number {
    return this.pubsub.subscriberCount(GAME_TOPIC);
  }
}

/**
 * The upgrade's headers, with `?token=` promoted to `Authorization` when the
 * header is not already there. The cookie path is untouched.
 */
const authHeaders = (req: BunRequest): Headers => {
  if (req.headers.has('authorization')) return req.headers;

  const token = new URL(req.url).searchParams.get('token');
  if (token === null || token.length === 0) return req.headers;

  const headers = new Headers(req.headers);
  headers.set('authorization', `Bearer ${token}`);
  return headers;
};
