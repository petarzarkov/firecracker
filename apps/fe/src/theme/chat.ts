/**
 * Accent colours for the chat windows.
 *
 * Raw hex rather than theme tokens because `ChatWindow` interpolates them into
 * `rgba`-ish strings - `${themeColor}60` for a border, `${themeColor}20` for a
 * glow - and a token name cannot carry an alpha suffix.
 *
 * They live here rather than at the call sites because that is exactly how they
 * drifted: the popped-out lobby chat was `#2196F3` and the direct-message window
 * `#4CAF50`, both Material defaults from a starter, neither anywhere near this
 * app's fire palette. One place to look is what stops that happening again.
 */
export const CHAT_THEME = {
  /** The lobby. The app's primary accent, `gaming.glow`. */
  lobby: '#ff6b00',
  /** A direct message. Amber - same family, distinguishable at a glance. */
  direct: '#ff9500',
} as const;
