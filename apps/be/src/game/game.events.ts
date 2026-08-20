/**
 * The game's names, in two halves.
 *
 * **The wire** - socket topics, event names and payloads - lives in
 * `@firecracker/contracts`, because the browser has to agree with the server about
 * it and agreeing twice is how the three `userId` bugs and the chat-panel crash
 * happened. It is re-exported here so the server's imports read as one file.
 *
 * **The server's own names** - the queue, the jobs, their payloads, the topic
 * helpers - stay here. A browser has no business knowing how a round is scheduled,
 * and putting a job name in a shared package invites somebody to send one.
 */

export {
  GAME_CLIENT_EVENTS,
  GAME_EVENTS,
  GAME_TOPIC,
  PLAYER_CHAT_EVENTS,
} from '@firecracker/contracts';
export type {
  ActiveBetView,
  BetAckPayload,
  BetCashedOutPayload,
  BetPlacedPayload,
  CashOutAckPayload,
  CrashedRoundSummary,
  GameCrashedPayload,
  GamePayloads,
  GamePhase,
  GamePhasePayload,
  GameRoundStatePayload,
  GameTickPayload,
  PlayerChatRoom,
  SeedAckPayload,
  WalletUpdatedPayload,
} from '@firecracker/contracts';

import type { GamePayloads, PlayerChatPayloads } from '@firecracker/contracts';
import type { EventsPublisher } from '../notifications/events/events.publisher.js';

/** The game's own queue. Its own so round transitions cannot queue behind email. */
export const GAME_QUEUE = 'game' as const;

export const GAME_JOBS = Object.freeze({
  /** Create the next round and open its betting window. */
  SCHEDULE: 'game.round.schedule',
  /** Close the window, draw the crash point, start the tick loop. */
  START: 'game.round.start',
  /** Settle every open bet and reveal the seed. */
  CRASH: 'game.round.crash',
} as const);
export type GameJobName = (typeof GAME_JOBS)[keyof typeof GAME_JOBS];

/**
 * One-to-one chat. A topic per room rather than one topic filtered on the client,
 * because a client that receives a message it then hides has still received it.
 */
export const playerChatTopic = (roomId: string): string =>
  `player_chat_${roomId}`;

export interface RoundJob {
  readonly roundId: string;
}

/**
 * Publish a game frame, with the payload checked against the event name.
 *
 * A thin wrapper over `EventsPublisher.publish`, which takes `unknown` because it
 * serves chat and notifications too.
 *
 * ## Why every game publish goes through here
 *
 * Nothing checked that a frame matched the interface named after it. Three
 * separate bugs came out of that gap, all the same shape: `betPlaced`, `betAck`
 * and `betCashedOut` each went out without the `userId` a client needs to
 * recognise itself, and each was found by a person looking at a screen rather than
 * by a compiler. With `@firecracker/contracts` on both sides, the missing field is
 * now an error here *and* at the handler that would have read it.
 */
export function publishGame<E extends keyof GamePayloads>(
  events: EventsPublisher,
  topic: string,
  event: E,
  data: GamePayloads[E],
): void {
  events.publish(topic, event, data);
}

/**
 * The same, for a one-to-one room.
 *
 * `topic` rather than a room id, because `playerChatRoomCreated` is addressed to
 * the *other* participant's own topic - they are not subscribed to the room until
 * their client joins it.
 */
export function publishPlayerChat<E extends keyof PlayerChatPayloads>(
  events: EventsPublisher,
  topic: string,
  event: E,
  data: PlayerChatPayloads[E],
): void {
  events.publish(topic, event, data);
}
