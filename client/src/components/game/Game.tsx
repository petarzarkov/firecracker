import {
  Box,
  Flex,
  IconButton,
  Image,
  Input,
  Tabs,
  Text,
} from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { FiExternalLink } from 'react-icons/fi';
import { IoSend } from 'react-icons/io5';
import { ChatWindow } from '@/components/ui/ChatWindow';
import { PlayerChatDialogue } from '@/components/ui/PlayerChatDialogue';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useGameSocket } from '@/systems/network/useGameSocket';
import { BetPanel } from './BetPanel';
import { CrashChart } from './CrashChart';
import { PlayerList } from './PlayerList';
import { RoundHistory } from './RoundHistory';
import { UserMenu } from './UserMenu';
import { WalletWidget } from './WalletWidget';

// ── Inline global chat panel ───────────────────────────────────────────────

function InlineChatPanel({ full = false }: { full?: boolean }) {
  const socket = useSocket();
  const user = useAuthStore(state => state.user);
  const messages = useChatStore(state => state.globalChat.messages);
  const openGlobalChat = useChatStore(state => state.openGlobalChat);
  const connectedPlayers = useChatStore(state => state.connectedPlayers);
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
    socket.emit('chatMessage', { message: input.trim() });
    setInput('');
  };

  return (
    <Flex
      direction="column"
      w={full ? '100%' : { base: '190px', lg: '230px' }}
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
          fontSize="xs"
          fontWeight="bold"
          color="gray.400"
          letterSpacing="widest"
        >
          GLOBAL CHAT
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
          <FiExternalLink size={11} />
        </IconButton>
      </Flex>

      {/* Messages */}
      <Box
        ref={scrollRef}
        flex={1}
        overflowY="auto"
        p={2}
        css={{
          '&::-webkit-scrollbar': { width: '3px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255,255,255,0.12)',
            borderRadius: '2px',
          },
        }}
      >
        {messages.length === 0 ? (
          <Text fontSize="xs" color="gray.600" textAlign="center" mt={6} px={1}>
            No messages yet
          </Text>
        ) : (
          messages.map(msg => (
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
                  boxSize="14px"
                  borderRadius="full"
                  objectFit="cover"
                  flexShrink={0}
                  mt="2px"
                />
              ) : (
                <Flex
                  w="14px"
                  h="14px"
                  borderRadius="full"
                  bg="green.800"
                  align="center"
                  justify="center"
                  flexShrink={0}
                  mt="2px"
                >
                  <Text
                    fontSize="7px"
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
                <Text as="span" fontSize="xs" color="gray.300">
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
              onChange={e => setInput(e.target.value)}
              placeholder="Say something..."
              bg="gray.800"
              border="1px solid"
              borderColor="gray.700"
              color="gray.200"
              borderRadius="sm"
              _placeholder={{ color: 'gray.600', fontSize: '11px' }}
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
              <IoSend size={11} />
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

// ── Main game component ────────────────────────────────────────────────────

export function Game() {
  useGameSocket();

  const socket = useSocket();
  const { globalChat, closeGlobalChat, playerChats } = useChatStore(
    state => state,
  );

  const handleSendGlobal = (message: string) => {
    socket?.emit('chatMessage', { message });
  };

  return (
    <Box
      h="100dvh"
      bg="#0d0d0d"
      display="flex"
      flexDirection="column"
      fontFamily="mono"
      overflow="hidden"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Flex
        px={4}
        py={2}
        bg="gray.900"
        borderBottom="1px solid"
        borderColor="gray.700"
        align="center"
        justify="space-between"
        flexShrink={0}
      >
        <Flex align="center" gap={2}>
          <img
            src="/png/android-chrome-192x192.png"
            alt="Firecracker"
            style={{ width: 28, height: 28, objectFit: 'contain' }}
          />
          <Text
            fontSize="lg"
            fontWeight="black"
            color="green.400"
            letterSpacing="widest"
            style={{ textShadow: '0 0 10px #4CAF50' }}
            display={{ base: 'none', sm: 'block' }}
          >
            FIRECRACKER
          </Text>
        </Flex>

        <Flex align="center" gap={3}>
          <WalletWidget />
          <UserMenu />
        </Flex>
      </Flex>

      {/* ── Mobile layout (base → lg) ───────────────────────────────────── */}
      <Box
        display={{ base: 'flex', lg: 'none' }}
        flex={1}
        flexDirection="column"
        overflow="hidden"
      >
        {/* Chart — fills all space above the fixed tab panel */}
        <Box
          flex={1}
          minH={0}
          overflow="hidden"
          p={2}
          pb={1}
          display="flex"
          flexDirection="column"
        >
          <CrashChart />
        </Box>

        {/* Tab panel — fixed height, never grows with content */}
        <Tabs.Root
          defaultValue="game"
          display="flex"
          flexDirection="column"
          h="30vh"
          flexShrink={0}
          overflow="hidden"
          variant="subtle"
        >
          {/* Tab bar */}
          <Tabs.List
            bg="gray.900"
            borderTop="1px solid"
            borderColor="gray.700"
            flexShrink={0}
          >
            <Tabs.Trigger
              value="game"
              flex={1}
              fontFamily="mono"
              fontSize="xs"
              letterSpacing="wide"
              color="gray.500"
              _selected={{ color: 'green.400', bg: 'gray.800' }}
            >
              CONTROLS
            </Tabs.Trigger>
            <Tabs.Trigger
              value="players"
              flex={1}
              fontFamily="mono"
              fontSize="xs"
              letterSpacing="wide"
              color="gray.500"
              _selected={{ color: 'green.400', bg: 'gray.800' }}
            >
              PLAYERS
            </Tabs.Trigger>
            <Tabs.Trigger
              value="chat"
              flex={1}
              fontFamily="mono"
              fontSize="xs"
              letterSpacing="wide"
              color="gray.500"
              _selected={{ color: 'green.400', bg: 'gray.800' }}
            >
              CHAT
            </Tabs.Trigger>
          </Tabs.List>

          {/* Content area — fills rest of tab panel, each panel scrolls */}
          <Box flex={1} minH={0} overflow="hidden">
            <Tabs.Content
              value="game"
              h="full"
              overflow="hidden"
              p={0}
              bg="gray.900"
            >
              <Box h="full" overflowY="auto" p={3}>
                <BetPanel />
              </Box>
            </Tabs.Content>

            <Tabs.Content value="players" h="full" overflowY="auto" p={0}>
              <Flex direction="column" p={2} gap={3}>
                <RoundHistory />
                <PlayerList />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value="chat" h="full" overflow="hidden" p={0}>
              <InlineChatPanel full />
            </Tabs.Content>
          </Box>
        </Tabs.Root>
      </Box>

      {/* ── Desktop layout (lg+) — 3 columns ───────────────────────────── */}
      <Flex flex={1} overflow="hidden" display={{ base: 'none', lg: 'flex' }}>
        {/* Left: inline chat */}
        <InlineChatPanel />

        {/* Center: chart + bet panel */}
        <Flex flex={1} direction="column" p={4} gap={3} overflow="hidden">
          <CrashChart />
          <BetPanel />
        </Flex>

        {/* Right sidebar: history + players */}
        <Flex
          direction="column"
          w={{ base: '200px', lg: '260px' }}
          flexShrink={0}
          p={3}
          gap={3}
          bg="gray.900"
          borderLeft="1px solid"
          borderColor="gray.700"
          overflow="hidden"
        >
          <RoundHistory />
          <Box
            borderTop="1px solid"
            borderColor="gray.700"
            pt={3}
            flex={1}
            overflow="hidden"
            display="flex"
            flexDirection="column"
          >
            <PlayerList />
          </Box>
        </Flex>
      </Flex>

      {/* ── Floating pop-out chat ───────────────────────────────────────── */}
      {globalChat.isOpen && (
        <ChatWindow
          title="Global Chat"
          messages={globalChat.messages}
          isOpen={globalChat.isOpen}
          onClose={closeGlobalChat}
          onSendMessage={handleSendGlobal}
          position="center"
          themeColor="#2196F3"
          width="500px"
          height="500px"
          placeholder="Message all players..."
        />
      )}

      {/* Player-to-player chats */}
      {Object.entries(playerChats).map(([roomId, chatRoom]) =>
        chatRoom.isOpen ? (
          <PlayerChatDialogue key={roomId} roomId={roomId} socket={socket} />
        ) : null,
      )}
    </Box>
  );
}
