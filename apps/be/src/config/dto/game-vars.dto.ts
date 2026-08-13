import { z } from 'zod';

/**
 * The crash game's tunables. These were `GAME` in `src/constants.ts` - a frozen
 * literal - and they are environment variables here because every one of them is a
 * number an operator wants to change without a deploy: the betting window, how fast
 * the multiplier climbs, and what a demo wallet starts with.
 *
 * The defaults are the constants the NestJS version shipped with, so an unset
 * environment plays exactly the same game.
 */
export const gameVarsSchema = z.object({
  /** Duration of the betting window before each rocket launches. */
  GAME_WAITING_PHASE_MS: z.coerce.number().int().positive().default(10_000),
  /** Cool-down between the crash and the next betting window. */
  GAME_COOLDOWN_MS: z.coerce.number().int().positive().default(5_000),
  /** How often the multiplier tick is broadcast to clients. */
  GAME_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(100),
  /**
   * Divisor in the `e^(elapsed/DIVISOR)` multiplier curve - smaller climbs faster.
   * Changing this changes the house edge, so it is not a cosmetic knob.
   */
  GAME_MULTIPLIER_DIVISOR: z.coerce.number().int().positive().default(10_000),
  /** Minimum real bet, in cents. */
  GAME_MIN_BET_CENTS: z.coerce.number().int().positive().default(100),
  /** Starting virtual balance for a demo wallet, in cents. */
  GAME_DEMO_INITIAL_BALANCE_CENTS: z.coerce
    .number()
    .int()
    .positive()
    .default(100_000),
  /** How often the stuck-round cleanup job runs. */
  GAME_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(20_000),
  /** A round with no progression for this long is failed and its bets refunded. */
  GAME_STUCK_ROUND_THRESHOLD_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(180_000),
  /**
   * Grace window after a crash in which a cash-out still settles at the crash
   * multiplier, so a player is not punished for their round-trip time.
   */
  GAME_CASHOUT_GRACE_MS: z.coerce.number().int().min(0).default(300),

  /**
   * Simulated players in the lobby.
   *
   * **Off by default, and cosmetic only.** A bot never touches the database, a
   * wallet or the ledger - see `GameBotsService`. It exists so an empty lobby does
   * not look broken, and nothing about the game's outcome depends on it.
   */
  GAME_BOTS_ENABLED: z.stringbool().default(false),
  GAME_BOTS_MIN_PER_ROUND: z.coerce.number().int().min(0).default(2),
  GAME_BOTS_MAX_PER_ROUND: z.coerce.number().int().min(0).default(7),
});
