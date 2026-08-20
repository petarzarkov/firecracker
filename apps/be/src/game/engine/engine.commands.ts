/** Where a round transition tells the clock what the round just became. */
export const GAME_ENGINE_CHANNEL = 'game:engine:commands';

/**
 * What a round transition publishes on {@link GAME_ENGINE_CHANNEL}.
 *
 * The job handlers own the database transitions and `CrashEngineService` owns the
 * clock, so this is the only thing crossing between them. It is a **loopback**
 * publish today - one process does both - and it is kept because it is also the
 * recovery path: an engine that missed a command rebuilds its state from
 * `game_round` at boot regardless.
 *
 * Its own file so `rounds/round.jobs.ts` can name a channel without importing the
 * engine. A const and a type carry no dependency, but the import read like one, and
 * `GameRoundsModule` must not look as though it reaches the clock.
 *
 * Note `crashPointX100`: the command carries hundredths like everything else, so
 * the engine's comparison never leaves integer space.
 */
export type EngineCommand =
  | { action: 'waiting'; roundId: string }
  | {
      action: 'start';
      roundId: string;
      crashPointX100: number;
      startedAt: string;
    }
  | { action: 'crash' };
