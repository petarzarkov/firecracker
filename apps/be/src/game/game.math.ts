/**
 * The arithmetic of the game, with no container behind it so it can be unit-tested on
 * its own.
 *
 * Everything works in **integer hundredths** of a multiplier: `1.07x` is `107`. See
 * `game-round.schema.ts` for why storage does the same.
 *
 * The curve and the money only. What a player re-runs to verify a round - the server
 * seed, the commitment, the client-seed combination and the draw - is `fairness.ts`,
 * because that is a contract with the player rather than arithmetic we happen to do.
 */
export class GameMath {
  /** A multiplier as clients see it: `107` becomes `1.07`. */
  static toMultiplier(x100: number): number {
    return x100 / 100;
  }

  /** A multiplier as the database stores it: `1.07` becomes `107`. */
  static fromMultiplier(multiplier: number): number {
    return Math.round(multiplier * 100);
  }

  /**
   * The curve: `e^(elapsed / divisor)`, truncated to two decimals, in hundredths.
   *
   * `Math.floor` rather than `Math.round`, and that is the choice the Postgres
   * version made too: rounding up would occasionally show a player a multiplier the
   * round never actually reached, and the number on screen is the number they are
   * paid.
   */
  static multiplierAtX100(elapsedMs: number, divisor: number): number {
    return Math.floor(Math.exp(elapsedMs / divisor) * 100);
  }

  /**
   * `floor(stake * multiplier)`, in integer space throughout.
   *
   * The old code was `Math.floor(bet.betAmountCents * currentMultiplier)` against a
   * float multiplier, so a 100-cent bet at a "2.00x" that was really
   * 1.9999999999999998 paid 199. Multiplying by the hundredths integer first and
   * dividing once at the end cannot do that.
   */
  static payoutCents(betAmountCents: number, multiplierX100: number): number {
    return Math.floor((betAmountCents * multiplierX100) / 100);
  }
}
