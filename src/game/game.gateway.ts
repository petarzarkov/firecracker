import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Emitter } from '@socket.io/redis-emitter';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { GAME } from '@/constants';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { RedisService } from '@/infra/redis/services/redis.service';
import {
  BetAckPayload,
  BetCashedOutPayload,
  BetPlacedPayload,
  CashOutAckPayload,
  CrashedRoundSummary,
  ExtendedSocket,
  GameCrashedPayload,
  GamePhasePayload,
  GameRoundStatePayload,
  GameTickPayload,
  SeedAckPayload,
  WebSocketEmitEvents,
  WSServer,
} from '@/notifications/events/events.dto';
import { ROOMS } from '@/notifications/events/events.gateway';
import { CrashEngineService } from './engine/crash-engine.service';
import { GameRoundStatus } from './enum/game-round-status.enum';
import { GameBetService } from './services/game-bet.service';
import { GameRoundService } from './services/game-round.service';
import { WalletService } from './services/wallet.service';

// ── WS message DTOs ────────────────────────────────────────────────────────

class PlaceBetMessageDto {
  @IsInt()
  @Min(100)
  betAmountCents!: number;

  @IsOptional()
  @IsBoolean()
  isDemo?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1.01)
  autoCashOutAt?: number;
}

class SubmitClientSeedMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  seed!: string;
}

/** Redis key for storing per-round client seeds during WAITING phase. */
export const clientSeedsKey = (roundId: string) =>
  `game:client-seeds:${roundId}`;

/** Generate a random 16-byte hex string for auto-seeding on bet placement. */
function randomHex16(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('hex');
}

// ── Gateway ────────────────────────────────────────────────────────────────

export const GAME_ROOM = 'game';

/**
 * Shares the same Socket.io server instance as EventsGateway.
 * NestJS merges multiple @WebSocketGateway() decorators onto one server.
 *
 * In the main process: `server` is set — uses the real Socket.io server.
 * In background worker processes: `server` is null — uses a Redis emitter
 * (@socket.io/redis-emitter) so WS events are forwarded to the main process
 * and delivered to connected clients via the Redis adapter.
 */
@WebSocketGateway()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Injectable()
export class GameGateway implements OnGatewayConnection, OnModuleInit {
  @WebSocketServer()
  server: WSServer | null = null;

  /** Redis-emitter used when running in a background worker (server=null). */
  private emitter: Emitter<WebSocketEmitEvents> | null = null;

  /**
   * Points to the real server in the main process, or the Redis emitter in
   * background workers. Set during onModuleInit — always non-null after that.
   */
  io!: WSServer | Emitter<WebSocketEmitEvents>;

  /** Dedicated Redis client for auto-cashout hash storage. */
  private readonly redis;

  constructor(
    private readonly crashEngine: CrashEngineService,
    private readonly gameBetService: GameBetService,
    private readonly gameRoundService: GameRoundService,
    private readonly walletService: WalletService,
    private readonly redisService: RedisService,
    private readonly logger: ContextLogger,
  ) {
    this.redis = this.redisService.newConnection('game-auto-cashout');
  }

  onModuleInit(): void {
    if (!this.server) {
      // Worker process: no real Socket.io server — emit via Redis.
      const redisClient = this.redisService.newConnection('game-emitter', {
        db: 4,
      });
      this.emitter = new Emitter(redisClient);
      this.io = this.emitter;
    } else {
      // Main process: use real server and wire callbacks.
      this.io = this.server;
      this.crashEngine.registerTickEmitter((multiplier, elapsed) => {
        this.emitTick({ multiplier, elapsed });
      });
      this.crashEngine.registerAutoCashOutHandler((roundId, multiplier) => {
        this.#processAutoCashOuts(roundId, multiplier);
      });
    }
  }

  async handleConnection(client: ExtendedSocket): Promise<void> {
    await client.join(GAME_ROOM);

    // Send current game state to the newly connected client
    try {
      const [round, recentRounds] = await Promise.all([
        this.gameRoundService.getCurrentRound(),
        this.gameRoundService.getRecentCrashes(15),
      ]);
      const phase = this.crashEngine.getCurrentPhase();
      const bets = round
        ? await this.gameBetService.findByRoundId(round.id)
        : [];

      const recentCrashes: CrashedRoundSummary[] = recentRounds.map(r => ({
        roundId: r.id,
        crashPoint: Number(r.crashPoint),
      }));

      const payload: GameRoundStatePayload = {
        phase: phase ?? 'waiting',
        roundId: round?.id ?? null,
        seedHash: round?.seedHash ?? null,
        nonce: round?.nonce,
        recentCrashes,
        activeBets: bets.map(b => ({
          username:
            b.user?.displayName ?? b.user?.email?.split('@')[0] ?? b.userId,
          betAmountCents: b.betAmountCents,
          isDemo: b.isDemo,
          ...(b.cashedOutAt !== null
            ? { cashedOutAt: Number(b.cashedOutAt) }
            : {}),
        })),
      };

      if (phase === GameRoundStatus.RUNNING) {
        try {
          payload.multiplier = this.crashEngine.getCurrentMultiplier();
          payload.elapsed = round?.startedAt
            ? Date.now() - round.startedAt.getTime()
            : 0;
        } catch {
          // engine not running yet — that's fine
        }
      }

      if (phase === GameRoundStatus.WAITING && round?.waitingEndsAt) {
        payload.waitingEndsAt = round.waitingEndsAt.toISOString();
      }

      client.emit('gameRoundState', payload);
    } catch (err) {
      this.logger.error('Failed to send game state on connect', { err });
    }

    // Send demo wallet balance for authenticated users
    const user = client.data.user;
    if (user) {
      try {
        const demoWallet = await this.walletService.getWallet(user.id, true);
        this.io.to(ROOMS.user(user.id)).emit('walletUpdated', {
          balanceCents: demoWallet.balanceCents,
          isDemo: true,
        });
      } catch (err) {
        this.logger.error('Failed to send demo wallet on connect', { err });
      }
    }
  }

  // ── Inbound messages from clients ─────────────────────────────────────

  @SubscribeMessage('placeBet')
  async handlePlaceBet(
    @MessageBody() data: PlaceBetMessageDto,
    @ConnectedSocket() client: ExtendedSocket,
  ): Promise<void> {
    const user = client.data.user;

    if (!user) {
      client.emit('betAck', {
        success: false,
        error: 'Login required to place bets',
      });
      return;
    }

    const roundId = this.crashEngine.getCurrentRoundId();
    const phase = this.crashEngine.getCurrentPhase();

    if (phase !== GameRoundStatus.WAITING) {
      const ack: BetAckPayload = {
        success: false,
        error: 'Bets are only accepted during the waiting phase',
      };
      client.emit('betAck', ack);
      return;
    }

    if (!roundId) {
      client.emit('betAck', { success: false, error: 'No active round' });
      return;
    }

    const isDemo = data.isDemo ?? false;
    const username = user.displayName ?? user.email.split('@')[0];

    try {
      const bet = await this.gameBetService.placeBet(
        user.id,
        roundId,
        data.betAmountCents,
        () => {},
        isDemo,
      );

      // Auto-contribute a random seed on behalf of the player so the crash
      // point always includes bettor entropy. hsetnx preserves any seed the
      // player submitted explicitly via 'submitClientSeed'.
      await this.redis.hsetnx(clientSeedsKey(roundId), user.id, randomHex16());

      if (data.autoCashOutAt) {
        await this.#storeAutoCashOut(
          roundId,
          user.id,
          username,
          data.autoCashOutAt,
          isDemo,
        );
      }

      const wallet = await this.walletService.getWallet(user.id, isDemo);
      const ack: BetAckPayload = {
        success: true,
        username,
        betAmountCents: bet.betAmountCents,
      };
      client.emit('betAck', ack);
      this.io.to(ROOMS.user(user.id)).emit('walletUpdated', {
        balanceCents: wallet.balanceCents,
        isDemo,
      });

      // Track demo mode on the socket so cashOut uses the correct path
      client.data.isDemo = isDemo;

      const broadcast: BetPlacedPayload = {
        username,
        betAmountCents: bet.betAmountCents,
        isDemo,
      };
      this.io.to(GAME_ROOM).emit('betPlaced', broadcast);
    } catch (err) {
      const message =
        err instanceof BadRequestException
          ? (err.getResponse() as { message: string }).message
          : 'Failed to place bet';
      client.emit('betAck', { success: false, error: message });
    }
  }

  @SubscribeMessage('cashOut')
  async handleCashOut(
    @ConnectedSocket() client: ExtendedSocket,
  ): Promise<void> {
    const user = client.data.user;
    const roundId = this.crashEngine.getCurrentRoundId();
    const phase = this.crashEngine.getCurrentPhase();

    if (!user) {
      client.emit('cashOutAck', {
        success: false,
        error: 'Login required to cash out',
      });
      return;
    }

    if (!roundId) {
      client.emit('cashOutAck', { success: false, error: 'No active round' });
      return;
    }

    // Capture the multiplier SYNCHRONOUSLY before any async operation.
    // If the round just crashed within the 300 ms grace window, honour the
    // cashout at the crash multiplier so clients aren't punished for RTT.
    let currentMultiplier: number;
    if (phase === GameRoundStatus.RUNNING) {
      try {
        currentMultiplier = this.crashEngine.getCurrentMultiplier();
      } catch {
        client.emit('cashOutAck', {
          success: false,
          error: 'Round ended — too late to cash out',
        });
        return;
      }
    } else {
      const graceMult = this.crashEngine.getCrashMultiplierIfRecent(300);
      if (graceMult === null) {
        client.emit('cashOutAck', {
          success: false,
          error: 'Round is not currently running',
        });
        return;
      }
      currentMultiplier = graceMult;
    }

    const isDemo = client.data.isDemo ?? false;

    try {
      const bet = await this.gameBetService.cashOut(
        user.id,
        roundId,
        currentMultiplier,
        isDemo,
      );

      const wallet = await this.walletService.getWallet(user.id, isDemo);
      client.data.isDemo = false;

      const ack: CashOutAckPayload = {
        success: true,
        multiplier: currentMultiplier,
        payoutCents: bet.payoutCents ?? 0,
      };
      client.emit('cashOutAck', ack);
      this.io.to(ROOMS.user(user.id)).emit('walletUpdated', {
        balanceCents: wallet.balanceCents,
        isDemo,
      });

      const broadcast: BetCashedOutPayload = {
        username: user.displayName ?? user.email.split('@')[0],
        multiplier: currentMultiplier,
        payoutCents: bet.payoutCents ?? 0,
        isDemo,
      };
      this.io.to(GAME_ROOM).emit('betCashedOut', broadcast);
    } catch (err) {
      const message =
        err instanceof BadRequestException
          ? (err.getResponse() as { message: string }).message
          : 'Failed to cash out';
      client.emit('cashOutAck', { success: false, error: message });
    }
  }

  @SubscribeMessage('submitClientSeed')
  async handleSubmitClientSeed(
    @MessageBody() data: SubmitClientSeedMessageDto,
    @ConnectedSocket() client: ExtendedSocket,
  ): Promise<void> {
    const roundId = this.crashEngine.getCurrentRoundId();
    const phase = this.crashEngine.getCurrentPhase();

    if (phase !== GameRoundStatus.WAITING || !roundId) {
      const ack: SeedAckPayload = {
        success: false,
        error: 'Client seeds are only accepted during the waiting phase',
      };
      client.emit('seedAck', ack);
      return;
    }

    const user = client.data.user;
    const key = clientSeedsKey(roundId);
    const field = user?.id ?? client.id;

    await this.redis.hset(key, field, data.seed);
    await this.redis.expire(key, Math.ceil(GAME.WAITING_PHASE_MS / 1000) + 30);

    client.emit('seedAck', { success: true });
  }

  // ── Emission helpers (called by CrashEngineService and GameLifecycleHandler) ──

  emitTick(data: GameTickPayload): void {
    this.io.to(GAME_ROOM).emit('gameTick', data);
  }

  emitPhaseChange(data: GamePhasePayload): void {
    this.io.to(GAME_ROOM).emit('gamePhaseChange', data);
  }

  emitCrashed(data: GameCrashedPayload): void {
    this.io.to(GAME_ROOM).emit('gameCrashed', data);
  }

  emitWalletUpdated(
    userId: string,
    balanceCents: number,
    isDemo: boolean,
  ): void {
    this.io
      .to(ROOMS.user(userId))
      .emit('walletUpdated', { balanceCents, isDemo });
  }

  // ── Auto-cashout ──────────────────────────────────────────────────────────

  async #storeAutoCashOut(
    roundId: string,
    userId: string,
    username: string,
    autoCashOutAt: number,
    isDemo: boolean,
  ): Promise<void> {
    const key = `game:auto-cashout:${roundId}`;
    await this.redis.hset(
      key,
      userId,
      JSON.stringify({ username, autoCashOutAt, isDemo }),
    );
    await this.redis.expire(key, 3600);
  }

  /** Fire-and-forget: called on every tick from the engine. */
  #processAutoCashOuts(roundId: string, multiplier: number): void {
    void this.#doProcessAutoCashOuts(roundId, multiplier).catch(err =>
      this.logger.error('Auto-cashout processing error', { err }),
    );
  }

  async #doProcessAutoCashOuts(
    roundId: string,
    multiplier: number,
  ): Promise<void> {
    const key = `game:auto-cashout:${roundId}`;
    const entries = await this.redis.hgetall(key);

    for (const [userId, raw] of Object.entries(entries)) {
      const { username, autoCashOutAt, isDemo } = JSON.parse(raw) as {
        username: string;
        autoCashOutAt: number;
        isDemo: boolean;
      };
      if (autoCashOutAt > multiplier) continue;

      try {
        const cashOutAt = Math.min(multiplier, autoCashOutAt);
        const bet = await this.gameBetService.cashOut(
          userId,
          roundId,
          cashOutAt,
          isDemo,
        );
        await this.redis.hdel(key, userId);

        const wallet = await this.walletService.getWallet(userId, isDemo);
        this.io.to(ROOMS.user(userId)).emit('walletUpdated', {
          balanceCents: wallet.balanceCents,
          isDemo,
        });

        const broadcast: BetCashedOutPayload = {
          username,
          multiplier: cashOutAt,
          payoutCents: bet.payoutCents ?? 0,
          isDemo,
        };
        this.io.to(GAME_ROOM).emit('betCashedOut', broadcast);
      } catch {
        // Bet may already be cashed out or round ended — skip silently
      }
    }
  }
}
