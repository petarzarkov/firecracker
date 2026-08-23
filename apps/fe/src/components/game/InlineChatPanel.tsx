import { Box, Flex, IconButton, Image, Input, Text } from '@chakra-ui/react';
import { SOCKET_CLIENT_EVENTS } from '@firecracker/contracts';
import { useEffect, useRef, useState } from 'react';
import { FiExternalLink } from 'react-icons/fi';
import { IoSend } from 'react-icons/io5';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';

/**
 * The lobby chat, inline in a column or a tab.
 *
 * Lifted out of `Game` when that file went past its line budget: it is a panel with
 * its own socket, its own store slice and its own scroll behaviour, and it shares
 * nothing with the three layouts but a place to sit.
 */
export function InlineChatPanel({ full = false }: { full?: boolean }) {
  const socket = useSocket();
  const user = useAuthStore((state) => state.user);
  const messages = useChatStore((state) => state.globalChat.messages);
  const openGlobalChat = useChatStore((state) => state.openGlobalChat);
  const connectedPlayers = useChatStore((state) => state.connectedPlayers);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — scroll only when count changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;
    socket.emit(SOCKET_CLIENT_EVENTS.CHAT_MESSAGE, { message: input.trim() });
    setInput('');
  };

  return (
    <Flex
      direction="column"
      w={full ? '100%' : { base: '185px', lg: '205px' }}
      h={full ? '100%' : undefined}
      flex={full ? 1 : undefined}
      flexShrink={full ? undefined : 0}
      borderRight={full ? undefined : '1px solid'}
      borderColor="gray.700"
      bg="gray.900"
      overflow="hidden"
    >
      {/* Header */}
      <Flex
        px={3}
        py={2}
        align="center"
        justify="space-between"
        borderBottom="1px solid"
        borderColor="gray.700"
        flexShrink={0}
      >
        <Text
          as="h2"
          fontSize="xs"
          fontWeight="bold"
          color="gray.400"
          letterSpacing="widest"
        >
          CHAT
          {connectedPlayers > 0 && (
            <Text as="span" color="green.500" fontWeight="normal" ml={1}>
              ({connectedPlayers})
            </Text>
          )}
        </Text>
        <IconButton
          aria-label="Pop out chat"
          size="2xs"
          variant="ghost"
          color="gray.500"
          _hover={{ color: 'gray.200' }}
          onClick={openGlobalChat}
          title="Pop out"
        >
          <FiExternalLink size={14} />
        </IconButton>
      </Flex>

      {/* Messages */}
      <Box
        ref={scrollRef}
        flex={1}
        overflowY="auto"
        p={2}
        css={{
          '&::-webkit-scrollbar': { width: '5px' },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(255,255,255,0.04)',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255,255,255,0.22)',
            borderRadius: '3px',
          },
        }}
      >
        {messages.length === 0 ? (
          <Text fontSize="xs" color="#888" textAlign="center" mt={6} px={1}>
            No messages yet
          </Text>
        ) : (
          messages.map((msg) => (
            <Flex
              key={`${new Date(msg.timestamp).getTime()}-${msg.senderId}`}
              mb={1.5}
              gap={1.5}
              align="flex-start"
            >
              {msg.senderPicture ? (
                <Image
                  src={msg.senderPicture}
                  alt={msg.senderName}
                  boxSize="18px"
                  borderRadius="full"
                  objectFit="cover"
                  flexShrink={0}
                  mt="2px"
                />
              ) : (
                <Flex
                  w="18px"
                  h="18px"
                  borderRadius="full"
                  bg="green.800"
                  align="center"
                  justify="center"
                  flexShrink={0}
                  mt="2px"
                >
                  <Text
                    fontSize="9px"
                    fontWeight="bold"
                    color="white"
                    lineHeight={1}
                  >
                    {msg.senderName.slice(0, 1).toUpperCase()}
                  </Text>
                </Flex>
              )}
              <Box flex={1} minW={0}>
                <Text
                  as="span"
                  fontSize="xs"
                  color="green.400"
                  fontWeight="medium"
                >
                  {msg.senderName}:{' '}
                </Text>
                <Text as="span" fontSize="xs" color="gray.100">
                  {msg.message}
                </Text>
              </Box>
            </Flex>
          ))
        )}
      </Box>

      {/* Input — authenticated only (server rejects guest send attempts) */}
      {user ? (
        <Box
          as="form"
          onSubmit={handleSend}
          p={2}
          borderTop="1px solid"
          borderColor="gray.700"
          flexShrink={0}
        >
          <Flex gap={1}>
            <Input
              size="xs"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Say something..."
              bg="#1e1e1e"
              border="1px solid"
              borderColor="#333"
              color="gray.200"
              borderRadius="sm"
              _placeholder={{ color: '#777', fontSize: '11px' }}
              _focus={{ borderColor: 'green.600', outline: 'none' }}
              autoComplete="off"
              maxLength={200}
            />
            <IconButton
              type="submit"
              aria-label="Send"
              size="xs"
              disabled={!input.trim()}
              bg="green.700"
              color="white"
              _hover={{ bg: 'green.600' }}
              _disabled={{ opacity: 0.4 }}
              borderRadius="sm"
              flexShrink={0}
            >
              <IoSend size={14} />
            </IconButton>
          </Flex>
        </Box>
      ) : (
        <Box p={2} borderTop="1px solid" borderColor="gray.700" flexShrink={0}>
          <Text fontSize="xs" color="gray.600" textAlign="center">
            Login to chat
          </Text>
        </Box>
      )}
    </Flex>
  );
}
