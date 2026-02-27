import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiJwtAuth } from '@/core/decorators/api-jwt-auth.decorator';
import { CurrentUser } from '@/core/decorators/current-user.decorator';
import { Public } from '@/core/decorators/public.decorator';
import { UuidParam } from '@/core/decorators/uuid-param.decorator';
import { PageDto } from '@/core/pagination/dto/page.dto';
import { PaginatedDto } from '@/core/pagination/dto/paginated.dto';
import { SanitizedUser } from '@/users/entity/user.entity';
import { GameBetResponseDto, ListMyBetsQueryDto } from './dto/game-bet.dto';
import {
  CurrentRoundResponseDto,
  GameRoundResponseDto,
  ListRoundsQueryDto,
  VerifyRoundResponseDto,
} from './dto/game-round.dto';
import { CrashEngineService } from './engine/crash-engine.service';
import { GameBet } from './entity/game-bet.entity';
import { GameRound } from './entity/game-round.entity';
import { GameRoundStatus } from './enum/game-round-status.enum';
import { GameBetService } from './services/game-bet.service';
import { GameRoundService } from './services/game-round.service';

const VERIFY_FORMULA = [
  '1. assert SHA256(serverSeed) === seedHash',
  '2. hash = HMAC-SHA256(key=serverSeed, msg=clientSeed + ":" + nonce)',
  '3. h = parseInt(hash.slice(0, 13), 16)',
  '4. e = 2 ** 52',
  '5. if h % 33 === 0 → crashPoint = 1.00',
  '   else → crashPoint = Math.max(1.0, Math.floor((99 * e) / (e - h)) / 100)',
].join('\n');

@ApiTags('game')
@Controller('game')
export class GameController {
  constructor(
    private readonly gameRoundService: GameRoundService,
    private readonly gameBetService: GameBetService,
    private readonly crashEngine: CrashEngineService,
  ) {}

  @Get('state')
  @Public()
  @ApiOperation({ summary: 'Get current round state and your active bet' })
  @ApiOkResponse({ type: CurrentRoundResponseDto })
  async getCurrentState(): Promise<CurrentRoundResponseDto> {
    const round = await this.gameRoundService.getCurrentRound();
    const phase = this.crashEngine.getCurrentPhase();

    if (!round) {
      return {
        id: '',
        status: GameRoundStatus.WAITING,
        seedHash: '',
        nonce: 0,
        createdAt: new Date(),
      };
    }

    const dto: CurrentRoundResponseDto = {
      id: round.id,
      status: round.status,
      seedHash: round.seedHash,
      nonce: Number(round.nonce),
      waitingEndsAt: round.waitingEndsAt ?? undefined,
      startedAt: round.startedAt ?? undefined,
      crashedAt: round.crashedAt ?? undefined,
      createdAt: round.createdAt,
      // Reveal seed + clientSeed + crashPoint only after crash (provably fair)
      ...(round.status === GameRoundStatus.CRASHED && {
        seed: round.seed,
        clientSeed: round.clientSeed ?? 'firecracker',
        crashPoint: Number(round.crashPoint),
      }),
    };

    if (phase === GameRoundStatus.RUNNING) {
      try {
        dto.multiplier = this.crashEngine.getCurrentMultiplier();
        dto.elapsed = round.startedAt
          ? Date.now() - round.startedAt.getTime()
          : 0;
      } catch {
        // engine not running
      }
    }

    return dto;
  }

  @Get('rounds')
  @Public()
  @ApiOperation({ summary: 'Paginated history of completed rounds' })
  @ApiOkResponse({ type: PaginatedDto(GameRound) })
  async getRoundHistory(
    @Query() query: ListRoundsQueryDto,
  ): Promise<PageDto<GameRoundResponseDto>> {
    const page = await this.gameRoundService.getRoundHistory(query);
    return {
      ...page,
      data: page.data.map(r => this.#mapRound(r)),
    };
  }

  @Get('rounds/:id')
  @Public()
  @ApiOperation({ summary: 'Get a specific round by ID' })
  @ApiOkResponse({ type: GameRoundResponseDto })
  async getRound(
    @UuidParam({ name: 'id' }) id: string,
  ): Promise<GameRoundResponseDto | null> {
    const round = await this.gameRoundService.findById(id);
    return round ? this.#mapRound(round) : null;
  }

  @Get('verify/:id')
  @Public()
  @ApiOperation({
    summary: 'Provably fair verification data for a crashed round',
    description:
      'Returns all inputs required to independently verify the crash point. ' +
      'Only available for CRASHED rounds.',
  })
  @ApiOkResponse({ type: VerifyRoundResponseDto })
  async verifyRound(
    @UuidParam({ name: 'id' }) id: string,
  ): Promise<VerifyRoundResponseDto> {
    const round = await this.gameRoundService.findById(id);

    if (!round) throw new NotFoundException(`Round ${id} not found`);

    if (round.status !== GameRoundStatus.CRASHED) {
      throw new NotFoundException(
        `Round ${id} has not crashed yet — verification is only available after crash`,
      );
    }

    return {
      roundId: round.id,
      serverSeed: round.seed,
      clientSeed: round.clientSeed ?? 'firecracker',
      nonce: Number(round.nonce),
      crashPoint: Number(round.crashPoint),
      formula: VERIFY_FORMULA,
    };
  }

  @Get('my-bets')
  @ApiJwtAuth()
  @ApiOperation({ summary: 'My bet history' })
  @ApiOkResponse({ type: PaginatedDto(GameBet) })
  async getMyBets(
    @CurrentUser() user: SanitizedUser,
    @Query() query: ListMyBetsQueryDto,
  ): Promise<PageDto<GameBetResponseDto>> {
    const page = await this.gameBetService.getUserBets(user.id, query);
    return {
      ...page,
      data: page.data.map(b => this.#mapBet(b)),
    };
  }

  #mapRound(r: GameRound): GameRoundResponseDto {
    return {
      id: r.id,
      status: r.status,
      seedHash: r.seedHash,
      nonce: Number(r.nonce),
      waitingEndsAt: r.waitingEndsAt ?? undefined,
      startedAt: r.startedAt ?? undefined,
      crashedAt: r.crashedAt ?? undefined,
      createdAt: r.createdAt,
      // Expose clientSeed always (it's public), expose seed+crashPoint only after crash
      clientSeed: r.clientSeed ?? undefined,
      ...(r.status === GameRoundStatus.CRASHED && {
        seed: r.seed,
        crashPoint: Number(r.crashPoint),
      }),
    };
  }

  #mapBet(b: GameBet): GameBetResponseDto {
    return {
      id: b.id,
      roundId: b.roundId,
      userId: b.userId,
      betAmountCents: b.betAmountCents,
      status: b.status,
      cashedOutAt: b.cashedOutAt !== null ? Number(b.cashedOutAt) : undefined,
      payoutCents: b.payoutCents ?? undefined,
      createdAt: b.createdAt,
    };
  }
}
