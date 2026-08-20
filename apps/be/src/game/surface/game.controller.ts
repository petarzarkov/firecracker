import {
  Controller,
  Get,
  HttpError,
  HttpStatusCode,
  Public,
  type Input,
} from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import type { Page } from '@dunx/infra/pagination';
import { CurrentUser } from '../../auth/services/current-user.service.js';
import {
  gameState,
  listMyBets,
  listRounds,
  oneRound,
  verifyRound,
  type CurrentRound,
  type GameBet,
  type GameRound,
  type RoundVerification,
} from './game.dto.js';
import { CrashEngineService } from '../engine/crash-engine.service.js';
import { GameMath } from '../game.math.js';
import { GameView } from './game.view.js';
import { GameBetService } from '../betting/game-bet.service.js';
import { GameRoundService } from '../rounds/game-round.service.js';

/**
 * How a player checks a round without trusting us. Written out on the response
 * rather than in prose somewhere, so the instructions travel with the data.
 */
const HOW_TO_VERIFY = [
  '1. Check the commitment: SHA256(serverSeed) must equal serverSeedHash.',
  '2. Rebuild the generator seed: `${serverSeed}:${clientSeed}:${nonce}` (this is `rngSeed`).',
  '3. Draw once: `new Rng(rngSeed, algorithm).float()` using @arkv/rng.',
  '4. u < 0.03  -> crashPoint = 1.00',
  '   otherwise -> crashPoint = max(100, floor(99 / (1 - u))) / 100',
];

@ApiDoc({
  tags: ['game'],
  description: 'The crash game: rounds, history and provable fairness.',
})
@Controller('game')
export class GameController {
  constructor(
    private readonly rounds: GameRoundService,
    private readonly bets: GameBetService,
    private readonly engine: CrashEngineService,
    private readonly caller: CurrentUser,
  ) {}

  /**
   * The live view. `@Public()` because watching is what a visitor does before
   * signing up - the same reason the socket upgrade admits anonymous callers.
   */
  @ApiDoc({ tags: ['game'], summary: 'The round in progress' })
  @Public()
  @Get('/state', gameState)
  state(): CurrentRound {
    const round = this.rounds.getCurrentRound();
    if (round === undefined) {
      throw new HttpError(
        HttpStatusCode.SERVICE_UNAVAILABLE,
        'No round is in progress',
      );
    }

    const view = GameView.round(round);
    const multiplierX100 = this.engine.currentMultiplierX100();
    if (multiplierX100 === null) return view;

    return {
      ...view,
      multiplier: GameMath.toMultiplier(multiplierX100),
      elapsed:
        round.startedAt === null ? 0 : Date.now() - round.startedAt.getTime(),
    };
  }

  @ApiDoc({ tags: ['game'], summary: 'Round history, keyset paginated' })
  @Public()
  @Get('/rounds', listRounds)
  async list(input: Input<typeof listRounds>): Promise<Page<GameRound>> {
    const page = await this.rounds.list(input.query);
    return { ...page, data: page.data.map(GameView.round) };
  }

  @ApiDoc({ tags: ['game'], summary: 'One round by id' })
  @Public()
  @Get('/rounds/:roundId', oneRound)
  one(input: Input<typeof oneRound>): GameRound {
    const round = this.rounds.getById(input.params.roundId);
    if (round === undefined) {
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'Round not found');
    }
    return GameView.round(round);
  }

  /**
   * The reveal. 404 before the crash rather than an empty body: handing out the
   * server seed while bets are open would let anyone read the outcome.
   */
  @ApiDoc({
    tags: ['game'],
    summary: 'Provably-fair inputs for a crashed round',
  })
  @Public()
  @Get('/rounds/:roundId/verify', verifyRound)
  verify(input: Input<typeof verifyRound>): RoundVerification {
    const proof = this.rounds.verification(input.params.roundId);
    if (proof === undefined) {
      throw new HttpError(
        HttpStatusCode.NOT_FOUND,
        'That round has not crashed yet, so there is nothing to verify',
      );
    }

    return {
      roundId: proof.roundId,
      serverSeed: proof.serverSeed,
      serverSeedHash: proof.serverSeedHash,
      clientSeed: proof.clientSeed,
      nonce: proof.nonce,
      algorithm: proof.algorithm,
      rngSeed: proof.rngSeed,
      crashPoint: GameMath.toMultiplier(proof.crashPointX100),
      howToVerify: HOW_TO_VERIFY,
    };
  }

  @ApiDoc({ tags: ['game'], summary: 'My bet history' })
  @Get('/my-bets', listMyBets)
  async myBets(input: Input<typeof listMyBets>): Promise<Page<GameBet>> {
    const page = await this.bets.listByUser(
      this.caller.require().id,
      input.query,
    );
    return { ...page, data: page.data.map(GameView.bet) };
  }
}
