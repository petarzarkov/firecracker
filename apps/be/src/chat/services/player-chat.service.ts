import { Logger } from '@dunx/core';
import { RedisConnection } from '@dunx/infra/redis';
import { EventsPublisher } from '../../notifications/events/events.publisher.js';
import { Topics } from '../../notifications/events/events.js';
import {
  PLAYER_CHAT_EVENTS,
  playerChatTopic,
  publishPlayerChat,
  type PlayerChatRoom,
} from '../chat.events.js';
import { PlayerDirectory } from '../repos/player-directory.repository.js';

/** How long a room's membership survives with nobody touching it. */
const ROOM_TTL_SECONDS = 24 * 60 * 60;

/**
 * One-to-one chat between two players. The socket is still `GameGateway`'s, because
 * dunx mounts one gateway per path and the app has one connection - a transport fact
 * rather than an ownership one.
 *
 * `roomId` is a hash of the two user ids **sorted**, so Ada messaging Grace and
 * Grace messaging Ada produce the same room without either of them having to
 * discover the other's. That is what makes `join` idempotent and what removes the
 * "who creates it" race entirely - there is nothing to create.
 *
 * Sorted, specifically: unsorted would give the pair two rooms depending on who
 * spoke first, and they would each be talking into a room the other was not in.
 *
 * Membership lives in **Redis**, not on the socket and not in a JavaScript map. A
 * player closes a tab and comes back, a web process restarts, eventually there is
 * more than one node - all three are the same requirement, that the room outlives the
 * connection.
 *
 * Messages themselves are **not** stored. This is a lobby side-channel, not a
 * messaging product: history lives in the open tab and nowhere else, which is also
 * the honest answer to "where is my chat log" being "there isn't one".
 */
export class PlayerChatService {
  constructor(
    private readonly players: PlayerDirectory,
    private readonly redis: RedisConnection,
    private readonly events: EventsPublisher,
    private readonly logger: Logger,
  ) {}

  /**
   * The room two players share. Deterministic, so both sides compute the same id
   * and `join` is safe to call repeatedly.
   */
  roomIdFor(a: string, b: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update([a, b].sort().join(':'));
    return hasher.digest('hex').slice(0, 32);
  }

  /**
   * Open (or re-open) the room between two players and return it.
   *
   * Returns `null` when the target does not exist, which the gateway turns into an
   * error frame rather than a room the other side will never join.
   */
  async open(
    callerId: string,
    targetId: string,
  ): Promise<PlayerChatRoom | null> {
    if (callerId === targetId) return null;

    const callerName = this.players.nameFor(callerId);
    const targetName = this.players.nameFor(targetId);
    if (callerName === undefined || targetName === undefined) return null;

    const roomId = this.roomIdFor(callerId, targetId);
    const room: PlayerChatRoom = {
      roomId,
      participants: [callerId, targetId],
      participantNames: {
        [callerId]: callerName,
        [targetId]: targetName,
      },
      creatorId: callerId,
      creatorName: callerName,
    };

    const key = this.#roomKey(roomId);
    await this.redis.hset(key, {
      participants: JSON.stringify(room.participants),
      participantNames: JSON.stringify(room.participantNames),
      creatorId: room.creatorId,
      creatorName: room.creatorName,
    });
    await this.redis.expire(key, ROOM_TTL_SECONDS);

    return room;
  }

  /** The room, if it exists and the caller is in it. */
  async find(roomId: string, callerId: string): Promise<PlayerChatRoom | null> {
    // The `catch` fallback needs the same type as the success path, or the union
    // with `{}` makes every index below an implicit `any`.
    const stored = await this.redis
      .hgetall(this.#roomKey(roomId))
      .catch((): Record<string, string> => ({}));
    if (stored['participants'] === undefined) return null;

    let participants: string[];
    let participantNames: Record<string, string>;
    try {
      participants = JSON.parse(stored['participants']) as string[];
      participantNames = JSON.parse(
        stored['participantNames'] ?? '{}',
      ) as Record<string, string>;
    } catch {
      return null;
    }

    // The membership check is the authorisation. Without it, a client that
    // guessed a room id could read a conversation it is not part of - and the id
    // is a hash of two user ids, which is not a secret.
    if (!participants.includes(callerId)) return null;

    return {
      roomId,
      participants,
      participantNames,
      creatorId: stored['creatorId'] ?? participants[0] ?? callerId,
      creatorName: stored['creatorName'] ?? '',
    };
  }

  /** Fan a message out to the room's topic. */
  async send(
    roomId: string,
    senderId: string,
    message: string,
  ): Promise<boolean> {
    const room = await this.find(roomId, senderId);
    if (room === null) return false;

    publishPlayerChat(
      this.events,
      playerChatTopic(roomId),
      PLAYER_CHAT_EVENTS.MESSAGE,
      {
        roomId,
        senderId,
        senderName: room.participantNames[senderId] ?? 'player',
        message,
        timestamp: new Date().toISOString(),
      },
    );
    return true;
  }

  /**
   * Tell everyone else in the room that somebody joined it.
   *
   * The other participant is told on **their own topic**, not the room's: they are
   * not subscribed to the room until their client joins it, so a frame on the room
   * topic would reach nobody and their window would never open.
   *
   * The joiner's own `roomJoined` frame is the gateway's, because it goes down one
   * socket rather than to a topic.
   */
  joined(room: PlayerChatRoom, callerId: string, callerName: string): void {
    for (const participant of room.participants) {
      if (participant === callerId) continue;
      publishPlayerChat(
        this.events,
        Topics.user(participant),
        PLAYER_CHAT_EVENTS.ROOM_CREATED,
        room,
      );
    }
    this.announce(room.roomId, callerName, 'join');
  }

  /** Tell the room somebody arrived or left. */
  announce(roomId: string, name: string, type: 'join' | 'leave'): void {
    publishPlayerChat(
      this.events,
      playerChatTopic(roomId),
      PLAYER_CHAT_EVENTS.SYSTEM_MESSAGE,
      {
        roomId,
        message: `${name} ${type === 'join' ? 'joined' : 'left'} the chat`,
        timestamp: new Date().toISOString(),
        type,
      },
    );
    this.logger.debug('player chat announcement', { roomId, type });
  }
  /** One Redis hash per room. Scrollback is not a record, so it does not go in SQLite. */
  #roomKey(roomId: string): string {
    return `game:player-chat:${roomId}`;
  }
}
