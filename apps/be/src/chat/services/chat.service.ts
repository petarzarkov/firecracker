import { Logger } from '@dunx/core';
import { RedisConnection } from '@dunx/infra/redis';

/**
 * The key the NestJS version used, kept deliberately.
 *
 * An existing deployment's scrollback lives at this key right now. Renaming it
 * would silently empty every lobby on deploy, which is indistinguishable from the
 * feature being broken.
 */
const HISTORY_KEY = 'chat:global:history';

/** How many messages are kept, and therefore how much a joining client gets. */
export const CHAT_HISTORY_MAX = 50;

/** One line of chat, on the wire and in Redis. */
export interface ChatLine {
  readonly username: string;
  readonly message: string;
  readonly timestamp: string;
}

/**
 * The lobby's chat scrollback, in Redis.
 *
 * A capped list - `rpush` then `ltrim` to the last {@link CHAT_HISTORY_MAX} - which
 * is what the NestJS version did and the right shape for this: the newest N of a
 * write-heavy, read-once-per-connection stream, with the cap enforced by the data
 * structure rather than by a periodic sweep.
 *
 * ## Not the database, and that is the point
 *
 * An earlier pass at this migration put chat in a SQLite table. That was wrong on
 * its own terms, never mind the churn: the game's SQLite file is opened by two
 * processes and carries the bet path, so adding a high-frequency, low-value write
 * to it puts lobby chatter in contention with settling money. Redis is already
 * here, it already holds the round's client seeds and auto-cashouts, and a capped
 * list is one command with no migration behind it.
 *
 * Losing the scrollback if Redis is flushed is the accepted trade. Chat is not a
 * record; a round is, and that is what the database holds.
 */
export class ChatService {
  constructor(
    private readonly redis: RedisConnection,
    private readonly logger: Logger,
  ) {}

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
   * Append a line and trim to the cap.
   *
   * `ltrim(-MAX, -1)` keeps the **last** MAX, which is what `rpush` appends to.
   * Fire-and-forget past the log: a chat line failing to persist must not fail the
   * send, because the line has already been broadcast to everyone watching.
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
