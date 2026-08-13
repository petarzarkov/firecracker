export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

export interface ChatMessage {
  senderId: string;
  senderName: string;
  senderPicture?: string;
  message: string;
  timestamp: Date;
  isSystem?: boolean;
  model?: string; // Model used for AI responses
}

export interface PlayerChatRoom {
  roomId: string;
  participants: string[];
  participantNames: Record<string, string>;
  creatorId: string;
  creatorName: string;
  messages: ChatMessage[];
  isOpen: boolean;
}

export interface GlobalChatState {
  messages: ChatMessage[];
  isOpen: boolean;
}
