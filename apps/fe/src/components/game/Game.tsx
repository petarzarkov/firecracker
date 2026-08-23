import { SOCKET_CLIENT_EVENTS } from '@firecracker/contracts';
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
import { LazyChatWindow } from '@/components/ui/LazyChatWindow';
import { CHAT_THEME } from '@/theme/chat';
import { PlayerChatDialogue } from '@/components/ui/PlayerChatDialogue';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useGameSocket } from '@/systems/network/useGameSocket';
import { useWideLayout } from '@/hooks/useWideLayout';
import { BetPanel } from './BetPanel';
import { ConnectionBanner } from './ConnectionBanner';
import { CrashChart } from './CrashChart';
import { PlayerHistory } from './PlayerHistory';
import { PlayerList } from './PlayerList';
import { RoundHistory } from './RoundHistory';
import { UserMenu } from './UserMenu';
import { WalletWidget } from './WalletWidget';

/** The mobile tab bar. Each `value` names the `Tabs.Content` it reveals. */
const MOBILE_TABS = [
  ['game', 'CONTROLS'],
  ['players', 'PLAYERS'],
  ['history', 'MY BETS'],
  ['chat', 'CHAT'],
] as const;

function InlineChatPanel({ full = false }: { full?: boolean }) {
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

export function Game() {
  useGameSocket();

  // Only the live layout is mounted - see `useWideLayout` for what mounting both
  // costs.
  const wide = useWideLayout();
  const socket = useSocket();
  const { globalChat, closeGlobalChat, playerChats } = useChatStore(
    (state) => state,
  );

  const handleSendGlobal = (message: string) => {
    socket?.emit(SOCKET_CLIENT_EVENTS.CHAT_MESSAGE, { message });
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
      <ConnectionBanner />

      {/* Header */}
      <Flex
        px={{ base: 2, lg: 4 }}
        py={{ base: 1, lg: 2 }}
        bg="gray.900"
        borderBottom="1px solid"
        borderColor="gray.700"
        align="center"
        justify="space-between"
        flexShrink={0}
      >
        <Flex align="center" gap={2}>
          <Image
            src="/png/android-chrome-192x192.png"
            alt="Firecracker"
            boxSize={{ base: '28px', lg: '36px' }}
            objectFit="contain"
          />
          <Text
            fontSize="lg"
            fontWeight="black"
            letterSpacing="widest"
            display={{ base: 'none', sm: 'block' }}
            style={{
              background:
                'linear-gradient(135deg, #ff9500 0%, #ff6b00 50%, #e74c3c 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            FIRECRACKER
          </Text>
        </Flex>

        <Flex align="center" gap={{ base: 1, lg: 3 }}>
          <WalletWidget />
          <UserMenu />
        </Flex>
      </Flex>

      {/* Mobile layout (below lg) */}
      {!wide && (
        <Box display="flex" flex={1} flexDirection="column" overflow="hidden">
          {/* Chart — fills all space above the fixed tab panel */}
          <Box
            flex={1}
            minH={0}
            overflow="hidden"
            p={1.5}
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
            /*
             * `dvh`, matching the root's `100dvh`. In `vh` this panel is measured
             * against the *large* viewport while its parent is measured against the
             * live one, so while a phone's address bar is showing the tabs claim
             * more than their share and the chart above them is squeezed by the
             * difference.
             */
            h="30dvh"
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
              {MOBILE_TABS.map(([value, label]) => (
                <Tabs.Trigger
                  key={value}
                  value={value}
                  flex={1}
                  fontFamily="mono"
                  fontSize="2xs"
                  letterSpacing="wide"
                  px={1}
                  py={1.5}
                  minH="auto"
                  color="gray.500"
                  _selected={{ color: 'green.400', bg: 'gray.800' }}
                >
                  {label}
                </Tabs.Trigger>
              ))}
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
                <Box h="full" overflowY="auto" p={0}>
                  <BetPanel />
                </Box>
              </Tabs.Content>

              <Tabs.Content value="history" h="full" overflow="hidden" p={0}>
                <PlayerHistory />
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
      )}

      {/* Desktop layout (lg+) — 3 columns */}
      {wide && (
        <Flex flex={1} overflow="hidden">
          {/* Left: player bet history (top half) + global chat (bottom half) */}
          <Flex
            direction="column"
            w={{ base: '185px', lg: '205px' }}
            flexShrink={0}
            borderRight="1px solid"
            borderColor="#2e2e2e"
            overflow="hidden"
          >
            <PlayerHistory />
            <InlineChatPanel full />
          </Flex>

          {/* Center: chart + bet panel */}
          <Flex flex={1} direction="column" p={3} gap={2} overflow="hidden">
            <CrashChart />
            <BetPanel />
          </Flex>

          {/* Right sidebar: history + players */}
          <Flex
            direction="column"
            w={{ base: '210px', lg: '265px' }}
            flexShrink={0}
            p={3}
            gap={3}
            bg="gray.900"
            borderLeft="1px solid"
            borderColor="#2e2e2e"
            overflow="hidden"
          >
            <RoundHistory />
            <Box
              borderTop="1px solid"
              borderColor="#2e2e2e"
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
      )}

      {/* Floating pop-out chat */}
      {globalChat.isOpen && (
        <LazyChatWindow
          title="Chat"
          messages={globalChat.messages}
          isOpen={globalChat.isOpen}
          onClose={closeGlobalChat}
          onSendMessage={handleSendGlobal}
          position="center"
          themeColor={CHAT_THEME.lobby}
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
