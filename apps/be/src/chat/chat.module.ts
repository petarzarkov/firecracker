import { Module } from '@dunx/core';
import { ChatService } from './services/chat.service.js';

/**
 * The lobby's chat, and only its persistence.
 *
 * There is no controller and no gateway here: chat arrives on the one socket the
 * app has, which `GameGateway` owns - see the note there about why two gateway
 * classes would mean two connections. This module is what that gateway calls to
 * read the scrollback and record a line.
 *
 * Decorated rather than configured, because it takes no options - so a class is
 * one reference however many modules import it. Its only dependency is
 * `RedisConnection`, which `RedisCacheModule` binds `global: true`.
 */
@Module({
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
