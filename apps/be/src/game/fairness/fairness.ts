import { Rng, type RngAlgorithm } from '@arkv/rng';

/**
 * Everything a player re-runs to check us, with no container behind it.
 *
 * The call order is the fairness guarantee and is not free to change - see
 * CLAUDE.md, "The order of a round is the fairness guarantee".
 */
export class Fairness {
  /**
   * Written onto every round row as `rngAlgorithm`, so changing this constant
   * cannot retroactively break the verification of an older round.
   */
  static readonly DEFAULT_ALGORITHM: RngAlgorithm = 'pcg64';

  /** Probability of an instant 1.00x crash. This is the house edge. */
  static readonly #INSTANT_CRASH_PROBABILITY = 0.03;

  /** The numerator in `P(crash >= x) ~ HOUSE_EDGE / x`. */
  static readonly #HOUSE_EDGE_NUMERATOR = 99;

  /**
   * 32 bytes from the platform CSPRNG, **deliberately not `@arkv/rng`**: this is
   * published after the crash, and every algorithm that package offers is a
   * non-cryptographic PRNG whose state is recoverable from a few outputs - so a
   * player collecting revealed seeds could predict every future crash point.
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
   * Every player's seed folded into one value. Sorted before hashing so a player
   * who could influence arrival order cannot influence the outcome.
   *
   * An empty pool is the constant `'firecracker'` - legitimate for an idle lobby,
   * a fairness hole for a round whose seeds could not be *read*, which is why
   * `ClientSeedService.collect` returns `null` rather than `{}`.
   */
  static combine(seeds: readonly string[]): string {
    if (seeds.length === 0) return 'firecracker';
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update([...seeds].sort().join(':'));
    return hasher.digest('hex');
  }

  /**
   * A client seed contributed for a player who submitted none. `@arkv/rng` is fine
   * here where it is not for the server seed: this is public the moment it is used
   * and only has to vary.
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
   * The exact input a player re-runs to check us, so this format is part of the
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
   * The crash point in hundredths, drawn deterministically from the three values
   * published at the crash. A seeded PRNG rather than a hash slice: `float()` is
   * uniform by construction, where taking 52 bits of a digest is uniform by luck.
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
