import { CrashEngineService } from '../engine/crash-engine.service.js';
import type { GameRoundStatePayload } from '../game.events.js';
import { GameMath } from '../game.math.js';
import { GameRoundStatus } from '../schema/game-round.schema.js';
import { GameBetService } from './game-bet.service.js';
import { GameRoundService } from './game-round.service.js';

/**
 * The lobby's read model: one object describing the whole game as it stands.
 *
 * Split out of `GameGateway` because it is a projection rather than transport - it
 * composes the engine's in-memory clock with the database's round and bets, and
 * nothing about it needs a socket. The gateway sends it on connect; anything else
 * that needs the same view can ask for it without going through a WebSocket.
 */
export class GameStateService {
  constructor(
    private readonly engine: CrashEngineService,
    private readonly rounds: GameRoundService,
    private readonly bets: GameBetService,
  ) {}

  snapshot(): GameRoundStatePayload {
    const round = this.rounds.getCurrentRound();
    const phase = this.engine.phase ?? GameRoundStatus.WAITING;
    const recent = this.rounds.getRecentCrashes(15);

    const activeBets =
      round === undefined
        ? []
        : this.bets.findByRoundWithPlayers(round.id).map((bet) => ({
            userId: bet.userId,
            username: bet.playerName,
            betAmountCents: bet.betAmountCents,
            isDemo: bet.isDemo,
            ...(bet.cashedOutAtX100 === null
              ? {}
              : { cashedOutAt: GameMath.toMultiplier(bet.cashedOutAtX100) }),
            ...(bet.payoutCents === null
              ? {}
              : { payoutCents: bet.payoutCents }),
          }));

    const multiplierX100 = this.engine.currentMultiplierX100();

    return {
      phase,
      roundId: round?.id ?? null,
      seedHash: round?.seedHash ?? null,
      // Spread rather than assigned: `exactOptionalPropertyTypes` separates an
      // absent key from an explicit `undefined`, and the payload declares the
      // former.
      ...(round === undefined ? {} : { nonce: round.nonce }),
      recentCrashes: recent.flatMap((r) =>
        r.crashPointX100 === null
          ? []
          : [
              {
                roundId: r.id,
                crashPoint: GameMath.toMultiplier(r.crashPointX100),
              },
            ],
      ),
      activeBets,
      ...(multiplierX100 === null
        ? {}
        : {
            multiplier: GameMath.toMultiplier(multiplierX100),
            elapsed:
              round?.startedAt == null
                ? 0
                : Date.now() - round.startedAt.getTime(),
          }),
      ...(phase === GameRoundStatus.WAITING && round?.waitingEndsAt != null
        ? { waitingEndsAt: round.waitingEndsAt.toISOString() }
        : {}),
    };
  }
}
