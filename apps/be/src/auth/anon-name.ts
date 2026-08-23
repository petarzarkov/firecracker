/**
 * What to call a "Try Demo" player.
 *
 * better-auth's `anonymous()` names every one of them `Anonymous`, and this game
 * puts `user.name` on a public lobby list, on every bet row and on every chat line.
 * A round with four demo players in it rendered as four identical entries, and a
 * player could not pick their own bet out of them.
 *
 * Deliberately **not** unique. `user.name` carries no constraint - `UQ_user_email`
 * is the only one on the table - and identity everywhere that matters is the id, so
 * a collision is two players who happen to share a name rather than a bug. The
 * numeric suffix is what makes that rare enough to read as two people.
 */

const ADJECTIVES = [
  'Bold',
  'Brave',
  'Calm',
  'Clever',
  'Cosmic',
  'Crimson',
  'Daring',
  'Eager',
  'Electric',
  'Fearless',
  'Fiery',
  'Golden',
  'Happy',
  'Hidden',
  'Jolly',
  'Lucky',
  'Mighty',
  'Nimble',
  'Quiet',
  'Rapid',
  'Restless',
  'Rowdy',
  'Silent',
  'Sly',
  'Solar',
  'Steady',
  'Stormy',
  'Swift',
  'Turbo',
  'Wild',
] as const;

const NOUNS = [
  'Badger',
  'Bandit',
  'Comet',
  'Cobra',
  'Dingo',
  'Falcon',
  'Ferret',
  'Fox',
  'Gecko',
  'Hawk',
  'Heron',
  'Ibex',
  'Jackal',
  'Koala',
  'Lynx',
  'Magpie',
  'Marmot',
  'Meerkat',
  'Otter',
  'Panther',
  'Puffin',
  'Quokka',
  'Raven',
  'Rocket',
  'Shark',
  'Sparrow',
  'Tapir',
  'Viper',
  'Walrus',
  'Wombat',
] as const;

/** The suffix's range: three digits, so the name stays short enough for a bet row. */
const SUFFIX_MIN = 100;
const SUFFIX_SPAN = 900;

/**
 * `crypto.getRandomValues` rather than `@arkv/rng`, which this app otherwise reaches
 * for. A name is not part of the fairness story - it is drawn once, never published
 * as a seed and never replayed - so the reproducibility that makes `@arkv/rng` the
 * right answer for a crash point buys nothing here.
 */
const below = (bound: number): number => {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return (value as number) % bound;
};

const pick = <T>(values: readonly T[]): T => values[below(values.length)] as T;

/** A name of the shape `SwiftOtter482`. */
export const anonymousName = (): string =>
  `${pick(ADJECTIVES)}${pick(NOUNS)}${SUFFIX_MIN + below(SUFFIX_SPAN)}`;
