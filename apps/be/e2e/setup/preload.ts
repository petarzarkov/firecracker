import { afterAll, beforeAll } from 'bun:test';
import { destroyTestContext, initializeTestContext } from './context.js';

/**
 * `--preload` registers these once for the whole run, so the server starts and stops
 * exactly once. The explicit timeouts are load-bearing: Bun's default hook timeout is
 * 5 s and `waitForReady` is allowed longer, so a cold runner killed the hook first
 * and every test failed with "test context not initialized" beside one unnamed
 * failure at exactly 5000 ms.
 */
beforeAll(async () => {
  await initializeTestContext();
}, 60_000);

afterAll(async () => {
  await destroyTestContext();
}, 30_000);
