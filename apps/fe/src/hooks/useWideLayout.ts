import { useEffect, useState } from 'react';

/**
 * Chakra's `lg`, as a media query.
 *
 * Hardcoded rather than read from the theme because it has to match what the
 * `display={{ base: …, lg: … }}` props compile to, and those are resolved by
 * Chakra's own breakpoint scale at build time. If that scale ever changes, this
 * is the line that has to change with it.
 */
const WIDE = '(min-width: 1024px)';

/**
 * Where the tablet layout starts.
 *
 * Not a Chakra breakpoint: it is the width at which a bet panel and a side rail
 * both fit, which is a fact about this layout rather than about the scale. Below
 * 1024 the app used to hand a 820-point iPad the phone's tab strip - a 760px-tall
 * chart with one rocket in it, controls in a drawer, and a band of dead black under
 * the panel because its height was a fixed fraction of a very tall viewport.
 */
const MEDIUM = '(min-width: 700px)';

/** Which of the three layouts is live. See {@link useLayout}. */
export type LayoutSize = 'phone' | 'tablet' | 'desktop';

const matches = (query: string): boolean =>
  globalThis.matchMedia?.(query).matches ?? false;

const read = (): LayoutSize => {
  if (matches(WIDE)) return 'desktop';
  return matches(MEDIUM) ? 'tablet' : 'phone';
};

/**
 * The live layout.
 *
 * **Not `display: none`.** A hidden element is still mounted, so rendering more
 * than one layout means more than one `CrashChart` - two WebGL contexts, two
 * tickers and two full particle simulations, one of them drawing to a box nobody
 * can see.
 *
 * Reading `matchMedia` during the initial state means the first paint already
 * knows which layout it is, so nothing flashes.
 */
export function useLayout(): LayoutSize {
  const [layout, setLayout] = useState<LayoutSize>(read);

  useEffect(() => {
    const wide = globalThis.matchMedia(WIDE);
    const medium = globalThis.matchMedia(MEDIUM);
    const sync = () => setLayout(read());
    sync();
    wide.addEventListener('change', sync);
    medium.addEventListener('change', sync);
    return () => {
      wide.removeEventListener('change', sync);
      medium.removeEventListener('change', sync);
    };
  }, []);

  return layout;
}

/** Whether the desktop layout is the live one. */
export function useWideLayout(): boolean {
  return useLayout() === 'desktop';
}
