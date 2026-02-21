import {
  Box,
  Button,
  Flex,
  IconButton,
  Input,
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
import { WalletWidget } from './WalletWidget';

// ── Inline global chat panel ───────────────────────────────────────────────

function InlineChatPanel() {
  const socket = useSocket();
  const user = useAuthStore(state => state.user);
  const messages = useChatStore(state => state.globalChat.messages);
  const openGlobalChat = useChatStore(state => state.openGlobalChat);
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
      w={{ base: '190px', lg: '230px' }}
      flexShrink={0}
      borderRight="1px solid"
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
        <Text fontSize="xs" fontWeight="bold" color="gray.400" letterSpacing="widest">
          GLOBAL CHAT
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
            <Box
              key={`${new Date(msg.timestamp).getTime()}-${msg.senderId}`}
              mb={1.5}
            >
              <Text as="span" fontSize="xs" color="green.400" fontWeight="medium">
                {msg.senderName}:{' '}
              </Text>
              <Text as="span" fontSize="xs" color="gray.300">
                {msg.message}
              </Text>
            </Box>
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
  const user = useAuthStore(state => state.user);
  const clearAuth = useAuthStore(state => state.clearAuth);
  const { globalChat, closeGlobalChat, playerChats } = useChatStore(
    state => state,
  );

  function handleLogout() {
    clearAuth();
    window.location.href = '/';
  }

  const handleSendGlobal = (message: string) => {
    socket?.emit('chatMessage', { message });
  };

  return (
    <Box
      minH="100vh"
      bg="#0d0d0d"
      display="flex"
      flexDirection="column"
      fontFamily="mono"
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
          >
            FIRECRACKER
          </Text>
        </Flex>

        <Flex align="center" gap={3}>
          <WalletWidget />
          <Text fontSize="sm" color="gray.400">
            {user?.displayName ?? user?.email}
          </Text>
          <Button
            size="xs"
            variant="outline"
            borderColor="gray.600"
            color="gray.400"
            fontFamily="mono"
            onClick={handleLogout}
            _hover={{ borderColor: 'red.500', color: 'red.400' }}
          >
            Logout
          </Button>
        </Flex>
      </Flex>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <Flex flex={1} overflow="hidden">
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

      {/* ── Floating pop-out chat (triggered by inline panel's pop-out button) ── */}
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
