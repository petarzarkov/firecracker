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
 * **The dependency must not point uphill**: chat is generic and the game is the
 * application, so this module importing `GameBettingModule` - which is how a display
 * name used to be read, off `GameBetRepository` - would reverse it. `PlayerDirectory`
 * is what makes that unnecessary.
 *
 * `PlayerDirectory` stays private. It is a read over the `users` table, and nothing
 * outside chat should acquire a second way to read users.
 *
 * Decorated rather than configured: it takes no options. Everything it injects
 * (`RedisConnection`, `SyncDatabase`, `EventsPublisher`, `Logger`) is `global: true`.
 */
@Module({
  providers: [PlayerDirectory, ChatService, PlayerChatService],
  exports: [ChatService, PlayerChatService],
})
export class ChatModule {}
