import { describe, expect, test } from 'bun:test';
import { AppFactory } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import { JobsModule } from './app.module.js';
import { AppConfigService } from './config/app.config.service.js';
import { EnvConfig } from './config/env.validation.js';

/**
 * The graph a bullmq-forked child boots, against an environment that supplies nothing.
 *
 * This is the test for a defect CI found and a developer machine cannot: a spec hands
 * its config to `forRoot({ source })` as an in-memory literal, and **a literal cannot
 * cross a fork**. The child reads `Bun.env`, which a developer machine populates from
 * `apps/be/.env` and CI does not - so the child died on `API_PORT`, the only setting
 * with no default, and the job it was forked to run sat in `delayed` while the boot
 * error surfaced as its `failedReason`.
 */
describe('the sandboxed job child', () => {
  test('API_PORT is the only setting with no default', () => {
    // The assumption the fix rests on. A second required setting would make the
    // placeholder insufficient, and the failure would show up as a queue going quiet
    // in CI rather than as anything pointing here.
    expect(() => EnvConfig.validate({ API_PORT: '0' })).not.toThrow();
    expect(() => EnvConfig.validate({})).toThrow(/API_PORT/);
  });

  test('its graph builds with nothing in the environment', async () => {
    const app = await AppFactory.create(
      JobsModule.forRoot({
        // What `jobs.processor.ts` supplies, over an environment that has nothing.
        // `Bun.env` is deliberately not spread in: this is the CI case.
        source: { API_PORT: '0', SQLITE_DB_PATH: ':memory:' },
        logLevel: 'fatal',
      }),
    );

    try {
      // Booting is most of the assertion - a setting it could not validate or a
      // provider it could not build throws above. These two say the container is
      // genuinely usable: config resolved, and the publish side is bound so a handler
      // can enqueue a follow-up job.
      expect(app.get(AppConfigService).get('app').port).toBe(0);
      expect(app.get(JobPublisher)).toBeDefined();
    } finally {
      await app.shutdown();
    }
  });
});
