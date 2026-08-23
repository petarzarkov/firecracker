import { describe, expect, test } from 'bun:test';
import {
  BOT_NAMES,
  BOT_VOICES,
  chatterPrompt,
  personaFor,
  type RoundMoment,
  tooSimilar,
} from './bot-voice.js';

/**
 * The lobby's chatter reads as generated when every regular is the same person
 * saying the same thing. All three parts of the fix are checkable without a model:
 * the cast is distinct, the prompt carries something specific to this round, and a
 * repeat is caught even after the prompt has asked for one not to be written.
 */
const moment = (over: Partial<RoundMoment> = {}): RoundMoment => ({
  username: 'paperhands',
  stakeCents: 500,
  target: 1.4,
  crashPoint: 3.62,
  cashedOut: true,
  recent: [],
  ...over,
});

describe('the cast', () => {
  test('every regular has a voice, and no two share one', () => {
    const voices = Object.values(BOT_VOICES);
    expect(voices).toHaveLength(BOT_NAMES.length);
    expect(new Set(voices).size).toBe(voices.length);
  });

  test('the persona names the player and their temperament', () => {
    const persona = personaFor('gravity', BOT_VOICES.gravity);
    expect(persona).toContain('gravity');
    expect(persona).toContain('fatalistic');
  });

  /** All four are things a model does unasked in a gambling context. */
  test.each(['emoji', 'advice', 'lowercase', 'AI'])(
    'the persona rules out %s',
    (rule) => {
      expect(personaFor('fuse', BOT_VOICES.fuse)).toContain(rule);
    },
  );
});

describe('the round, as the model is told it', () => {
  test('carries the numbers a player would actually have noticed', () => {
    const prompt = chatterPrompt(moment());
    expect(prompt).toContain('3.62x');
    expect(prompt).toContain('1.40x');
    expect(prompt).toContain('$5.00');
  });

  /**
   * The texture that makes one round different from the next. A win that left 2.2x
   * behind and a win that got out just in time are not the same feeling, and the
   * old prompt described both as "you cashed out and made money".
   */
  test('says what was left on the table after an early exit', () => {
    expect(chatterPrompt(moment())).toContain('2.22x on the table');
  });

  test('says when there was nothing left in it', () => {
    const prompt = chatterPrompt(moment({ target: 3.5, crashPoint: 3.62 }));
    expect(prompt).toContain('almost nothing left');
  });

  test('says how badly a loss missed', () => {
    const prompt = chatterPrompt(
      moment({ cashedOut: false, target: 4, crashPoint: 1.2 }),
    );
    expect(prompt).toContain('lost it');
    expect(prompt).toContain('2.80x short');
  });

  test('a near miss is a near miss, not a number', () => {
    const prompt = chatterPrompt(
      moment({ cashedOut: false, target: 2.05, crashPoint: 2.0 }),
    );
    expect(prompt).toContain('a hair away');
  });

  test('shows the lobby what is already on screen', () => {
    const prompt = chatterPrompt(
      moment({ recent: ['brutal round', 'i was so close'] }),
    );
    expect(prompt).toContain('do not repeat these');
    expect(prompt).toContain('- brutal round');
  });

  test('says nothing about the lobby when the lobby is empty', () => {
    expect(chatterPrompt(moment())).not.toContain('do not repeat');
  });
});

/**
 * The pair that started this: two regulars, one round apart, both posting
 * `greed got me again`. The prompt now asks the model not to, and this is what
 * happens when it does anyway.
 */
describe('catching a repeat', () => {
  const recent = ['greed got me again, damn it', 'nice easy money'];

  test('the same line with a different tail is the same line', () => {
    expect(tooSimilar('greed got me again, so painful', recent)).toBe(true);
  });

  test('word for word is caught', () => {
    expect(tooSimilar('nice easy money', recent)).toBe(true);
  });

  test('punctuation and case do not launder it', () => {
    expect(tooSimilar('Nice, easy money!', recent)).toBe(true);
  });

  test('something actually different gets through', () => {
    expect(tooSimilar('should have held to four', recent)).toBe(false);
    expect(tooSimilar('knew that fuse was short', recent)).toBe(false);
  });

  /** Filler is not agreement: two lines sharing only `the` and `it` are not a repeat. */
  test('shared filler words are not a match', () => {
    expect(tooSimilar('it was the round of the night', ['the it a and'])).toBe(
      false,
    );
  });

  test('an empty line counts as a repeat, because it is nothing', () => {
    expect(tooSimilar('   ', recent)).toBe(true);
  });

  test('the first line of an empty lobby always gets through', () => {
    expect(tooSimilar('anything at all', [])).toBe(false);
  });
});
