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
 * Whether the desktop layout is the live one.
 *
 * ## Why this exists rather than `display: none`
 *
 * `Game` rendered **both** layouts and hid one with `display`. A hidden element
 * is still mounted, so the game was running two `CrashChart`s - which, once the
 * chart became a PIXI scene, meant two WebGL contexts, two tickers and two full
 * particle simulations, one of them drawing to a box nobody could see. It was
 * already wasteful with the canvas version; it is expensive now.
 *
 * Reading `matchMedia` during the initial state means the first paint already
 * knows which layout it is, so nothing flashes.
 */
export function useWideLayout(): boolean {
  const [wide, setWide] = useState(
    () => globalThis.matchMedia?.(WIDE).matches ?? true,
  );

  useEffect(() => {
    const query = globalThis.matchMedia(WIDE);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return wide;
}
