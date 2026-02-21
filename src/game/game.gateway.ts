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
import { IsInt, Min } from 'class-validator';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { RedisService } from '@/infra/redis/services/redis.service';
import {
  BetAckPayload,
  BetCashedOutPayload,
  BetPlacedPayload,
  CashOutAckPayload,
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

  constructor(
    private readonly crashEngine: CrashEngineService,
    private readonly gameBetService: GameBetService,
    private readonly gameRoundService: GameRoundService,
    private readonly demoService: DemoService,
    private readonly walletService: WalletService,
    private readonly redisService: RedisService,
    private readonly logger: ContextLogger,
  ) {}

  onModuleInit(): void {
    if (!this.server) {
      // Worker process: no real Socket.io server — emit via Redis.
      const redisClient = this.redisService.newConnection('game-emitter', {
        db: 4,
      });
      this.emitter = new Emitter(redisClient);
      this.io = this.emitter;
    } else {
      // Main process: use real server and wire the tick broadcast callback.
      this.io = this.server;
      this.crashEngine.registerTickEmitter((multiplier, elapsed) => {
        this.emitTick({ multiplier, elapsed });
      });
    }
  }

  async handleConnection(client: ExtendedSocket): Promise<void> {
    // Join the game broadcast room
    await client.join(GAME_ROOM);

    // Send current game state to the newly connected client
    try {
      const round = await this.gameRoundService.getCurrentRound();
      const phase = this.crashEngine.getCurrentPhase();
      const bets = round
        ? await this.gameBetService.findByRoundId(round.id)
        : [];

      const payload: GameRoundStatePayload = {
        phase: phase ?? 'waiting',
        roundId: round?.id ?? null,
        seedHash: round?.seedHash ?? null,
        activeBets: bets.map(b => ({
          username: b.userId, // resolved to username in future enhancement
          betAmountCents: b.betAmountCents,
          isDemo: false,
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
      if (user) {
        // ── Authenticated real-money bet ───────────────────────────────
        const bet = await this.gameBetService.placeBet(
          user.id,
          roundId,
          data.betAmountCents,
          () => {}, // placeholder — phase already validated above
        );

        const wallet = await this.walletService.getWallet(user.id);
        client.emit('betAck', { success: true });
        client.to(ROOMS.user(user.id)).emit('walletUpdated', {
          balanceCents: wallet.balanceCents,
        });

        const broadcast: BetPlacedPayload = {
          username: user.displayName ?? user.email.split('@')[0],
          betAmountCents: bet.betAmountCents,
          isDemo: false,
        };
        this.io.to(GAME_ROOM).emit('betPlaced', broadcast);
      } else {
        // ── Demo / guest bet ───────────────────────────────────────────
        const { bet, wallet } = await this.demoService.placeDemoBet(
          client.id,
          roundId,
          data.betAmountCents,
        );
        const demoWallet = wallet;

        client.emit('betAck', { success: true });
        client.emit('walletUpdated', { balanceCents: demoWallet.balanceCents });

        const broadcast: BetPlacedPayload = {
          username: demoWallet.username,
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

    if (phase !== GameRoundStatus.RUNNING) {
      const ack: CashOutAckPayload = {
        success: false,
        error: 'Round is not currently running',
      };
      client.emit('cashOutAck', ack);
      return;
    }

    if (!roundId) {
      client.emit('cashOutAck', { success: false, error: 'No active round' });
      return;
    }

    // Capture the multiplier SYNCHRONOUSLY before any async operation
    let currentMultiplier: number;
    try {
      currentMultiplier = this.crashEngine.getCurrentMultiplier();
    } catch {
      client.emit('cashOutAck', {
        success: false,
        error: 'Round ended — too late to cash out',
      });
      return;
    }

    try {
      if (user) {
        // ── Authenticated cashout ──────────────────────────────────────
        const bet = await this.gameBetService.cashOut(
          user.id,
          roundId,
          currentMultiplier,
        );

        const wallet = await this.walletService.getWallet(user.id);
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

        const ack: CashOutAckPayload = {
          success: true,
          multiplier: currentMultiplier,
          payoutCents: bet.payoutCents,
        };
        client.emit('cashOutAck', ack);
        client.emit('walletUpdated', { balanceCents: wallet.balanceCents });

        const broadcast: BetCashedOutPayload = {
          username: wallet.username,
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
}
