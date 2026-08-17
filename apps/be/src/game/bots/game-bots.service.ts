import { Rng } from '@arkv/rng';
import { Logger, type OnInit, type OnShutdown } from '@dunx/core';
import { AIService } from '../../ai/services/ai.service.js';
import { ChatService } from '../../chat/services/chat.service.js';
import { AppConfigService } from '../../config/app.config.service.js';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import { EVENTS, TOPICS } from '../../notifications/events/events.js';
import { CrashEngineService } from '../engine/crash-engine.service.js';
import { GAME_EVENTS, GAME_TOPIC, publishGame } from '../game.events.js';
import { toMultiplier } from '../game.math.js';
import { GameRoundStatus } from '../schema/game-round.schema.js';

/** How often the watcher looks for a phase change. */
const WATCH_INTERVAL_MS = 250;

/**
 * Who the bots are told to be.
 *
 * Short, and explicitly told not to explain itself: a model given a crash-game
 * prompt with no persona writes a paragraph of gambling advice, which is both
 * off-tone and a thing a real casino should not be publishing.
 */
const BOT_PERSONA =
  'You are a player in a crash-gambling lobby chat. Reply with one short, casual line - ' +
  'under 12 words, lowercase, no emoji, no advice, no hashtags. Never mention being an AI.';

const BOT_NAMES = [
  'rocketman',
  'moonshot',
  'diamondhand',
  'paperhands',
  'ka_boom',
  'lucky7',
  'nitro',
  'bigred',
  'cashout_carl',
  'fuse',
  'ember',
  'skyward',
  'orbit',
  'ignition',
  'afterburner',
  'gravity',
  'cinder',
  'blastoff',
] as const;

interface Bot {
  /**
   * Stable, synthetic, and never a real user id.
   *
   * The lobby keys rows on this, so a bot needs one - but it must not collide
   * with a person's, and the `bot:` prefix is what makes that obvious in a log.
   */
  readonly userId: string;
  readonly username: string;
  readonly betAmountCents: number;
  readonly targetX100: number;
  cashedOut: boolean;
}

/**
 * Simulated players, so an empty lobby does not look broken.
 *
 * ## These are cosmetic and that is enforced, not just intended
 *
 * A bot **never** touches the database, a wallet, the ledger or the client-seed
 * pool. This class has no repository and no `GameBetService` in its constructor,
 * which is the enforcement: it publishes `betPlaced` and `betCashedOut` frames and
 * that is the whole of what it can do.
 *
 * That matters for more than tidiness. A bot that placed real bets would be
 * contributing entropy to the crash point through the client-seed pool, and the
 * house deciding some of the players' seeds is exactly the thing provable fairness
 * exists to rule out. Bots stay outside the fairness boundary entirely.
 *
 * They are also invisible to every read path: `game/state`, `my-bets`, the round
 * history and the lobby list on connect all come from `game_bet`, which has no bot
 * rows in it. A player who joins mid-round sees only the real bets - which is a
 * real inconsistency with the live feed, and the honest cost of not writing rows.
 *
 * Off unless `GAME_BOTS_ENABLED=true`.
 */
export class GameBotsService implements OnInit, OnShutdown {
  #watcher: ReturnType<typeof setInterval> | null = null;
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

  onInit(): void {
    const { bots } = this.config.get('game');
    if (!bots.enabled) return;

    this.#watcher = setInterval(() => this.#watch(), WATCH_INTERVAL_MS);
    this.logger.info('lobby bots enabled', {
      minPerRound: bots.minPerRound,
      maxPerRound: bots.maxPerRound,
    });
  }

  onShutdown(): void {
    if (this.#watcher !== null) clearInterval(this.#watcher);
    this.#watcher = null;
  }

  /**
   * Polls the engine rather than hooking it.
   *
   * A callback registration would have coupled the engine to a cosmetic feature,
   * and the engine is the one class in this app where an extra branch on the tick
   * path is worth avoiding. A quarter-second poll of two in-memory fields costs
   * nothing and keeps the dependency pointing one way.
   */
  #watch(): void {
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
   * One bot says something about the round that just ended.
   *
   * Fire and forget, and `AIService.line` returns `null` rather than throwing, so
   * a provider that is unconfigured, rate-limited or simply slow costs the lobby a
   * joke and nothing else. There is no await on the game's path here at all.
   *
   * At most one line per round, from one bot, which is the difference between
   * atmosphere and a wall of machine text.
   */
  #react(previous: GameRoundStatus | null): void {
    if (previous !== GameRoundStatus.RUNNING) return;
    if (!this.ai.available || this.#bots.length === 0) return;

    const rng = new Rng();
    const speaker = rng.pick(this.#bots);
    const speaks = rng.bool(this.config.get('game').bots.chatChance);
    rng.free();
    if (!speaks || speaker === undefined) return;

    const won = speaker.cashedOut;
    const multiplier = toMultiplier(speaker.targetX100).toFixed(2);

    void this.ai
      .line(
        won
          ? `You cashed out at ${multiplier}x and made money. React in under 12 words.`
          : `You held too long and the rocket exploded before your ${multiplier}x target. React in under 12 words.`,
        BOT_PERSONA,
      )
      .then((text) => {
        if (text === null) return;
        // Trimmed hard: a model that ignores the word limit must not be able to
        // paste an essay into a lobby.
        const line = {
          username: speaker.username,
          message: text.slice(0, 140),
          timestamp: new Date().toISOString(),
          picture: null,
        };
        this.events.publish(TOPICS.CHAT, EVENTS.MESSAGE, line);
        this.chat.record(line);
      })
      .catch((error: unknown) =>
        this.logger.debug('bot chatter failed', {
          reason: (error as Error).message,
        }),
      );
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
        multiplier: toMultiplier(bot.targetX100),
        payoutCents: Math.floor((bot.betAmountCents * bot.targetX100) / 100),
        isDemo: true,
      });
    }
  }
}
