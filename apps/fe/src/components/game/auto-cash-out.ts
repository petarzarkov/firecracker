/** Which half of the bet panel the player is looking at. */
export type BetTab = 'manual' | 'auto';

/**
 * The auto-exit a bet should carry, or `null` for none.
 *
 * Its own module, and its own function, because it decides what is sent to the
 * server about somebody's money and both of its inputs are easy to lose sight of
 * inside a 570-line component.
 *
 * **The tab is half of the answer.** AUTO EXIT is only rendered on the AUTO tab, so
 * for as long as the field started empty, reading the value alone happened to give
 * the right answer on MANUAL too. It stopped being true the moment the field gained
 * a default: a manual bet would then have quietly carried `autoCashOutAt: 1.01`, and
 * every manual player would have been cashed out one tick above their stake by a
 * setting they never opened.
 *
 * `> 1` because paying at or below `1` is not an exit, it is a refund - and the
 * server refuses it, so sending one turns a bet into an error rather than a bet.
 */
export function autoCashOutFor(tab: BetTab, value: string): number | null {
  if (tab !== 'auto') return null;
  const target = Number.parseFloat(value);
  return Number.isNaN(target) || target <= 1 ? null : target;
}
