/**
 * What the lobby's regulars sound like.
 *
 * The bots used to share one persona - "a player in a crash-gambling lobby" - and
 * one prompt that told the model only whether they had won and at what multiple. A
 * model given that writes the same handful of lines forever, and it did: two bots
 * posted `greed got me again` within one round of each other, which is the moment
 * atmosphere becomes obviously generated.
 *
 * Three things fix that, and all three are prompt rather than plumbing: a voice per
 * name so the cast is not one person, the round's actual numbers so there is
 * something specific to say, and the last few lines of the lobby so the model can be
 * told not to repeat what is already on screen.
 */

/**
 * A temperament per regular, keyed by name because the names already imply one -
 * `paperhands` and `diamondhand` are opposites and were saying the same things.
 * Stable per bot: a regular whose voice changed every round would be worse than one
 * with no voice at all.
 */
export const BOT_VOICES = Object.freeze({
  rocketman: 'cocky, talks as though he called the round in advance',
  moonshot: 'greedy, always says he should have held longer',
  diamondhand: 'stubborn, thinks cashing out early is for cowards',
  paperhands: 'jumpy, takes small wins and defends doing it',
  ka_boom: 'gleeful about explosions, enjoys the carnage',
  lucky7: 'superstitious, credits luck, streaks and omens',
  nitro: 'hyper and clipped, types like he is in a hurry',
  bigred: 'gruff and grumbling, nothing is ever good enough',
  cashout_carl: 'smug about small safe wins, quietly pleased with himself',
  fuse: 'quiet and dry, one understated remark and nothing more',
  ember: 'wistful, romantic about near misses',
  skyward: 'relentlessly optimistic, already onto the next round',
  orbit: 'analytical, talks in numbers and averages',
  ignition: 'impatient, wants the next round started already',
  afterburner: 'dramatic, everything is a catastrophe or a triumph',
  gravity: 'fatalistic, says he knew it would fall',
  cinder: 'bitter, blames the game rather than himself',
  blastoff: 'excitable, easily impressed by what other people did',
} as const);

export type BotName = keyof typeof BOT_VOICES;

export const BOT_NAMES = Object.keys(BOT_VOICES) as readonly BotName[];

/**
 * The persona, per bot.
 *
 * The prohibitions are all things a model does unprompted in a gambling context: it
 * explains itself, it gives advice, it addresses the room with a question, and it
 * writes a caption rather than a message.
 */
export const personaFor = (username: string, voice: string): string =>
  [
    `You are ${username}, a regular in a crash-game lobby. You are ${voice}.`,
    'Write ONE chat message as that person, in under 12 words, all lowercase.',
    'No emoji, no hashtags, no quotation marks, no advice, no questions to the room.',
    'Never mention being an AI, a model or a bot.',
    'Sound like someone typing fast between rounds, not like a caption.',
  ].join(' ');

/** What just happened to this bot, in the round that just ended. */
export interface RoundMoment {
  readonly username: string;
  readonly stakeCents: number;
  /** Where they were aiming, or where they got out. */
  readonly target: number;
  readonly crashPoint: number;
  readonly cashedOut: boolean;
  /** The newest lobby lines, oldest first. */
  readonly recent: readonly string[];
}

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * The round, described to the model in the terms a player would notice.
 *
 * "You won at 2.41x" is worth one line and the model writes the same one every
 * time. What varies round to round - how nearly they made it, how much they left
 * behind - is what gives it something to say.
 */
export const chatterPrompt = (moment: RoundMoment): string => {
  const { target, crashPoint, cashedOut, stakeCents } = moment;
  const lines = [`The rocket exploded at ${crashPoint.toFixed(2)}x.`];

  if (cashedOut) {
    const left = crashPoint - target;
    lines.push(
      `You staked ${money(stakeCents)} and got out at ${target.toFixed(2)}x, winning ${money(Math.round(stakeCents * target))}.`,
    );
    lines.push(
      left > 0.5
        ? `It kept going without you - you left ${left.toFixed(2)}x on the table.`
        : 'You got out with almost nothing left in it.',
    );
  } else {
    const missed = target - crashPoint;
    lines.push(
      `You staked ${money(stakeCents)} holding for ${target.toFixed(2)}x, and lost it.`,
    );
    lines.push(
      missed < 0.2
        ? 'You were a hair away from it.'
        : `You were still ${missed.toFixed(2)}x short.`,
    );
  }

  if (moment.recent.length > 0) {
    lines.push(
      'Already on screen, do not repeat these or reuse their phrasing:',
      ...moment.recent.map((line) => `- ${line}`),
    );
  }

  lines.push('Write your line.');
  return lines.join('\n');
};

/** Words that carry no signal about whether two lines say the same thing. */
const NOISE = new Set([
  'a',
  'again',
  'an',
  'and',
  'at',
  'for',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'so',
  'that',
  'the',
  'this',
  'to',
  'was',
  'with',
]);

const meaningful = (line: string): Set<string> =>
  new Set(
    line
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 0 && !NOISE.has(word)),
  );

/**
 * The last guard, after the prompt has asked nicely.
 *
 * A model told not to repeat itself still will, and the failure is loud: two
 * regulars saying `greed got me again` a round apart reads as one script with two
 * names on it. Compared on content words, so `greed got me again, damn it` and
 * `greed got me again, so painful` are the same line - which is exactly the pair
 * that prompted this.
 *
 * A line that trips this is dropped rather than retried: the lobby loses one joke,
 * which is what it was already losing when the provider was down.
 */
export const tooSimilar = (
  line: string,
  recent: readonly string[],
  threshold = 0.6,
): boolean => {
  const words = meaningful(line);
  if (words.size === 0) return true;

  for (const previous of recent) {
    const before = meaningful(previous);
    if (before.size === 0) continue;

    let shared = 0;
    for (const word of words) if (before.has(word)) shared += 1;

    // Against the shorter line, so a short repeat buried in a longer one still
    // counts as the same thing being said twice.
    if (shared / Math.min(words.size, before.size) >= threshold) return true;
  }

  return false;
};
