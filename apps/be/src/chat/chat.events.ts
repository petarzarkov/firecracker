import type { PlayerChatPayloads } from '@firecracker/contracts';
import type { EventsPublisher } from '../notifications/events/events.publisher.js';

/**
 * The one-to-one rooms' names, on the wire and in this process.
 *
 * They were in `game.events.ts`, which put a topic helper for private messages
 * inside the crash game's own name file. A DM is not a round: the game is one
 * feature that happens to carry chat on its socket, and the socket is
 * `GameGateway`'s only because dunx mounts one gateway per path.
 *
 * The event names and payloads themselves stay in `@firecracker/contracts`, because
 * the browser has to agree about them. Re-exported here so a chat file's imports
 * read as one place.
 */
export { PLAYER_CHAT_EVENTS } from '@firecracker/contracts';
export type {
  PlayerChatMessagePayload,
  PlayerChatRoom,
  PlayerChatSystemPayload,
} from '@firecracker/contracts';

/**
 * A topic per room rather than one topic filtered on the client, because a client
 * that receives a message it then hides has still received it.
 */
export const playerChatTopic = (roomId: string): string =>
  `player_chat_${roomId}`;

/**
 * Publish into a one-to-one room, with the payload checked against the event name.
 *
 * A `topic` rather than a room id, because `playerChatRoomCreated` is addressed to
 * the *other* participant's own topic - they are not subscribed to the room until
 * their client joins it.
 *
 * The wrapper exists for the reason `publishGame` does: `EventsPublisher.publish`
 * takes `unknown`, and that is the hole every drift bug in this repo came through.
 */
export function publishPlayerChat<E extends keyof PlayerChatPayloads>(
  events: EventsPublisher,
  topic: string,
  event: E,
  data: PlayerChatPayloads[E],
): void {
  events.publish(topic, event, data);
}
