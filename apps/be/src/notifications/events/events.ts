/**
 * The socket half is re-exported from `@firecracker/contracts`, where a name the
 * browser has to know belongs. Queues, jobs and their payloads stay here: they are
 * the server talking to itself.
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
 * The counterpart of `publishGame`, for the same reason: `EventsPublisher.publish`
 * takes `unknown`, which is the hole every drift bug came through.
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

/** Bun's own pub/sub topics, fanned out across processes when a relay is set. */
export const TOPICS = Object.freeze({
  ADMINS: 'admins',
  CHAT: 'chat',
} as const);

/**
 * The topics that are computed rather than named. Kept apart from `TOPICS` because
 * a constant can be compared and a computed topic can only be built.
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
  /** Carried on the job rather than looked up: the child has no users table. */
  readonly name: string;
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
