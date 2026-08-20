import { Module } from '@dunx/core';
import { PlayerDirectory } from './repos/player-directory.repository.js';
import { ChatService } from './services/chat.service.js';
import { PlayerChatService } from './services/player-chat.service.js';

/**
 * Chat: the lobby's scrollback and the one-to-one rooms.
 *
 * There is no controller and no gateway here: chat arrives on the one socket the
 * app has, which `GameGateway` owns - see the note there about why two gateway
 * classes would mean two connections. This module is what that gateway calls.
 *
 * `PlayerChatService` moved in from `game/`, where it was only ever a lodger: a DM
 * is not a round, and it was in the game module because the socket is. What kept it
 * there was `GameBetRepository.playerNameFor` - a chat service reading the bet
 * table for a display name - which `PlayerDirectory` replaces. **The edge must not
 * come back the other way**: chat is generic and the game is the application, so
 * this module importing `GameBettingModule` would point the dependency uphill.
 *
 * `PlayerDirectory` stays private. It is a read over the `users` table, and nothing
 * outside chat should acquire a second way to read users.
 *
 * Decorated rather than configured, because it takes no options - so a class is
 * one reference however many modules import it. Everything it injects
 * (`RedisConnection`, `SyncDatabase`, `EventsPublisher`, `Logger`) is `global: true`.
 */
@Module({
  providers: [PlayerDirectory, ChatService, PlayerChatService],
  exports: [ChatService, PlayerChatService],
})
export class ChatModule {}
