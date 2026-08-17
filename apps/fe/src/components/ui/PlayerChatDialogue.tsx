import { GAME_CLIENT_EVENTS } from '@firecracker/contracts';
import type { Socket } from '@/systems/network/socket';
import { CHAT_THEME } from '@/theme/chat';
import { useChatStore } from '../../store/chatStore';
import { ChatWindow } from './ChatWindow';

interface PlayerChatDialogueProps {
  roomId: string;
  socket: Socket | null;
}

export function PlayerChatDialogue({
  roomId,
  socket,
}: PlayerChatDialogueProps) {
  const playerChats = useChatStore((state) => state.playerChats);
  const closePlayerChat = useChatStore((state) => state.closePlayerChat);

  const chatRoom = playerChats[roomId];

  if (!chatRoom?.isOpen) return null;

  const handleSendMessage = (message: string) => {
    if (!socket) return;

    socket.emit(GAME_CLIENT_EVENTS.SEND_PLAYER_CHAT, {
      roomId,
      message,
    });
  };

  const handleClose = () => {
    if (socket) {
      socket.emit(GAME_CLIENT_EVENTS.LEAVE_PLAYER_CHAT, { roomId });
    }
    closePlayerChat(roomId);
  };

  return (
    <ChatWindow
      title={`${chatRoom.creatorName}'s Chat`}
      messages={chatRoom.messages}
      isOpen={chatRoom.isOpen}
      onClose={handleClose}
      onSendMessage={handleSendMessage}
      position="center"
      themeColor={CHAT_THEME.direct}
      width="500px"
      height="400px"
      placeholder="Type your message..."
    />
  );
}
