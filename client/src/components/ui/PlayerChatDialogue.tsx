import type { Socket } from 'socket.io-client';
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
  const playerChats = useChatStore(state => state.playerChats);
  const closePlayerChat = useChatStore(state => state.closePlayerChat);

  const chatRoom = playerChats[roomId];

  if (!chatRoom?.isOpen) return null;

  const handleSendMessage = (message: string) => {
    if (!socket) return;

    socket.emit('sendPlayerChatMessage', {
      roomId,
      message,
    });
  };

  const handleClose = () => {
    if (socket) {
      socket.emit('leavePlayerChat', { roomId });
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
      themeColor="#4CAF50"
      width="500px"
      height="400px"
      placeholder="Type your message..."
    />
  );
}
