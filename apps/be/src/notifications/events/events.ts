/**
 * The names the notification side uses.
 *
 * The socket half - `EVENTS`, `CLIENT_EVENTS` and the payloads behind them - is
 * re-exported from `@firecracker/contracts`, which is where a name the browser
 * also has to know belongs. Queues, jobs and their payloads stay here: they are
 * how the web process talks to the worker, and nothing outside this app sends one.
 */
import type { SocketPayloads } from '@firecracker/contracts';
import type { EventsPublisher } from './events.publisher.js';

export {
  /** What the server sends. The envelope on the wire is `{"event":..,"data":..}`. */
  SOCKET_EVENTS as EVENTS,
  /** What a client sends. */
  SOCKET_CLIENT_EVENTS as CLIENT_EVENTS,
  NotificationKind,
} from '@firecracker/contracts';
export type {
  ChatAckPayload,
  ChatLine,
  NotificationPayload,
} from '@firecracker/contracts';

/**
 * Publish one of the non-game frames, with the payload checked against the name.
 *
 * The counterpart of `publishGame`, and it exists for the same reason: the
 * publisher's own `publish` takes `unknown`, which is the hole every drift bug in
 * this repo's history came through. A `notification` published from a job handler
 * had four different shapes before this.
 */
export function publishSocket<E extends keyof SocketPayloads>(
  events: EventsPublisher,
  topic: string,
  event: E,
  data: SocketPayloads[E],
): void {
  events.publish(topic, event, data);
}

export const QUEUES = Object.freeze({
  /** User-facing side effects: emails, socket notifications. */
  NOTIFICATIONS: 'notifications',
  /** Anything that touches bytes. Its own queue so it can get its own worker. */
  MEDIA: 'media',
} as const);
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = Object.freeze({
  USER_REGISTERED: 'user.registered',
  USER_BANNED: 'user.banned',
  PASSWORD_RESET: 'user.password-reset',
  FILE_THUMBNAIL: 'file.thumbnail',
} as const);
export type JobName = (typeof JOBS)[keyof typeof JOBS];

/**
 * Bun's own pub/sub topics. A topic lives in the runtime rather than in a
 * JavaScript map, and with a relay configured it is fanned out across processes as
 * well.
 */
export const TOPICS = Object.freeze({
  ADMINS: 'admins',
  CHAT: 'chat',
} as const);

/**
 * The topics that are computed rather than named.
 *
 * `TOPICS` above is a frozen map of literals because those two are fixed rooms;
 * these take an argument, so they are statics. Keeping them apart is the useful
 * distinction: a constant can be compared, a computed topic can only be built.
 */
export class Topics {
  static user(userId: string): string {
    return `user_${userId}`;
  }
}

export interface UserRegisteredJob {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export interface UserBannedJob {
  readonly userId: string;
  readonly email: string;
  readonly reason: string;
}

export interface PasswordResetJob {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  /** better-auth's one-time link, already carrying the token and `redirectTo`. */
  readonly url: string;
}

export interface FileThumbnailJob {
  readonly fileId: string;
  readonly key: string;
  readonly width: number;
}
