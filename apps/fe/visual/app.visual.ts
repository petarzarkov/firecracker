import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { launch, openPage, shoot } from './browser.js';

/**
 * The client itself, in a browser, against a running stack.
 *
 * The stage specs beside this one need nothing but a bundle, which is what makes
 * them cheap enough to run on every change. These are the other half: React,
 * Chakra, the store, the socket and a real round - everything the harness
 * deliberately leaves out - and they need the app up, which is why they are a
 * separate script.
 *
 *     docker compose up -d      # Redis, or no round ever starts
 *     bun dev                   # both apps
 *     bun run visual:app        # from apps/fe
 *
 * Point them somewhere else with `VISUAL_APP_URL`.
 *
 * They sign in **anonymously**, through the lobby's own "Try Demo" button. The
 * socket admits spectators but the client does not: an unauthenticated visitor gets
 * the login screen and never reaches a chart, so a spec that only loaded the page
 * would be asserting about a form. The demo account is the shortest path to the
 * thing worth looking at, and it is the path most first-time players take.
 */

const APP = process.env['VISUAL_APP_URL'] ?? 'http://localhost:5173';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Long enough for the socket to connect and a round frame to arrive. */
const SETTLE_MS = 4000;

const reachable = async (): Promise<boolean> => {
  try {
    const response = await fetch(APP, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
};

/** The text the client prints through the betting window. */
const COUNTDOWN = /starting in|starting\.\.\./i;

/** Signs in as a demo player and waits for the chart the stage draws. */
const enterLobby = async (page: Page): Promise<void> => {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /try demo/i }).click();
  // The canvas is the stage's, so this doubles as the check that the client's
  // dynamic import of `@firecracker/stage` resolves in a real bundle.
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await page.waitForTimeout(SETTLE_MS);
};

describe('the client, in a browser', () => {
  let browser: Browser;

  beforeAll(async () => {
    if (!(await reachable())) {
      // Loud rather than skipped: a visual suite that quietly passes when it never
      // opened the app is worse than no visual suite.
      throw new Error(
        `nothing is serving ${APP}. Start the stack first - \`docker compose up -d\` for Redis, then \`bun dev\` - or point these at another origin with VISUAL_APP_URL.`,
      );
    }
    browser = await launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  test('a visitor who has not signed in gets the login screen', async () => {
    const { page, complaints } = await openPage(browser, DESKTOP);
    await page.goto(APP, { waitUntil: 'networkidle' });

    console.log('  →', await shoot(page, 'app-login'));
    await expect(
      page.getByRole('button', { name: /try demo/i }).isVisible(),
    ).resolves.toBe(true);

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  test('a demo player gets the chart, the bet panel and the lobby', async () => {
    const { page, complaints } = await openPage(browser, DESKTOP);
    await enterLobby(page);

    console.log('  →', await shoot(page, 'app-lobby'));

    const canvas = await page.locator('canvas').first().boundingBox();
    expect(canvas?.width ?? 0).toBeGreaterThan(400);
    expect(canvas?.height ?? 0).toBeGreaterThan(200);

    await expect(
      page.getByText('PLACE BET', { exact: false }).first().isVisible(),
    ).resolves.toBe(true);

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  /**
   * The countdown used to print over the middle of the plot, which is where the
   * rocket hovers - so the one thing the betting window has to show was behind the
   * one piece of text on top of it. Nothing in the DOM overlapped, so only a
   * screenshot could say so; this keeps the two apart.
   *
   * It **waits for** a betting window rather than checking whether it happened to
   * land in one. A round plus its cool-down is about twenty seconds, so the wait is
   * bounded - and a test that quietly passes whenever it arrives mid-round is a test
   * that passes forever after the thing it guards breaks.
   */
  test('the countdown clears the rocket it used to print over', async () => {
    const { page, complaints } = await openPage(browser, DESKTOP);
    await enterLobby(page);

    const countdown = page.getByText(COUNTDOWN).first();
    await countdown.waitFor({ state: 'visible', timeout: 45_000 });
    console.log('  →', await shoot(page, 'app-waiting'));

    const chart = await page.locator('canvas').first().boundingBox();
    const text = await countdown.boundingBox();
    if (chart === null || text === null)
      throw new Error('nothing was laid out');

    // The rocket hovers at the middle of the chart, and it is about 120px tall.
    expect(text.y + text.height).toBeLessThan(chart.y + chart.height / 2 - 60);

    expect(complaints.errors).toEqual([]);
    await page.close();
  });

  test('the lobby lays out on a phone', async () => {
    const { page } = await openPage(browser, MOBILE);
    await enterLobby(page);

    console.log('  →', await shoot(page, 'app-mobile'));

    // Nothing may push the page sideways: a chart that overflows its column is the
    // classic way this layout breaks, and it is invisible on a desktop viewport.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.close();
  });
});
