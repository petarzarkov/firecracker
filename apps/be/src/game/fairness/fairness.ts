import { Rng, type RngAlgorithm } from '@arkv/rng';

/**
 * Everything a player re-runs to check us, in one file with no container behind it.
 *
 * It was spread over two: `GameMath` held the seed string and the draw, and
 * `GameRoundService` held the server seed, the commitment and the client-seed
 * combination - so the fairness contract was half arithmetic and half lifecycle,
 * and the dividing line was "does it need injecting" rather than "is it part of
 * the promise". Every input to a published crash point is here now, and
 * `game.math.ts` keeps the curve and the money.
 *
 * The order these are called in is the guarantee, and it is not free to change:
 * {@link Fairness.serverSeed} and {@link Fairness.commit} at creation, player
 * contributions during the betting window, {@link Fairness.combine} and only then
 * {@link Fairness.crashPointX100} at the launch. Drawing earlier means the
 * players could not have influenced it; drawing later means we chose it knowing
 * the bets. `ClientSeedService` owns the middle of that sequence.
 */
export class Fairness {
  /**
   * The default draw algorithm. Written onto every round row as `rngAlgorithm`, so
   * changing this constant cannot retroactively break the verification of a round
   * that was drawn with the old one.
   */
  static readonly DEFAULT_ALGORITHM: RngAlgorithm = 'pcg64';

  /** Probability of an instant 1.00x crash. This is the house edge. */
  static readonly #INSTANT_CRASH_PROBABILITY = 0.03;

  /** The numerator in `P(crash >= x) ~ HOUSE_EDGE / x`. */
  static readonly #HOUSE_EDGE_NUMERATOR = 99;

  /**
   * 32 bytes from the platform CSPRNG.
   *
   * **Deliberately not `@arkv/rng`.** This value is published after the round
   * crashes, and every algorithm that package offers is a non-cryptographic PRNG
   * whose internal state is recoverable from a handful of outputs. A player
   * collecting revealed seeds could then predict every future crash point. The
   * draw below is seeded *from* this and may be a PRNG precisely because it is
   * reproducible on purpose; this one must not be.
   */
  static serverSeed(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('hex');
  }

  /**
   * The commitment: `SHA256(seed)`, published before the round starts so a player
   * can check afterwards that the seed was not swapped for a more convenient one.
   */
  static commit(serverSeed: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(serverSeed);
    return hasher.digest('hex');
  }

  /**
   * Every player's seed folded into one value.
   *
   * Sorted before hashing so the result cannot depend on the order submissions
   * happened to arrive in - otherwise a player who could influence arrival order
   * could influence the outcome.
   *
   * An empty pool is the constant `'firecracker'`, which is legitimate for an idle
   * lobby and a catastrophe for a round whose seeds simply could not be read - see
   * `ClientSeedService.collect`, which is why that returns `null` rather than `{}`.
   */
  static combine(seeds: readonly string[]): string {
    if (seeds.length === 0) return 'firecracker';
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update([...seeds].sort().join(':'));
    return hasher.digest('hex');
  }

  /**
   * A random 16-byte client seed, contributed on a player's behalf when they place
   * a bet without submitting one of their own.
   *
   * `@arkv/rng` here and not for the server seed: this value is public the moment
   * it is used, it only has to vary, and nothing about the game's security rests
   * on it being unpredictable.
   */
  static autoClientSeed(): string {
    const rng = new Rng();
    try {
      const words = rng.ints(4);
      return Array.from(words, (w) => w.toString(16).padStart(8, '0')).join('');
    } finally {
      rng.free();
    }
  }

  /**
   * The seed string a round's crash point is drawn from. Public after the crash, and
   * the exact input a player re-runs to check us - so its format is part of the
   * fairness contract and must not be "tidied up" later.
   */
  static seedString(
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
    algorithm: RngAlgorithm = Fairness.DEFAULT_ALGORITHM,
  ): number {
    const rng = new Rng(
      Fairness.seedString(serverSeed, clientSeed, nonce),
      algorithm,
    );
    try {
      // One draw decides both the instant crash and the multiplier, so the two
      // cannot disagree and the verifier only has to reproduce a single `float()`.
      const u = rng.float();
      if (u < Fairness.#INSTANT_CRASH_PROBABILITY) return 100;

      // `1 - u` is in (0, 0.97], so the division cannot be by zero and the result
      // is bounded - a `u` of exactly 0 would otherwise be an infinite multiplier.
      return Math.max(
        100,
        Math.floor(Fairness.#HOUSE_EDGE_NUMERATOR / (1 - u)),
      );
    } finally {
      // WebAssembly memory is not garbage collected for us. One instance per round
      // is nothing, but this runs on a schedule forever.
      rng.free();
    }
  }
}
