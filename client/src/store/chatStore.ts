import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ChatMessage, GlobalChatState, PlayerChatRoom } from '../types';

interface ChatState {
  playerChats: Record<string, PlayerChatRoom>;
  globalChat: GlobalChatState;

  // Player chat actions
  createPlayerChat: (
    roomId: string,
    participants: string[],
    participantNames: Record<string, string>,
    creatorId: string,
    creatorName: string,
  ) => void;
  openPlayerChat: (roomId: string) => void;
  closePlayerChat: (roomId: string) => void;
  addPlayerChatMessage: (roomId: string, message: ChatMessage) => void;

  // Global chat actions
  toggleGlobalChat: () => void;
  openGlobalChat: () => void;
  closeGlobalChat: () => void;
  addGlobalChatMessage: (message: ChatMessage) => void;
  setGlobalChatMessages: (messages: ChatMessage[]) => void;
}

export const useChatStore = create<ChatState>()(
  immer(set => ({
    playerChats: {},
    globalChat: {
      messages: [],
      isOpen: false,
    },

    createPlayerChat: (
      roomId,
      participants,
      participantNames,
      creatorId,
      creatorName,
    ) => {
      // Exit pointer lock to show cursor
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }

      set(state => {
        if (!state.playerChats[roomId]) {
          state.playerChats[roomId] = {
            roomId,
            participants,
            participantNames,
            creatorId,
            creatorName,
            messages: [],
            isOpen: true,
          };
        } else {
          state.playerChats[roomId].isOpen = true;
        }
      });
    },

    openPlayerChat: roomId => {
      // Exit pointer lock to show cursor
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }

      set(state => {
        if (state.playerChats[roomId]) {
          state.playerChats[roomId].isOpen = true;
        }
      });
    },

    closePlayerChat: roomId => {
      set(state => {
        if (state.playerChats[roomId]) {
          state.playerChats[roomId].isOpen = false;
        }
      });
    },

    addPlayerChatMessage: (roomId, message) => {
      set(state => {
        if (state.playerChats[roomId]) {
          const messages = state.playerChats[roomId].messages;

          // Check for duplicate message (same sender, message, and timestamp within 1 second)
          const isDuplicate = messages.some(existingMsg => {
            const timeDiff = Math.abs(
              new Date(existingMsg.timestamp).getTime() -
                new Date(message.timestamp).getTime(),
            );
            return (
              existingMsg.senderId === message.senderId &&
              existingMsg.message === message.message &&
              timeDiff < 1000 // Within 1 second
            );
          });

          if (!isDuplicate) {
            state.playerChats[roomId].messages.push(message);
          }
        }
      });
    },

    toggleGlobalChat: () => {
      set(state => {
        state.globalChat.isOpen = !state.globalChat.isOpen;

        // Exit pointer lock if opening
        if (state.globalChat.isOpen && document.pointerLockElement) {
          document.exitPointerLock();
        }
      });
    },

    openGlobalChat: () => {
      // Exit pointer lock to show cursor
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }

      set(state => {
        state.globalChat.isOpen = true;
      });
    },

    closeGlobalChat: () => {
      set(state => {
        state.globalChat.isOpen = false;
      });
    },

    addGlobalChatMessage: message => {
      set(state => {
        // Check for duplicate message (same sender, message, and timestamp within 1 second)
        const isDuplicate = state.globalChat.messages.some(existingMsg => {
          const timeDiff = Math.abs(
            new Date(existingMsg.timestamp).getTime() -
              new Date(message.timestamp).getTime(),
          );
          return (
            existingMsg.senderId === message.senderId &&
            existingMsg.message === message.message &&
            timeDiff < 1000 // Within 1 second
          );
        });

        if (!isDuplicate) {
          state.globalChat.messages.push(message);
        }
      });
    },

    setGlobalChatMessages: messages => {
      set(state => {
        // Convert timestamp strings to Date objects if needed
        const processedMessages = messages.map(msg => ({
          ...msg,
          timestamp:
            msg.timestamp instanceof Date
              ? msg.timestamp
              : new Date(msg.timestamp),
        }));
        state.globalChat.messages = processedMessages;
      });
    },
  })),
);
