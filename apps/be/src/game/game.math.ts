/**
 * The curve and the money, in **integer hundredths** throughout: `1.07x` is `107`.
 * What a player re-runs to verify a round is `fairness.ts`, because that is a
 * contract with the player rather than arithmetic we happen to do.
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
   * `e^(elapsed / divisor)`, truncated to hundredths. `Math.floor`, not `round`:
   * rounding up shows a player a multiplier the round never reached, and the number
   * on screen is the number they are paid.
   */
  static multiplierAtX100(elapsedMs: number, divisor: number): number {
    return Math.floor(Math.exp(elapsedMs / divisor) * 100);
  }

  /**
   * `floor(stake * multiplier)`, in integer space throughout - against a float
   * multiplier a 100-cent bet at a "2.00x" that is really 1.9999999999999998 pays
   * 199. Multiplying by the hundredths integer first cannot do that.
   */
  static payoutCents(betAmountCents: number, multiplierX100: number): number {
    return Math.floor((betAmountCents * multiplierX100) / 100);
  }
}
