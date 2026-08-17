import { Logger } from '@dunx/core';
import { inject } from '@dunx/core';
import { httpClient } from '@dunx/http/client';
import { AI_HTTP_CLIENT } from '../../ai/ai.provider.js';

interface BttvEmote {
  readonly emote?: { id?: string };
}

const TRENDING_URL = 'https://api.betterttv.net/3/emotes/shared/trending';

/** The one the NestJS version fell back to when the API was unreachable. */
const FALLBACK = [
  'https://cdn.betterttv.net/emote/5ada077451d4120ea3918426/3x',
];

/**
 * Trending BetterTTV emotes, offered as profile pictures.
 *
 * A third party this app does not control, on a route a signed-out visitor can
 * reach - so it degrades rather than fails: an unreachable BTTV means one fallback
 * emote and a custom-URL field, not a sign-up form that cannot finish.
 *
 * Reuses the AI module's named outbound client, which already carries a timeout
 * and retry. That is a slightly odd pairing on the face of it, and the alternative
 * is worse: a third `HttpModule` binding for one endpoint.
 */
export class AvatarsService {
  readonly #http = inject(httpClient(AI_HTTP_CLIENT));

  constructor(private readonly logger: Logger) {}

  async trending(limit = 20): Promise<readonly string[]> {
    try {
      const emotes = await this.#http.get<BttvEmote[]>(
        `${TRENDING_URL}?limit=${limit}`,
      );
      if (!Array.isArray(emotes)) return FALLBACK;

      const urls = emotes.flatMap((item) =>
        item.emote?.id === undefined
          ? []
          : [`https://cdn.betterttv.net/emote/${item.emote.id}/3x`],
      );
      return urls.length > 0 ? urls : FALLBACK;
    } catch (error) {
      this.logger.warn('could not fetch trending avatars', {
        reason: (error as Error).message,
      });
      return FALLBACK;
    }
  }
}
