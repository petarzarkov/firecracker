import { Box, Flex, IconButton, Stack, Text } from '@chakra-ui/react';
import { useMemo } from 'react';
import { MdExpandMore } from 'react-icons/md';
import type { Socket } from 'socket.io-client';
import { useMobile } from '../../hooks/useMobile';
import { useChatStore } from '../../store/chatStore';
import { ChatWindow } from './ChatWindow';

interface GlobalChatProps {
  socket: Socket | null;
}

function CollapsedChatOverlay() {
  const globalChat = useChatStore(state => state.globalChat);
  const openGlobalChat = useChatStore(state => state.openGlobalChat);
  const isMobile = useMobile();

  const recentMessages = useMemo(() => {
    // Show only 1 message on mobile to save space, 3 on desktop
    const count = isMobile ? 1 : 3;
    return globalChat.messages.slice(-count);
  }, [globalChat.messages, isMobile]);

  return (
    <Box
      position="fixed"
      // Mobile: Top Left (below online count). Desktop: Bottom Left
      top={{ base: '60px', md: 'auto' }}
      bottom={{ base: 'auto', md: '20px' }}
      left={{ base: '10px', md: '10px' }}
      width={{ base: '200px', md: '280px' }}
      maxW="90vw"
      bg="rgba(18, 20, 24, 0.75)"
      backdropFilter="blur(10px)"
      border="1px solid"
      borderColor="whiteAlpha.200"
      borderRadius="lg"
      boxShadow="0 0 10px rgba(0, 0, 0, 0.3)"
      zIndex="90"
      pointerEvents="auto"
      onClick={openGlobalChat}
      cursor="pointer"
      _hover={{
        borderColor: 'whiteAlpha.300',
        boxShadow: '0 0 15px rgba(0, 0, 0, 0.4)',
      }}
      transition="all 0.2s"
    >
      {/* Header */}
      <Flex
        px={3}
        py={2}
        justify="space-between"
        align="center"
        borderBottom="1px solid"
        borderColor="whiteAlpha.100"
        bg="blackAlpha.300"
        borderTopRadius="lg"
      >
        <Text
          fontSize="xs"
          fontWeight="bold"
          color="gray.200"
          fontFamily="monospace"
        >
          Global Chat
        </Text>
        <IconButton
          aria-label="Expand chat"
          size="xs"
          variant="ghost"
          color="gray.400"
          _hover={{ color: 'gray.200', bg: 'whiteAlpha.100' }}
          onClick={e => {
            e.stopPropagation();
            openGlobalChat();
          }}
        >
          <MdExpandMore />
        </IconButton>
      </Flex>

      {/* Messages */}
      <Box
        maxH="150px"
        overflowY="auto"
        p={2}
        css={{
          '&::-webkit-scrollbar': { width: '4px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '2px',
          },
        }}
      >
        {recentMessages.length === 0 ? (
          <Text fontSize="xs" color="gray.500" textAlign="center" py={1}>
            No messages yet
          </Text>
        ) : (
          <Stack gap={1}>
            {recentMessages.map(msg => (
              <Box
                key={
                  new Date(msg.timestamp).getTime().toString() + msg.senderId
                }
                px={2}
                py={1}
                borderRadius="sm"
                bg="whiteAlpha.50"
              >
                <Text fontSize="2xs" color="gray.400" mb={0.5}>
                  {msg.senderName}:
                </Text>
                <Text
                  fontSize="xs"
                  color="gray.200"
                  maxLines={2}
                  wordBreak="break-word"
                >
                  {msg.message}
                </Text>
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      {/* Footer - Hidden on mobile to save vertical space */}
      {!isMobile && (
        <Box
          px={3}
          py={1}
          borderTop="1px solid"
          borderColor="whiteAlpha.100"
          bg="blackAlpha.200"
          borderBottomRadius="lg"
        >
          <Text fontSize="10px" color="gray.500" textAlign="center">
            Click to expand
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function GlobalChat({ socket }: GlobalChatProps) {
  const globalChat = useChatStore(state => state.globalChat);
  const closeGlobalChat = useChatStore(state => state.closeGlobalChat);

  const handleSendMessage = (message: string) => {
    if (!socket) return;
    // Server listens on 'chatMessage' (EventsGateway.handleChatMessage)
    socket.emit('chatMessage', { message });
  };

  return (
    <>
      <CollapsedChatOverlay />
      {globalChat.isOpen && (
        <ChatWindow
          title="Global Chat"
          messages={globalChat.messages}
          isOpen={globalChat.isOpen}
          onClose={closeGlobalChat}
          onSendMessage={handleSendMessage}
          position="center"
          themeColor="#2196F3"
          width="500px"
          height="500px"
          placeholder="Message all players..."
        />
      )}
    </>
  );
}
