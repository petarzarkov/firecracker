import { SOCKET_CLIENT_EVENTS } from '@firecracker/contracts';
import { Box, Flex, Image, Tabs, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { LazyChatWindow } from '@/components/ui/LazyChatWindow';
import { CHAT_THEME } from '@/theme/chat';
import { PlayerChatDialogue } from '@/components/ui/PlayerChatDialogue';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useGameSocket } from '@/systems/network/useGameSocket';
import { useLayout } from '@/hooks/useWideLayout';
import { BetPanel, CashOutBar } from './BetPanel';
import { InlineChatPanel } from './InlineChatPanel';
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

/**
 * A tablet keeps the bet panel on screen permanently and drops the tab that held
 * it - there is room for both, which is the whole reason the layout exists.
 */
const TABLET_TABS = MOBILE_TABS.filter(([value]) => value !== 'game');

export function Game({
  onSignIn,
  onConvert,
}: {
  onSignIn: () => void;
  onConvert: () => void;
}) {
  useGameSocket();

  // Only the live layout is mounted - see `useLayout` for what mounting more than
  // one costs.
  const layout = useLayout();
  const wide = layout === 'desktop';
  /**
   * Controlled, so the pinned cash-out knows whether the panel is already on
   * screen - two identical CASH OUT buttons, one over the other, is what an
   * uncontrolled tab strip gave.
   */
  const [tab, setTab] = useState(layout === 'tablet' ? 'players' : 'game');
  const signedIn = useAuthStore((state) => state.isAuthenticated);
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
      {/*
        The app had no heading of any level on any screen - "FIRECRACKER", "MY BETS"
        and "PLAYERS" are all styled `Text` - so a screen reader had nothing to
        navigate by and the document outline was empty. This is the h1; the panels
        below are h2s. Off-screen rather than hidden, because `display: none` would
        take it out of the accessibility tree too.
      */}
      <Text
        as="h1"
        position="absolute"
        w="1px"
        h="1px"
        overflow="hidden"
        clipPath="inset(50%)"
        whiteSpace="nowrap"
      >
        Firecracker — a provably-fair crash game
      </Text>

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
          {signedIn && <WalletWidget />}
          <UserMenu onSignIn={onSignIn} onConvert={onConvert} />
        </Flex>
      </Flex>

      {/* Phone and tablet (below lg) */}
      {!wide && (
        <Box display="flex" flex={1} flexDirection="column" overflow="hidden">
          {/* Chart — fills all space above the panel */}
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

          {/*
            Cash out, where a tab cannot hide it.
            
            On a phone the controls are one tab among four and nothing switches back
            when a round starts, so a player who opened chat during the betting
            window had no way to take the money while the multiplier climbed. This
            renders only while there is something to take. The tablet has the panel
            on screen already.
          */}
          {layout === 'phone' && tab !== 'game' && <CashOutBar />}

          <Flex
            flexShrink={0}
            /*
             * `dvh`, matching the root's `100dvh`. In `vh` this panel is measured
             * against the *large* viewport while its parent is measured against the
             * live one, so while a phone's address bar is showing the tabs claim
             * more than their share and the chart above them is squeezed by the
             * difference.
             *
             * `clamp`, because a fraction alone is wrong at both ends: on a 1180px
             * tablet 30dvh left a band of dead black under the controls, and in
             * landscape it left 117px, which is not enough to show the stake field
             * at all - so `PLACE BET` was live above an amount nobody could see.
             */
            h="clamp(170px, 34dvh, 330px)"
            overflow="hidden"
          >
            {/*
              The tablet keeps the controls beside the tabs rather than inside them.
              A 820-point iPad was being handed the phone's drawer, with the width
              for both sitting unused.
            */}
            {layout === 'tablet' && (
              <Box
                w="52%"
                overflowY="auto"
                bg="gray.900"
                borderTop="1px solid"
                borderRight="1px solid"
                borderColor="gray.700"
                p={2}
              >
                <BetPanel onSignIn={onSignIn} />
              </Box>
            )}

            <Tabs.Root
              value={tab}
              onValueChange={(event) => setTab(event.value)}
              display="flex"
              flexDirection="column"
              flex={1}
              minW={0}
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
                {(layout === 'tablet' ? TABLET_TABS : MOBILE_TABS).map(
                  ([value, label]) => (
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
                  ),
                )}
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
                    <BetPanel onSignIn={onSignIn} />
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
          </Flex>
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
            <BetPanel onSignIn={onSignIn} />
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
