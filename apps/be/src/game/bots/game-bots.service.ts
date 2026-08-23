import { Rng } from '@arkv/rng';
import { Logger, type OnInit } from '@dunx/core';
import { Interval } from '@dunx/infra/schedule';
import { AIService } from '../../ai/services/ai.service.js';
import { ChatService } from '../../chat/services/chat.service.js';
import { AppConfigService } from '../../config/app.config.service.js';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import { CrashEngineService } from '../engine/crash-engine.service.js';
import { GAME_EVENTS, GAME_TOPIC, publishGame } from '../game.events.js';
import { GameMath } from '../game.math.js';
import { GameRoundStatus } from '../rounds/game-round.schema.js';
import {
  BOT_NAMES,
  BOT_VOICES,
  type BotName,
  chatterPrompt,
  personaFor,
  tooSimilar,
} from './bot-voice.js';

/**
 * A literal, because `@Interval`'s argument is evaluated before the container
 * exists - and a cosmetic poll of two in-memory fields needs no operator tuning.
 */
const WATCH_INTERVAL_MS = 250;

/** How many recent lines the model is shown, and checked against. */
const RECENT_LINES = 6;

interface Bot {
  /** The `bot:` prefix keeps this from colliding with a person's id, visibly. */
  readonly userId: string;
  readonly username: string;
  readonly betAmountCents: number;
  readonly targetX100: number;
  cashedOut: boolean;
}

/**
 * Simulated players, so an empty lobby does not look broken. Off unless
 * `GAME_BOTS_ENABLED=true`.
 *
 * The absent repository and absent `GameBetService` are the enforcement: a bot
 * publishes frames and can do nothing else. One that placed real bets would feed
 * entropy into the crash point through the client-seed pool - the house deciding
 * some of the players' seeds, which is what provable fairness rules out.
 *
 * The cost is that a player joining mid-round sees only the real bets, since every
 * read path comes from `game_bet`.
 */
export class GameBotsService implements OnInit {
  #enabled = false;
  #roundId: string | null = null;
  #phase: GameRoundStatus | null = null;
  #bots: Bot[] = [];

  constructor(
    private readonly engine: CrashEngineService,
    private readonly events: EventsPublisher,
    private readonly ai: AIService,
    private readonly chat: ChatService,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  // Read here rather than in `@Interval({ enabled })`, for the reason above.
  onInit(): void {
    const { bots } = this.config.get('game');
    this.#enabled = bots.enabled;
    if (!this.#enabled) return;

    this.logger.info('lobby bots enabled', {
      minPerRound: bots.minPerRound,
      maxPerRound: bots.maxPerRound,
    });
  }

  /**
   * Polls rather than hooks, so a cosmetic feature adds no branch to the tick path.
   * `Overlap.SKIP` - the registry's default - matters: `#react` fires an AI call,
   * and a slow model must not have a second poll start behind it.
   */
  @Interval(WATCH_INTERVAL_MS)
  watch(): void {
    if (!this.#enabled) return;

    const roundId = this.engine.roundId;
    const phase = this.engine.phase;

    if (roundId !== this.#roundId || phase !== this.#phase) {
      const previous = this.#phase;
      this.#roundId = roundId;
      this.#phase = phase;

      if (phase === GameRoundStatus.WAITING && roundId !== null) {
        this.#openRound();
      } else if (phase !== GameRoundStatus.RUNNING && previous !== phase) {
        // Crashed or failed. Whoever had not cashed out simply lost, which needs
        // no frame - the client already renders the crash for everyone left.
        this.#react(previous);
        this.#bots = [];
      }
    }

    if (phase === GameRoundStatus.RUNNING) this.#cashOutReached();
  }

  /** Stake a fresh crowd for the round that just opened. */
  #openRound(): void {
    const { bots: settings, minBetCents } = this.config.get('game');
    const rng = new Rng();

    try {
      const count = rng.range(settings.minPerRound, settings.maxPerRound + 1);
      const names = rng.shuffle([...BOT_NAMES]).slice(0, count);

      this.#bots = names.map((username) => ({
        userId: `bot:${username}`,
        username,
        // Round to whole currency units: a bot betting 137 cents reads as a bug.
        betAmountCents: rng.range(1, 51) * Math.max(minBetCents, 100),
        // Weighted low, because most players cash out early and a lobby where
        // everyone waits for 10x looks synthetic.
        targetX100: 100 + Math.floor(rng.float() ** 2 * 900) + 5,
        cashedOut: false,
      }));
    } finally {
      rng.free();
    }

    for (const bot of this.#bots) {
      publishGame(this.events, GAME_TOPIC, GAME_EVENTS.BET_PLACED, {
        userId: bot.userId,
        username: bot.username,
        betAmountCents: bot.betAmountCents,
        isDemo: true,
      });
    }
  }

  /**
   * One line per round, from one bot - the difference between atmosphere and a wall
   * of machine text. Fire and forget, and `AIService.line` returns `null` rather
   * than throwing, so a slow provider costs the lobby a joke and nothing else.
   */
  #react(previous: GameRoundStatus | null): void {
    if (previous !== GameRoundStatus.RUNNING) return;
    if (!this.ai.available || this.#bots.length === 0) return;

    const crashPointX100 = this.engine.crashPointX100;
    if (crashPointX100 === null) return;

    const rng = new Rng();
    const speaker = rng.pick(this.#bots);
    const speaks = rng.bool(this.config.get('game').bots.chatChance);
    rng.free();
    if (!speaks || speaker === undefined) return;

    void this.#speak(speaker, GameMath.toMultiplier(crashPointX100)).catch(
      (error: unknown) =>
        this.logger.debug('bot chatter failed', {
          reason: (error as Error).message,
        }),
    );
  }

  /**
   * One regular, reacting to the round that just ended.
   *
   * The lobby's own last few lines go into the prompt and are checked against the
   * answer, because a model told not to repeat itself still does - and two bots
   * saying the same thing a round apart is the tell that turns atmosphere into
   * obvious machinery.
   */
  async #speak(speaker: Bot, crashPoint: number): Promise<void> {
    const recent = (await this.chat.history())
      .slice(-RECENT_LINES)
      .map((line) => line.message);

    const voice = BOT_VOICES[speaker.username as BotName];
    const text = await this.ai.line(
      chatterPrompt({
        username: speaker.username,
        stakeCents: speaker.betAmountCents,
        target: GameMath.toMultiplier(speaker.targetX100),
        crashPoint,
        cashedOut: speaker.cashedOut,
        recent,
      }),
      personaFor(speaker.username, voice ?? 'an ordinary player'),
    );
    if (text === null) return;

    // Trimmed hard: a model that ignores the word limit must not be able to paste
    // an essay into a lobby.
    const line = text.replaceAll('"', '').trim().slice(0, 140);
    if (line.length === 0 || tooSimilar(line, recent)) {
      this.logger.debug('bot line dropped as a repeat', {
        username: speaker.username,
        line,
      });
      return;
    }

    this.chat.say({ username: speaker.username, picture: null }, line);
  }

  /** Cash out every bot the curve has now reached. */
  #cashOutReached(): void {
    const multiplierX100 = this.engine.currentMultiplierX100();
    if (multiplierX100 === null) return;

    for (const bot of this.#bots) {
      if (bot.cashedOut || bot.targetX100 > multiplierX100) continue;
      bot.cashedOut = true;

      publishGame(this.events, GAME_TOPIC, GAME_EVENTS.BET_CASHED_OUT, {
        userId: bot.userId,
        username: bot.username,
        multiplier: GameMath.toMultiplier(bot.targetX100),
        payoutCents: Math.floor((bot.betAmountCents * bot.targetX100) / 100),
        isDemo: true,
      });
    }
  }
}
