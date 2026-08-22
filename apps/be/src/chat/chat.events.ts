import type { PlayerChatPayloads } from '@firecracker/contracts';
import type { EventsPublisher } from '../notifications/events/events.publisher.js';

/**
 * The one-to-one rooms' names. A DM is not a round: the game is one feature that
 * happens to carry chat on its socket. The names and payloads themselves stay in
 * `@firecracker/contracts`, re-exported here so a chat file's imports read as one
 * place.
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
 * A `topic` rather than a room id, because `playerChatRoomCreated` goes to the
 * *other* participant's own topic - they are not subscribed to the room until their
 * client joins. A wrapper for the reason `publishGame` is one: the publisher's own
 * `publish` takes `unknown`.
 */
export function publishPlayerChat<E extends keyof PlayerChatPayloads>(
  events: EventsPublisher,
  topic: string,
  event: E,
  data: PlayerChatPayloads[E],
): void {
  events.publish(topic, event, data);
}
