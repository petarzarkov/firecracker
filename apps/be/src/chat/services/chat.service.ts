import { Logger } from '@dunx/core';
import { RedisConnection } from '@dunx/infra/redis';
import type { ChatLine } from '@firecracker/contracts';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import {
  EVENTS,
  publishSocket,
  TOPICS,
} from '../../notifications/events/events.js';

/**
 * Deliberately unchanged. An existing deployment's scrollback lives at this key right
 * now, and renaming it would silently empty every lobby on deploy - which is
 * indistinguishable from the feature being broken.
 */
const HISTORY_KEY = 'chat:global:history';

/** How many messages are kept, and therefore how much a joining client gets. */
export const CHAT_HISTORY_MAX = 50;

/**
 * One line of chat, on the wire and in Redis - the *same* type, from
 * `@firecracker/contracts`, because what is stored here is replayed verbatim as
 * `chatHistory` and the client reads both with one handler.
 */
export type { ChatLine };

/**
 * The lobby's scrollback, as a capped Redis list - `rpush` then `ltrim` - so the cap
 * is the data structure rather than a periodic sweep.
 *
 * **Not SQLite**: that file is opened by two processes and carries the bet path, so
 * lobby chatter would contend with settling money. Chat is not a record, a round is.
 */
export class ChatService {
  constructor(
    private readonly redis: RedisConnection,
    private readonly events: EventsPublisher,
    private readonly logger: Logger,
  ) {}

  /**
   * **Broadcast first**, then keep it: everyone watching has the line, so a failed
   * write costs the scrollback rather than the message.
   */
  say(author: Pick<ChatLine, 'username' | 'picture'>, message: string): void {
    const line: ChatLine = {
      username: author.username,
      message,
      timestamp: new Date().toISOString(),
      // The client renders this as the avatar and falls back to an initial. Dropping
      // it once already showed a letter where every face had been.
      picture: author.picture,
    };

    publishSocket(this.events, TOPICS.CHAT, EVENTS.MESSAGE, line);
    this.record(line);
  }

  /** The newest messages, oldest first - the order the client renders them in. */
  async history(): Promise<ChatLine[]> {
    const raw = await this.redis
      .lrange(HISTORY_KEY, 0, -1)
      .catch((error: unknown) => {
        // No Redis means no scrollback, not a failed connection. Chat still works
        // for anything sent while this client is connected.
        this.logger.warn('could not read chat history', {
          reason: (error as Error).message,
        });
        return [] as readonly string[];
      });

    return raw.flatMap((entry) => {
      try {
        return [JSON.parse(entry) as ChatLine];
      } catch {
        return [];
      }
    });
  }

  /**
   * `ltrim(-MAX, -1)` keeps the **last** MAX, which is what `rpush` appends to.
   * Fire-and-forget: the line has already been broadcast.
   */
  record(line: ChatLine): void {
    void this.redis
      .rpush(HISTORY_KEY, JSON.stringify(line))
      .then(() => this.redis.ltrim(HISTORY_KEY, -CHAT_HISTORY_MAX, -1))
      .catch((error: unknown) =>
        this.logger.warn('could not persist a chat message', {
          reason: (error as Error).message,
        }),
      );
  }
}
