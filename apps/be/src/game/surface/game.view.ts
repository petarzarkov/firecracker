import type {
  ActiveBetView,
  CrashedRoundSummary,
} from '@firecracker/contracts';
import type { GameBet, GameRound } from '../dto/game.dto.js';
import { GameMath } from '../game.math.js';
import type {
  BetWithCrash,
  BetWithPlayer,
} from '../repos/game-bet.repository.js';
import {
  GameRoundStatus,
  type GameRoundRow,
} from '../schema/game-round.schema.js';

/**
 * What a round and a bet look like on the wire, decided once.
 *
 * ## Why this is a file and not three copies
 *
 * It was three: `GameController.#mapRound`, `GameController.#mapBet` and
 * `GameStateService.snapshot` each did their own `crashPointX100 === null ? {} : {
 * crashPoint: … }` dance, over the same rows, for the same reason. The controller's
 * own comment called that conditional "the fairness guarantee expressed in one
 * place" while two other copies of it existed - and the rule it states is the one
 * that must not be forgotten by a fourth caller: **the server seed and the crash
 * point are absent until the round has CRASHED.** A `RUNNING` round already holds
 * its `crash_point_x100`, drawn at the launch, so a projection that returned it
 * unconditionally would hand a player the outcome of the round they are betting in.
 *
 * Pure statics, no provider. Every method takes a row and returns a payload, so it
 * is unit-testable and cannot reach a database by accident.
 *
 * The spreads are not stylistic: `exactOptionalPropertyTypes` separates an absent
 * key from an explicit `undefined`, and the payloads declare the former.
 */
export class GameView {
  /**
   * A round as a client may see it.
   *
   * `seedHash` is present from the start - that is the commitment. `seed` and
   * `crashPoint` are attached only once the status is CRASHED.
   */
  static round(round: GameRoundRow): GameRound {
    return {
      id: round.id,
      status: round.status,
      seedHash: round.seedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      rngAlgorithm: round.rngAlgorithm,
      waitingEndsAt: round.waitingEndsAt?.toISOString() ?? null,
      startedAt: round.startedAt?.toISOString() ?? null,
      crashedAt: round.crashedAt?.toISOString() ?? null,
      createdAt: round.createdAt.toISOString(),
      // Both halves or neither, and only after the crash. This is the one line
      // this file exists to have exactly once.
      ...(round.status === GameRoundStatus.CRASHED &&
      round.crashPointX100 !== null
        ? {
            seed: round.seed,
            crashPoint: GameMath.toMultiplier(round.crashPointX100),
          }
        : {}),
    };
  }

  /**
   * A bet as its owner may see it.
   *
   * `crashPoint` is the *round's*, and the repository only reads it for rounds that
   * have crashed - so the absence here follows the same rule as {@link GameView.round}
   * without this having to re-check a status it cannot see.
   */
  static bet(bet: BetWithCrash): GameBet {
    return {
      id: bet.id,
      roundId: bet.roundId,
      userId: bet.userId,
      betAmountCents: bet.betAmountCents,
      status: bet.status,
      cashedOutAt:
        bet.cashedOutAtX100 === null
          ? null
          : GameMath.toMultiplier(bet.cashedOutAtX100),
      payoutCents: bet.payoutCents,
      isDemo: bet.isDemo,
      createdAt: bet.createdAt.toISOString(),
      ...(bet.crashPointX100 === null
        ? {}
        : { crashPoint: GameMath.toMultiplier(bet.crashPointX100) }),
    };
  }

  /** One row of the lobby's bet list. `userId` is what the client keys rows on. */
  static activeBet(bet: BetWithPlayer): ActiveBetView {
    return {
      userId: bet.userId,
      username: bet.playerName,
      betAmountCents: bet.betAmountCents,
      isDemo: bet.isDemo,
      ...(bet.cashedOutAtX100 === null
        ? {}
        : { cashedOutAt: GameMath.toMultiplier(bet.cashedOutAtX100) }),
      ...(bet.payoutCents === null ? {} : { payoutCents: bet.payoutCents }),
    };
  }

  /** The crash-history strip. A round without a crash point is not in it. */
  static recentCrashes(
    rounds: readonly GameRoundRow[],
  ): readonly CrashedRoundSummary[] {
    return rounds.flatMap((round) =>
      round.crashPointX100 === null
        ? []
        : [
            {
              roundId: round.id,
              crashPoint: GameMath.toMultiplier(round.crashPointX100),
            },
          ],
    );
  }
}
