import { mkdir } from 'node:fs/promises';
import { type Browser, chromium, type Page } from 'playwright';
import { installClock } from './clock.js';

/**
 * Chromium, and where the pictures go.
 *
 * The renderer here is SwiftShader - Playwright's Chromium falls back to it with no
 * flags, and it draws WebGL correctly, just slowly. That matters for one reason:
 * the stage's own README says `Application.init()` can hang forever on a machine
 * with no usable GPU, so this rig is also the standing check that it does not.
 */

/**
 * Where screenshots land. Gitignored: they are an artefact of a run, and a person
 * looking at them - or a model - is the assertion they serve.
 */
export const SCREENS = `${import.meta.dir}/screens`;

/** One seed for every run, so two runs of a spec draw the same frame. */
const SEED = 0x1efac7;

export const launch = async (): Promise<Browser> => {
  await mkdir(SCREENS, { recursive: true });
  return chromium.launch({ headless: true });
};

/** Anything the page said that a person would want to know about. */
export interface Complaints {
  /** Asserted empty by every spec here. */
  readonly errors: string[];
  /** Kept for reading, not asserting - see the filter in {@link openPage}. */
  readonly warnings: string[];
}

/**
 * A page with the clock installed and its console piped somewhere a spec can
 * assert on. Every spec here asserts `errors` is empty: a texture that 404s and a
 * shader that will not compile both arrive this way, and neither necessarily
 * changes a pixel the spec happens to be looking at.
 */
export interface PageOptions {
  /**
   * `stepped` freezes the page's clock so a spec draws frames by hand - what the
   * stage harness needs, and wrong for the app, whose own animations would stop
   * with it. See `clock.ts`.
   */
  readonly clock?: 'stepped' | 'real';
}

export const openPage = async (
  browser: Browser,
  size: { width: number; height: number },
  options: PageOptions = {},
): Promise<{ page: Page; complaints: Complaints }> => {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  const errors: string[] = [];
  const warnings: string[] = [];

  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') errors.push(`error: ${text}`);
    // SwiftShader complains about the stall every time a spec reads the drawing
    // buffer back, which is a cost this rig chooses knowingly - see `grid`. Left in
    // `errors` it would fail every test that looks at a pixel.
    if (
      message.type() === 'warning' &&
      !text.includes('GPU stall due to ReadPixels')
    ) {
      warnings.push(text);
    }
  });
  page.on('requestfailed', (request) => {
    errors.push(
      `request failed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
    );
  });

  if (options.clock === 'stepped') await page.addInitScript(installClock, SEED);

  return { page, complaints: { errors, warnings } };
};

/**
 * Writes `<name>.png` into {@link SCREENS} and returns the path, which is what a
 * spec prints so the picture can be opened straight from the run's output.
 */
export const shoot = async (page: Page, name: string): Promise<string> => {
  const path = `${SCREENS}/${name}.png`;
  await page.screenshot({ path });
  return path;
};
