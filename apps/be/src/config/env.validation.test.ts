import { describe, expect, test } from 'bun:test';
import { ConfigValidationError } from './config-validation.error.js';
import { EnvConfig } from './env.validation.js';

const base = { API_PORT: '3001' };

describe('validateConfig', () => {
  test('shapes the flat environment into the nested config tree', () => {
    const config = EnvConfig.validate({ ...base, LOG_LEVEL: 'warn' });

    expect(config.app.port).toBe(3001);
    expect(config.app.prefix).toBe('api');
    expect(config.log.level).toBe('warn');
    expect(config.db.sqlitePath).toBe('./data/firecracker.db');
    expect(config.isProd).toBe(false);
  });

  test('API_PORT has no default, so an empty environment fails', () => {
    expect(() => EnvConfig.validate({})).toThrow(ConfigValidationError);
    expect(() => EnvConfig.validate({})).toThrow(/API_PORT/);
  });

  test('the message names every offending path', () => {
    try {
      EnvConfig.validate({ API_PORT: '70000', LOG_LEVEL: 'shouty' });
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
      EnvConfig.validate({ ...base, LOG_MASK_FIELDS: 'a, b ,c' }).log
        .maskFields,
    ).toEqual(['a', 'b', 'c']);
    expect(
      EnvConfig.validate({ ...base, LOG_MASK_FIELDS: '' }).log.maskFields,
    ).toContain('password');
  });

  /**
   * The one cross-field rule that costs money: a cleanup threshold inside a normal
   * round length refunds live bets out from under the players holding them.
   */
  test('the cleanup threshold cannot fall inside a normal round', () => {
    expect(() =>
      EnvConfig.validate({
        ...base,
        GAME_WAITING_PHASE_MS: '10000',
        GAME_COOLDOWN_MS: '5000',
        GAME_STUCK_ROUND_THRESHOLD_MS: '12000',
      }),
    ).toThrow(/GAME_STUCK_ROUND_THRESHOLD_MS must exceed/);
  });

  test('a betting window shorter than a tick is refused', () => {
    expect(() =>
      EnvConfig.validate({
        ...base,
        GAME_TICK_INTERVAL_MS: '5000',
        GAME_WAITING_PHASE_MS: '100',
      }),
    ).toThrow(/GAME_WAITING_PHASE_MS must be longer/);
  });

  test('the game defaults are the ones the game shipped with', () => {
    const { game } = EnvConfig.validate(base);
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
      EnvConfig.validate({
        ...base,
        APP_ENV: 'prod',
        BETTER_AUTH_SECRET: secret,
      }).isProd,
    ).toBe(true);
    expect(EnvConfig.validate({ ...base, APP_ENV: 'stage' }).isProd).toBe(
      false,
    );
  });

  test('production refuses the development auth secret', () => {
    expect(() => EnvConfig.validate({ ...base, APP_ENV: 'prod' })).toThrow(
      /BETTER_AUTH_SECRET is required when APP_ENV=prod/,
    );
    // Everywhere else it falls back, so a clean checkout boots with no env file.
    expect(EnvConfig.validate(base).auth.usingDevSecret).toBe(true);
  });

  test('redis-backed sessions must name a redis', () => {
    expect(() =>
      EnvConfig.validate({ ...base, AUTH_SESSION_STORE: 'redis' }),
    ).toThrow(/REDIS_URL is required when AUTH_SESSION_STORE=redis/);
  });

  test('a bot ceiling below its floor is refused', () => {
    expect(() =>
      EnvConfig.validate({
        ...base,
        GAME_BOTS_MIN_PER_ROUND: '5',
        GAME_BOTS_MAX_PER_ROUND: '2',
      }),
    ).toThrow(/GAME_BOTS_MAX_PER_ROUND must be at least/);
  });

  test('an unknown timezone is rejected by name', () => {
    expect(() => EnvConfig.validate({ ...base, TZ: 'Mars/Olympus' })).toThrow(
      /Invalid IANA timezone/,
    );
  });
});
