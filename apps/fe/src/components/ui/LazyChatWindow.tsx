import { lazy, Suspense } from 'react';
import type { ChatWindowProps } from './ChatWindow';

/**
 * `ChatWindow`, behind a dynamic import.
 *
 * It is the doorway to `MessageBubble`, and `MessageBubble` imports
 * `react-markdown` and `react-syntax-highlighter` - 740 kB of the 1.4 MB this app
 * used to fetch before it drew anything, for two panels that are **closed on load
 * and stay closed** unless a player opens one. Statically imported they were in the
 * entry's graph, so Vite listed both in `index.html`'s `modulepreload` and the
 * browser fetched a syntax highlighter before the first round appeared.
 *
 * `fallback={null}` on purpose: both call sites already render nothing until the
 * player opens the panel, so the only thing a spinner would announce is a fetch
 * that finishes in the time it takes the window to animate in.
 */
const ChatWindow = lazy(async () => ({
  default: (await import('./ChatWindow')).ChatWindow,
}));

export function LazyChatWindow(props: ChatWindowProps) {
  return (
    <Suspense fallback={null}>
      <ChatWindow {...props} />
    </Suspense>
  );
}
