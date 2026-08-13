import { describe, expect, test } from 'bun:test';
import { ConfigValidationError } from './config-validation.error.js';
import { validateConfig } from './env.validation.js';

const base = { API_PORT: '3001' };

describe('validateConfig', () => {
  test('shapes the flat environment into the nested config tree', () => {
    const config = validateConfig({ ...base, LOG_LEVEL: 'warn' });

    expect(config.app.port).toBe(3001);
    expect(config.app.prefix).toBe('api');
    expect(config.log.level).toBe('warn');
    expect(config.db.sqlitePath).toBe('./data/firecracker.db');
    expect(config.isProd).toBe(false);
  });

  test('API_PORT has no default, so an empty environment fails', () => {
    expect(() => validateConfig({})).toThrow(ConfigValidationError);
    expect(() => validateConfig({})).toThrow(/API_PORT/);
  });

  test('the message names every offending path', () => {
    try {
      validateConfig({ API_PORT: '70000', LOG_LEVEL: 'shouty' });
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const { message } = error as Error;
      expect(message).toStartWith('Configuration validation error:');
      expect(message).toContain(' - API_PORT: ');
      expect(message).toContain(' - LOG_LEVEL: ');
    }
  });

  test('CSV vars split, and fall back to their defaults when blank', () => {
    expect(
      validateConfig({ ...base, LOG_MASK_FIELDS: 'a, b ,c' }).log.maskFields,
    ).toEqual(['a', 'b', 'c']);
    expect(
      validateConfig({ ...base, LOG_MASK_FIELDS: '' }).log.maskFields,
    ).toContain('password');
  });

  /**
   * Replaced the Postgres cross-field rule, which went away with the driver. The
   * game's tunables have rules of their own now, and this is the one that would
   * actually cost money: a cleanup threshold inside a normal round length refunds
   * live bets out from under the players holding them.
   */
  test('the cleanup threshold cannot fall inside a normal round', () => {
    expect(() =>
      validateConfig({
        ...base,
        GAME_WAITING_PHASE_MS: '10000',
        GAME_COOLDOWN_MS: '5000',
        GAME_STUCK_ROUND_THRESHOLD_MS: '12000',
      }),
    ).toThrow(/GAME_STUCK_ROUND_THRESHOLD_MS must exceed/);
  });

  test('a betting window shorter than a tick is refused', () => {
    expect(() =>
      validateConfig({
        ...base,
        GAME_TICK_INTERVAL_MS: '5000',
        GAME_WAITING_PHASE_MS: '100',
      }),
    ).toThrow(/GAME_WAITING_PHASE_MS must be longer/);
  });

  test('the game defaults are the ones the game shipped with', () => {
    const { game } = validateConfig(base);
    expect(game.waitingPhaseMs).toBe(10_000);
    expect(game.tickIntervalMs).toBe(100);
    expect(game.multiplierDivisor).toBe(10_000);
    expect(game.minBetCents).toBe(100);
    // Bots are cosmetic and must never be on by accident.
    expect(game.bots.enabled).toBe(false);
  });

  test('APP_ENV=prod is the only thing that sets isProd', () => {
    const secret = 'x'.repeat(40);
    expect(
      validateConfig({ ...base, APP_ENV: 'prod', BETTER_AUTH_SECRET: secret })
        .isProd,
    ).toBe(true);
    expect(validateConfig({ ...base, APP_ENV: 'stage' }).isProd).toBe(false);
  });

  test('production refuses the development auth secret', () => {
    expect(() => validateConfig({ ...base, APP_ENV: 'prod' })).toThrow(
      /BETTER_AUTH_SECRET is required when APP_ENV=prod/,
    );
    // Everywhere else it falls back, so a clean checkout boots with no env file.
    expect(validateConfig(base).auth.usingDevSecret).toBe(true);
  });

  test('redis-backed sessions must name a redis', () => {
    expect(() =>
      validateConfig({ ...base, AUTH_SESSION_STORE: 'redis' }),
    ).toThrow(/REDIS_URL is required when AUTH_SESSION_STORE=redis/);
  });

  test('a bot ceiling below its floor is refused', () => {
    expect(() =>
      validateConfig({
        ...base,
        GAME_BOTS_MIN_PER_ROUND: '5',
        GAME_BOTS_MAX_PER_ROUND: '2',
      }),
    ).toThrow(/GAME_BOTS_MAX_PER_ROUND must be at least/);
  });

  test('an unknown timezone is rejected by name', () => {
    expect(() => validateConfig({ ...base, TZ: 'Mars/Olympus' })).toThrow(
      /Invalid IANA timezone/,
    );
  });
});
