import type { PlayerChatRoom as WirePlayerChatRoom } from '@firecracker/contracts';

/**
 * The roles, from `@firecracker/contracts` - the same declaration the server's
 * `@Roles()` guard and its `user.role` column read.
 *
 * It was a local `enum` with the same two members. That worked right up until the
 * server gained a third, at which point this file would have said the value did
 * not exist while the API happily sent it.
 */
export { UserRole } from '@firecracker/contracts';

export interface ChatMessage {
  senderId: string;
  senderName: string;
  senderPicture?: string;
  message: string;
  timestamp: Date;
  isSystem?: boolean;
  model?: string; // Model used for AI responses
}

/**
 * A room, plus the two things only a client has: the scrollback it is holding and
 * whether the window is open. The rest extends the wire's room rather than
 * restating it - the server sends `participantNames`, and a second declaration is
 * a second chance to spell it differently.
 */
export interface PlayerChatRoom extends WirePlayerChatRoom {
  messages: ChatMessage[];
  isOpen: boolean;
}

export interface GlobalChatState {
  messages: ChatMessage[];
  isOpen: boolean;
}
