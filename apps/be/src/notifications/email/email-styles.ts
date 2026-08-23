import type { CSSProperties } from 'react';

/**
 * The lobby's palette, restated as inline styles.
 *
 * Restated rather than imported from `apps/fe/src/theme`: the client's tokens are
 * Chakra's, resolved in a browser at runtime, and an email has no runtime. Every
 * value here has to survive being pasted into a `style` attribute by a renderer and
 * then read by a mail client that supports no cascade, no classes and no variables.
 *
 * Dark, because the game is: a white email from Firecracker would look like it came
 * from somebody else. Mail clients treat these as ordinary inline colours, and the
 * few that force their own dark mode invert a dark card to a dark card.
 */
const palette = {
  page: '#0d0d0d',
  card: '#1a1a1a',
  border: '#2d2d2d',
  orange: '#ff6b00',
  amber: '#ff9500',
  heading: '#ffffff',
  body: '#aaaaaa',
  muted: '#666666',
} as const;

/**
 * No web font: a mail client that cannot load one falls back on its own guess, and
 * the guess is rarely the one the rest of the message was measured against.
 */
const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const main: CSSProperties = {
  backgroundColor: palette.page,
  fontFamily: SANS,
  margin: 0,
  padding: '32px 0',
};

export const container: CSSProperties = {
  margin: '0 auto',
  padding: '32px',
  maxWidth: '560px',
  backgroundColor: palette.card,
  border: `1px solid ${palette.border}`,
  borderRadius: '12px',
};

/** The wordmark. Monospace and letterspaced, the way the lobby renders it. */
export const brand: CSSProperties = {
  color: palette.orange,
  fontFamily: MONO,
  fontSize: '14px',
  fontWeight: 'bold',
  letterSpacing: '0.28em',
  textTransform: 'uppercase',
  margin: '0 0 24px 0',
};

export const h1: CSSProperties = {
  color: palette.heading,
  fontSize: '24px',
  fontWeight: 'bold',
  lineHeight: '32px',
  margin: '0 0 16px 0',
  padding: 0,
};

export const text: CSSProperties = {
  color: palette.body,
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 16px 0',
};

export const section: CSSProperties = {
  margin: '28px 0',
};

/**
 * `inline-block` with vertical padding, not a fixed height: Outlook ignores height
 * on an anchor, so the padding is the only thing that makes the target clickable.
 */
export const button: CSSProperties = {
  backgroundColor: palette.orange,
  borderRadius: '8px',
  color: palette.page,
  display: 'inline-block',
  fontSize: '16px',
  fontWeight: 'bold',
  padding: '14px 28px',
  textDecoration: 'none',
};

export const link: CSSProperties = {
  color: palette.amber,
  textDecoration: 'underline',
};

/**
 * For a URL or a code printed in full. `wordBreak` is load-bearing - a reset link
 * is long enough to push a 560px card wide on a phone without it.
 */
export const code: CSSProperties = {
  backgroundColor: palette.page,
  border: `1px solid ${palette.border}`,
  borderRadius: '6px',
  color: palette.amber,
  display: 'block',
  fontFamily: MONO,
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 16px 0',
  padding: '12px',
  wordBreak: 'break-all',
};

export const label: CSSProperties = {
  color: palette.muted,
  fontFamily: MONO,
  fontSize: '11px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  margin: '0 0 2px 0',
};

export const value: CSSProperties = {
  color: palette.heading,
  fontSize: '15px',
  margin: '0 0 14px 0',
};

export const hr: CSSProperties = {
  border: 'none',
  borderTop: `1px solid ${palette.border}`,
  margin: '32px 0 20px 0',
};

export const footer: CSSProperties = {
  color: palette.muted,
  fontSize: '12px',
  lineHeight: '18px',
  margin: 0,
};
