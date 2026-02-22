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
import { IsBoolean, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
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
  WebSocketEmitEvents,
  WSServer,
} from '@/notifications/events/events.dto';
import { ROOMS } from '@/notifications/events/events.gateway';
import { CrashEngineService } from './engine/crash-engine.service';
import { GameRoundStatus } from './enum/game-round-status.enum';
import { DemoService } from './services/demo.service';
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
    private readonly demoService: DemoService,
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
    // Join the game broadcast room
    await client.join(GAME_ROOM);

    // Send current game state to the newly connected client
    try {
      const [round, recentRounds] = await Promise.all([
        this.gameRoundService.getCurrentRound(),
        this.gameRoundService.getRecentCrashes(15),
      ]);
      const phase = this.crashEngine.getCurrentPhase();
      const [bets, demoBets] = round
        ? await Promise.all([
            this.gameBetService.findByRoundId(round.id),
            this.demoService.getDemoRoundBets(round.id),
          ])
        : [[], []];

      const recentCrashes: CrashedRoundSummary[] = recentRounds.map(r => ({
        roundId: r.id,
        crashPoint: Number(r.crashPoint),
      }));

      const payload: GameRoundStatePayload = {
        phase: phase ?? 'waiting',
        roundId: round?.id ?? null,
        seedHash: round?.seedHash ?? null,
        recentCrashes,
        activeBets: [
          ...bets.map(b => ({
            username:
              b.user?.displayName ?? b.user?.email?.split('@')[0] ?? b.userId,
            betAmountCents: b.betAmountCents,
            isDemo: false,
            ...(b.cashedOutAt !== null
              ? { cashedOutAt: Number(b.cashedOutAt) }
              : {}),
          })),
          ...demoBets
            .filter(b => b.username)
            .map(b => ({
              username: b.username as string,
              betAmountCents: b.betAmountCents,
              isDemo: true,
              ...(b.cashedOutAt != null ? { cashedOutAt: b.cashedOutAt } : {}),
            })),
        ],
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

    // Send demo wallet balance immediately so the client can display it before the first bet
    try {
      const demoWallet = await this.demoService.getOrCreateWallet(client.id);
      client.emit('walletUpdated', { balanceCents: demoWallet.balanceCents });
    } catch (err) {
      this.logger.error('Failed to send demo wallet on connect', { err });
    }
  }

  // ── Inbound messages from clients ─────────────────────────────────────

  @SubscribeMessage('placeBet')
  async handlePlaceBet(
    @MessageBody() data: PlaceBetMessageDto,
    @ConnectedSocket() client: ExtendedSocket,
  ): Promise<void> {
    const user = client.data.user;
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

    try {
      if (user && !data.isDemo) {
        // ── Authenticated real-money bet ───────────────────────────────
        const bet = await this.gameBetService.placeBet(
          user.id,
          roundId,
          data.betAmountCents,
          () => {},
        );

        const username = user.displayName ?? user.email.split('@')[0];
        if (data.autoCashOutAt) {
          await this.#storeAutoCashOut(
            roundId,
            user.id,
            username,
            data.autoCashOutAt,
          );
        }

        const wallet = await this.walletService.getWallet(user.id);
        const ack: BetAckPayload = {
          success: true,
          username,
          betAmountCents: bet.betAmountCents,
        };
        client.emit('betAck', ack);
        client.to(ROOMS.user(user.id)).emit('walletUpdated', {
          balanceCents: wallet.balanceCents,
        });

        const broadcast: BetPlacedPayload = {
          username,
          betAmountCents: bet.betAmountCents,
          isDemo: false,
        };
        this.io.to(GAME_ROOM).emit('betPlaced', broadcast);
      } else {
        // ── Demo bet (authenticated users only) ────────────────────────
        if (!user) {
          client.emit('betAck', {
            success: false,
            error: 'Login required to place demo bets',
          });
          return;
        }

        const username = user.displayName ?? user.email.split('@')[0];
        const { bet, wallet } = await this.demoService.placeDemoBet(
          client.id,
          roundId,
          data.betAmountCents,
          data.autoCashOutAt,
          username,
        );

        // Remember demo mode for this socket so cashOut also uses demo path
        client.data.isDemo = true;

        const ack: BetAckPayload = {
          success: true,
          username,
          betAmountCents: bet.betAmountCents,
        };
        client.emit('betAck', ack);
        client.emit('walletUpdated', { balanceCents: wallet.balanceCents });

        const broadcast: BetPlacedPayload = {
          username,
          betAmountCents: bet.betAmountCents,
          isDemo: true,
        };
        this.io.to(GAME_ROOM).emit('betPlaced', broadcast);
      }
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

    try {
      if (user && !client.data.isDemo) {
        // ── Authenticated real-money cashout ───────────────────────────
        const bet = await this.gameBetService.cashOut(
          user.id,
          roundId,
          currentMultiplier,
        );

        const wallet = await this.walletService.getWallet(user.id);
        client.data.isDemo = false;
        const ack: CashOutAckPayload = {
          success: true,
          multiplier: currentMultiplier,
          payoutCents: bet.payoutCents ?? 0,
        };
        client.emit('cashOutAck', ack);
        client.to(ROOMS.user(user.id)).emit('walletUpdated', {
          balanceCents: wallet.balanceCents,
        });

        const broadcast: BetCashedOutPayload = {
          username: user.displayName ?? user.email.split('@')[0],
          multiplier: currentMultiplier,
          payoutCents: bet.payoutCents ?? 0,
          isDemo: false,
        };
        this.io.to(GAME_ROOM).emit('betCashedOut', broadcast);
      } else {
        // ── Demo cashout ───────────────────────────────────────────────
        const { bet, wallet } = await this.demoService.cashOutDemo(
          client.id,
          roundId,
          currentMultiplier,
        );

        client.data.isDemo = false;
        const ack: CashOutAckPayload = {
          success: true,
          multiplier: currentMultiplier,
          payoutCents: bet.payoutCents,
        };
        client.emit('cashOutAck', ack);
        client.emit('walletUpdated', { balanceCents: wallet.balanceCents });

        const broadcast: BetCashedOutPayload = {
          username: bet.username ?? wallet.username,
          multiplier: currentMultiplier,
          payoutCents: bet.payoutCents ?? 0,
          isDemo: true,
        };
        this.io.to(GAME_ROOM).emit('betCashedOut', broadcast);
      }
    } catch (err) {
      const message =
        err instanceof BadRequestException
          ? (err.getResponse() as { message: string }).message
          : 'Failed to cash out';
      client.emit('cashOutAck', { success: false, error: message });
    }
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

  // ── Auto-cashout ──────────────────────────────────────────────────────────

  async #storeAutoCashOut(
    roundId: string,
    userId: string,
    username: string,
    autoCashOutAt: number,
  ): Promise<void> {
    const key = `game:auto-cashout:${roundId}`;
    await this.redis.hset(
      key,
      userId,
      JSON.stringify({ username, autoCashOutAt }),
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

    // ── Real-money auto-cashouts ──────────────────────────────────────────
    const entries = await this.redis.hgetall(key);
    for (const [userId, raw] of Object.entries(entries)) {
      const { username, autoCashOutAt } = JSON.parse(raw) as {
        username: string;
        autoCashOutAt: number;
      };
      if (autoCashOutAt > multiplier) continue;

      try {
        const cashOutAt = Math.min(multiplier, autoCashOutAt);
        const bet = await this.gameBetService.cashOut(
          userId,
          roundId,
          cashOutAt,
        );
        await this.redis.hdel(key, userId);

        const wallet = await this.walletService.getWallet(userId);
        this.io.to(ROOMS.user(userId)).emit('walletUpdated', {
          balanceCents: wallet.balanceCents,
        });

        const broadcast: BetCashedOutPayload = {
          username,
          multiplier: cashOutAt,
          payoutCents: bet.payoutCents ?? 0,
          isDemo: false,
        };
        this.io.to(GAME_ROOM).emit('betCashedOut', broadcast);
      } catch {
        // Bet may already be cashed out or round ended — skip silently
      }
    }

    // ── Demo auto-cashouts ────────────────────────────────────────────────
    const demoBets = await this.demoService.getAutoCashOutDemoBets(
      roundId,
      multiplier,
    );
    for (const { socketId, bet: demoBet } of demoBets) {
      try {
        const demoCashOutAt = Math.min(
          multiplier,
          demoBet.autoCashOutAt ?? multiplier,
        );
        const { bet: cashedBet, wallet } = await this.demoService.cashOutDemo(
          socketId,
          roundId,
          demoCashOutAt,
        );

        this.server?.sockets.sockets.get(socketId)?.emit('walletUpdated', {
          balanceCents: wallet.balanceCents,
        });

        const broadcast: BetCashedOutPayload = {
          username: demoBet.username ?? wallet.username,
          multiplier: demoCashOutAt,
          payoutCents: cashedBet.payoutCents ?? 0,
          isDemo: true,
        };
        this.io.to(GAME_ROOM).emit('betCashedOut', broadcast);
      } catch {
        // Already cashed out — skip
      }
    }
  }
}
