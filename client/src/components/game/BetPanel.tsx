import { Box, Button, Flex, Input, Tabs, Text } from '@chakra-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import type { BetEntry } from '@/store/gameStore';
import { getLiveMultiplier, useGameStore } from '@/store/gameStore';

const QUICK_AMOUNTS = [1, 5, 10, 25, 50, 100];

function betButtonLabel(myBet: BetEntry | null): string {
  if (myBet === null) return 'PLACE BET';
  if (myBet.status === 'CASHED_OUT')
    return `WON $${((myBet.payoutCents ?? 0) / 100).toFixed(2)}`;
  if (myBet.status === 'LOST')
    return `LOST $${(myBet.betAmountCents / 100).toFixed(2)}`;
  return 'RIDING...';
}

function statusBg(status: BetEntry['status']): string {
  if (status === 'CASHED_OUT') return 'green.900';
  if (status === 'LOST') return 'red.900';
  return 'blue.900';
}

function statusColor(status: BetEntry['status']): string {
  if (status === 'CASHED_OUT') return 'green.300';
  if (status === 'LOST') return 'red.300';
  return 'blue.300';
}

// ── Cash-out button — updates multiplier text via RAF, not React re-renders ──

function CashOutButton({ onCashOut }: { onCashOut: () => void }) {
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let animId: number;
    const update = () => {
      if (labelRef.current) {
        labelRef.current.textContent = `CASH OUT ${getLiveMultiplier().toFixed(2)}x`;
      }
      animId = requestAnimationFrame(update);
    };
    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <Button
      onClick={onCashOut}
      bg="orange.500"
      color="white"
      fontWeight="black"
      fontSize="lg"
      px={6}
      py={8}
      borderRadius="lg"
      _hover={{ bg: 'orange.400' }}
      _active={{ bg: 'orange.600' }}
      fontFamily="mono"
      letterSpacing="wide"
      minW="160px"
      boxShadow="0 0 20px #ff880060"
    >
      <span ref={labelRef}>CASH OUT 1.00x</span>
    </Button>
  );
}

// ── Bet status bar — always rendered; visibility toggled to avoid layout jumps ─

function BetStatusBar({
  myBet,
  show,
}: {
  myBet: BetEntry | null;
  show: boolean;
}) {
  const textRef = useRef<HTMLSpanElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: optional chaining is intentional — deps change when myBet transitions
  useEffect(() => {
    if (!myBet || myBet.status !== 'ACTIVE') return;
    let animId: number;
    const update = () => {
      if (textRef.current) {
        const current = (
          (myBet.betAmountCents * getLiveMultiplier()) /
          100
        ).toFixed(2);
        textRef.current.textContent = `Bet: $${(myBet.betAmountCents / 100).toFixed(2)} — Current: $${current}`;
      }
      animId = requestAnimationFrame(update);
    };
    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, [myBet?.status, myBet?.betAmountCents]);

  return (
    <Box
      mt={3}
      p={2}
      borderRadius="md"
      minH="36px"
      bg={show && myBet ? statusBg(myBet.status) : 'transparent'}
      visibility={show ? 'visible' : 'hidden'}
    >
      {show &&
        myBet &&
        (myBet.status === 'ACTIVE' ? (
          <span
            ref={textRef}
            style={{
              fontSize: 'var(--chakra-font-sizes-sm)',
              color: 'var(--chakra-colors-blue-300)',
              fontFamily: 'monospace',
            }}
          >
            Bet: ${(myBet.betAmountCents / 100).toFixed(2)} — Current: $...
          </span>
        ) : (
          <Text
            fontSize="sm"
            color={statusColor(myBet.status)}
            fontFamily="mono"
          >
            {myBet.status === 'CASHED_OUT'
              ? `Cashed out at ${myBet.cashedOutAt?.toFixed(2)}x — Won $${((myBet.payoutCents ?? 0) / 100).toFixed(2)}`
              : `Lost $${(myBet.betAmountCents / 100).toFixed(2)}`}
          </Text>
        ))}
    </Box>
  );
}

// ── Place bet button — fixed dimensions to prevent layout jumps ──────────────

function PlaceBetButton({
  canBet,
  myBet,
  onPlaceBet,
}: {
  canBet: boolean;
  myBet: BetEntry | null;
  onPlaceBet: () => void;
}) {
  return (
    <Button
      onClick={onPlaceBet}
      disabled={!canBet}
      bg={canBet ? 'green.600' : 'gray.700'}
      color={canBet ? 'white' : 'gray.500'}
      fontWeight="black"
      fontSize="lg"
      px={6}
      py={8}
      borderRadius="lg"
      _hover={{ bg: canBet ? 'green.500' : 'gray.700' }}
      _active={{ bg: 'green.700' }}
      _disabled={{ cursor: 'not-allowed', opacity: 0.6 }}
      fontFamily="mono"
      letterSpacing="wide"
      minW="160px"
      boxShadow={canBet ? '0 0 20px rgba(255,107,0,0.38)' : 'none'}
    >
      {betButtonLabel(myBet)}
    </Button>
  );
}

// ── Shared bet amount input ──────────────────────────────────────────────────

function BetAmountInput({
  amount,
  onChange,
  disabled,
}: {
  amount: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <Box flex={1}>
      <Text
        fontSize="sm"
        color="gray.400"
        mb={1}
        letterSpacing="wide"
        fontWeight="semibold"
      >
        BET AMOUNT
      </Text>
      <Flex align="center" gap={2}>
        <Text color="gray.400" fontSize="lg">
          $
        </Text>
        <Input
          value={amount}
          onChange={e => onChange(e.target.value)}
          type="number"
          min="1"
          step="1"
          bg="gray.800"
          border="1px solid"
          borderColor="gray.500"
          color="white"
          fontFamily="mono"
          fontSize="xl"
          fontWeight="bold"
          px={3}
          py={2}
          borderRadius="md"
          disabled={disabled}
          _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
          _focus={{ borderColor: 'green.500', outline: 'none' }}
        />
      </Flex>
    </Box>
  );
}

// ── BetPanel ────────────────────────────────────────────────────────────────

export function BetPanel() {
  const socket = useSocket();
  const phase = useGameStore(state => state.phase);
  const myBet = useGameStore(state => state.myBet);
  const betError = useGameStore(state => state.betError);
  const clearBetError = useGameStore(state => state.clearBetError);
  const isDemoMode = useGameStore(state => state.isDemoMode);
  const addBet = useGameStore(state => state.addBet);
  const updateBet = useGameStore(state => state.updateBet);
  const myUsername = useAuthStore(
    state => state.user?.displayName ?? state.user?.email?.split('@')[0],
  );

  const [amount, setAmount] = useState('5.00');
  const [autoCashOut, setAutoCashOut] = useState('');
  const [autoPlay, setAutoPlay] = useState(false);
  const [activeTab, setActiveTab] = useState<'manual' | 'auto'>('manual');

  const amountCents = Math.round(Number.parseFloat(amount || '0') * 100);
  const autoCashOutTarget = Number.parseFloat(autoCashOut);
  const hasAutoCashOut =
    !Number.isNaN(autoCashOutTarget) && autoCashOutTarget > 1;
  const canBet = phase === 'WAITING' && myBet === null && amountCents >= 100;
  const canCashOut = phase === 'RUNNING' && myBet?.status === 'ACTIVE';
  const inputDisabled = phase !== 'WAITING' || myBet !== null;

  const handlePlaceBet = useCallback(() => {
    if (!socket || !canBet || !myUsername) return;
    clearBetError();
    addBet(
      {
        userId: myUsername,
        username: myUsername,
        betAmountCents: amountCents,
        status: 'ACTIVE',
      },
      myUsername,
    );
    socket.emit('placeBet', {
      betAmountCents: amountCents,
      isDemo: isDemoMode,
      ...(hasAutoCashOut ? { autoCashOutAt: autoCashOutTarget } : {}),
    });
  }, [
    socket,
    canBet,
    myUsername,
    clearBetError,
    addBet,
    amountCents,
    isDemoMode,
    hasAutoCashOut,
    autoCashOutTarget,
  ]);

  function handleCashOut() {
    if (!socket || !canCashOut || !myBet) return;
    const mult = getLiveMultiplier();
    updateBet({
      userId: myBet.userId,
      username: myBet.username,
      betAmountCents: myBet.betAmountCents,
      status: 'CASHED_OUT',
      cashedOutAt: mult,
      payoutCents: Math.floor(myBet.betAmountCents * mult),
      isOptimistic: true,
    });
    socket.emit('cashOut');
  }

  // Auto-play requires auto exit — turn off if exit target is removed
  useEffect(() => {
    if (autoPlay && !hasAutoCashOut) setAutoPlay(false);
  }, [autoPlay, hasAutoCashOut]);

  // Auto-play: place bet automatically when waiting phase starts and no bet yet
  useEffect(() => {
    if (autoPlay && canBet) {
      handlePlaceBet();
    }
  }, [autoPlay, canBet, handlePlaceBet]);

  const actionButton = canCashOut ? (
    <CashOutButton onCashOut={handleCashOut} />
  ) : (
    <PlaceBetButton canBet={canBet} myBet={myBet} onPlaceBet={handlePlaceBet} />
  );

  return (
    <Box
      bg="gray.900"
      borderRadius="lg"
      border="1px solid"
      borderColor="orange.400"
      p={{ base: 3, lg: 4 }}
    >
      {/*
       * Tabs contain ONLY the config inputs so both tabs have the same height.
       * The action button and quick bets live outside the tabs — this prevents
       * height changes when switching Manual ↔ Auto, which would resize the
       * canvas and displace the chart line.
       */}
      <Tabs.Root
        defaultValue="manual"
        variant="plain"
        size="sm"
        onValueChange={e => setActiveTab(e.value as 'manual' | 'auto')}
      >
        {/* Tab headers */}
        <Tabs.List
          mb={3}
          borderBottom="1px solid"
          borderColor="gray.800"
          gap={0}
        >
          {(['manual', 'auto'] as const).map(tab => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              fontFamily="mono"
              fontSize="xs"
              fontWeight="bold"
              letterSpacing="wide"
              px={3}
              py={1.5}
              color="gray.600"
              _selected={{
                color: 'green.400',
                borderBottom: '2px solid',
                borderColor: 'green.500',
              }}
              _hover={{ color: 'gray.300' }}
            >
              {tab.toUpperCase()}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Manual tab — bet amount only */}
        <Tabs.Content value="manual">
          <BetAmountInput
            amount={amount}
            onChange={setAmount}
            disabled={inputDisabled}
          />
        </Tabs.Content>

        {/* Auto tab — bet amount + auto exit target (same row height as manual) */}
        <Tabs.Content value="auto">
          <Flex gap={3} align="flex-end">
            <BetAmountInput
              amount={amount}
              onChange={setAmount}
              disabled={inputDisabled}
            />

            {/* Auto exit target */}
            <Box minW="90px">
              <Text fontSize="xs" color="gray.500" mb={1} letterSpacing="wide">
                AUTO EXIT
              </Text>
              <Flex align="center" gap={1}>
                <Input
                  value={autoCashOut}
                  onChange={e => setAutoCashOut(e.target.value)}
                  placeholder="—"
                  type="number"
                  min="1.01"
                  step="0.1"
                  bg="gray.800"
                  border="1px solid"
                  borderColor={hasAutoCashOut ? 'yellow.600' : 'gray.700'}
                  color={hasAutoCashOut ? 'yellow.300' : 'gray.500'}
                  fontFamily="mono"
                  fontSize="md"
                  fontWeight="bold"
                  px={2}
                  py={2}
                  borderRadius="md"
                  disabled={myBet !== null}
                  _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                  _focus={{ borderColor: 'yellow.500', outline: 'none' }}
                  _placeholder={{ color: 'gray.600' }}
                />
                {hasAutoCashOut && myBet === null ? (
                  <Box
                    as="button"
                    onClick={() => setAutoCashOut('')}
                    color="gray.400"
                    fontSize="lg"
                    lineHeight="1"
                    px={1}
                    cursor="pointer"
                    _hover={{ color: 'red.400' }}
                    title="Clear auto exit"
                  >
                    ×
                  </Box>
                ) : (
                  <Text color="gray.600" fontSize="sm">
                    x
                  </Text>
                )}
              </Flex>
            </Box>
          </Flex>
        </Tabs.Content>
      </Tabs.Root>

      {/*
       * Error slot — always rendered at fixed height so its appearance never
       * shifts the action row. Uses visibility:hidden when there is no error.
       */}
      <Text
        fontSize="sm"
        color="red.400"
        fontFamily="mono"
        mt={2}
        px={1}
        minH="1.25rem"
        visibility={betError ? 'visible' : 'hidden'}
      >
        {betError ?? '\u00A0'}
      </Text>

      {/*
       * Action row — always the same height regardless of active tab.
       * AUTO toggle is always rendered (visibility:hidden when on manual)
       * so this row never changes height either.
       */}
      <Flex gap={3} align="flex-end" mt={1}>
        <Box flex={1}>
          <Flex gap={2} flexWrap="wrap" align="center">
            <Text fontSize="xs" color="gray.600" alignSelf="center" mr={1}>
              Quick:
            </Text>
            {QUICK_AMOUNTS.map(a => (
              <Button
                key={a}
                size="xs"
                variant="outline"
                borderColor="gray.600"
                color="gray.400"
                fontFamily="mono"
                fontSize="xs"
                onClick={() => setAmount(a.toFixed(2))}
                disabled={inputDisabled}
                _hover={{
                  borderColor: 'green.500',
                  color: 'green.400',
                  bg: 'rgba(255,107,0,0.1)',
                }}
                _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
                px={3}
              >
                ${a}
              </Button>
            ))}
            {/* AUTO toggle — always rendered; invisible on manual to keep row height stable */}
            <Button
              size="xs"
              variant="outline"
              borderColor={
                autoPlay
                  ? 'green.500'
                  : hasAutoCashOut
                    ? 'gray.600'
                    : 'gray.800'
              }
              color={
                autoPlay
                  ? 'green.400'
                  : hasAutoCashOut
                    ? 'gray.500'
                    : 'gray.700'
              }
              fontFamily="mono"
              fontSize="xs"
              disabled={!hasAutoCashOut || activeTab !== 'auto'}
              onClick={() => setAutoPlay(v => !v)}
              visibility={activeTab === 'auto' ? 'visible' : 'hidden'}
              pointerEvents={activeTab === 'auto' ? 'auto' : 'none'}
              _hover={{
                borderColor: 'green.400',
                color: 'green.300',
                bg: 'rgba(255,107,0,0.1)',
              }}
              _disabled={{ opacity: 0.35, cursor: 'not-allowed' }}
              title={
                activeTab !== 'auto'
                  ? undefined
                  : !hasAutoCashOut
                    ? 'Set an AUTO EXIT value to enable auto-play'
                    : autoPlay
                      ? 'Auto-play ON — click to stop'
                      : 'Auto-play: bet automatically each round'
              }
            >
              {autoPlay ? 'AUTO ON' : 'AUTO'}
            </Button>
          </Flex>
        </Box>
        <Box flexShrink={0}>{actionButton}</Box>
      </Flex>

      {/*
       * Status bar — always rendered with a fixed min-height so its appearance
       * never shifts the chart above. Uses visibility:hidden when not active.
       */}
      <BetStatusBar
        myBet={myBet}
        show={myBet !== null && phase !== 'WAITING'}
      />
    </Box>
  );
}
