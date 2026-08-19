import { Rng, type RngAlgorithm } from '@arkv/rng';

/**
 * The arithmetic of the game, with no container behind it so it can be unit-tested on
 * its own.
 *
 * Everything works in **integer hundredths** of a multiplier: `1.07x` is `107`. See
 * `game-round.schema.ts` for why storage does the same.
 */
export class GameMath {
  /**
   * The default draw algorithm. Written onto every round row as `rngAlgorithm`, so
   * changing this constant cannot retroactively break the verification of a round
   * that was drawn with the old one.
   */
  static readonly DEFAULT_RNG_ALGORITHM: RngAlgorithm = 'pcg64';

  /** Probability of an instant 1.00x crash. This is the house edge. */
  static readonly #INSTANT_CRASH_PROBABILITY = 0.03;

  /** The numerator in `P(crash >= x) ~ HOUSE_EDGE / x`. */
  static readonly #HOUSE_EDGE_NUMERATOR = 99;

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

  /**
   * The seed string a round's crash point is drawn from. Public after the crash, and
   * the exact input a player re-runs to check us - so its format is part of the
   * fairness contract and must not be "tidied up" later.
   */
  static fairnessSeed(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
  ): string {
    return `${serverSeed}:${clientSeed}:${nonce}`;
  }

  /**
   * The crash point, in hundredths, drawn deterministically from the three published
   * values.
   *
   * A seeded PRNG rather than a hash. The Postgres version ran HMAC-SHA256 and then
   * `parseInt(hash.slice(0, 13), 16)` - 52 bits of a 256-bit digest, with the
   * house-edge test riding on the low bits of that slice, so the uniformity was
   * incidental. `@arkv/rng` seeds from a string and draws with unbiased rejection
   * sampling, so `float()` is uniform by construction.
   *
   * **Still provably fair**: everything the draw consumes is published at the crash,
   * so a player reproduces this exact number. The distribution is unchanged - ~3%
   * instant crash, `P(crash >= x) ~ 0.99 / x` above it.
   */
  static crashPointX100(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
    algorithm: RngAlgorithm = GameMath.DEFAULT_RNG_ALGORITHM,
  ): number {
    const rng = new Rng(
      GameMath.fairnessSeed(serverSeed, clientSeed, nonce),
      algorithm,
    );
    try {
      // One draw decides both the instant crash and the multiplier, so the two
      // cannot disagree and the verifier only has to reproduce a single `float()`.
      const u = rng.float();
      if (u < GameMath.#INSTANT_CRASH_PROBABILITY) return 100;

      // `1 - u` is in (0, 0.97], so the division cannot be by zero and the result
      // is bounded - a `u` of exactly 0 would otherwise be an infinite multiplier.
      return Math.max(
        100,
        Math.floor(GameMath.#HOUSE_EDGE_NUMERATOR / (1 - u)),
      );
    } finally {
      // WebAssembly memory is not garbage collected for us. One instance per round
      // is nothing, but this runs on a schedule forever.
      rng.free();
    }
  }
}
