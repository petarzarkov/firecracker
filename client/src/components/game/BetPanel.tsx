import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '@/SocketContext';
import type { BetEntry } from '@/store/gameStore';
import { liveRef, useGameStore } from '@/store/gameStore';

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

function CashOutButton({
  loading,
  onCashOut,
}: {
  loading: boolean;
  onCashOut: () => void;
}) {
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let animId: number;
    const update = () => {
      if (labelRef.current) {
        labelRef.current.textContent = `CASH OUT ${liveRef.multiplier.toFixed(2)}x`;
      }
      animId = requestAnimationFrame(update);
    };
    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <Button
      onClick={onCashOut}
      loading={loading}
      bg="orange.500"
      color="white"
      fontWeight="black"
      fontSize="md"
      px={6}
      py={6}
      borderRadius="lg"
      _hover={{ bg: 'orange.400' }}
      _active={{ bg: 'orange.600' }}
      fontFamily="mono"
      letterSpacing="wide"
      minW="160px"
    >
      <span ref={labelRef}>CASH OUT 1.00x</span>
    </Button>
  );
}

// ── Bet status bar — live current value via RAF for ACTIVE status ───────────

function BetStatusBar({ myBet }: { myBet: BetEntry }) {
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (myBet.status !== 'ACTIVE') return;
    let animId: number;
    const update = () => {
      if (textRef.current) {
        const current = (
          (myBet.betAmountCents * liveRef.multiplier) /
          100
        ).toFixed(2);
        textRef.current.textContent = `Bet: $${(myBet.betAmountCents / 100).toFixed(2)} — Current: $${current}`;
      }
      animId = requestAnimationFrame(update);
    };
    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, [myBet.status, myBet.betAmountCents]);

  return (
    <Box mt={3} p={2} borderRadius="md" bg={statusBg(myBet.status)}>
      {myBet.status === 'ACTIVE' ? (
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
        <Text fontSize="sm" color={statusColor(myBet.status)} fontFamily="mono">
          {myBet.status === 'CASHED_OUT'
            ? `Cashed out at ${myBet.cashedOutAt?.toFixed(2)}x — Won $${((myBet.payoutCents ?? 0) / 100).toFixed(2)}`
            : `Lost $${(myBet.betAmountCents / 100).toFixed(2)}`}
        </Text>
      )}
    </Box>
  );
}

// ── Place bet button ─────────────────────────────────────────────────────────

function PlaceBetButton({
  canBet,
  loading,
  myBet,
  onPlaceBet,
}: {
  canBet: boolean;
  loading: boolean;
  myBet: BetEntry | null;
  onPlaceBet: () => void;
}) {
  return (
    <Button
      onClick={onPlaceBet}
      loading={loading}
      disabled={!canBet}
      bg={canBet ? 'green.600' : 'gray.700'}
      color={canBet ? 'white' : 'gray.500'}
      fontWeight="black"
      fontSize="md"
      px={6}
      py={6}
      borderRadius="lg"
      _hover={{ bg: canBet ? 'green.500' : 'gray.700' }}
      _active={{ bg: 'green.700' }}
      _disabled={{ cursor: 'not-allowed', opacity: 0.6 }}
      fontFamily="mono"
      letterSpacing="wide"
      minW="160px"
    >
      {betButtonLabel(myBet)}
    </Button>
  );
}

// ── BetPanel ────────────────────────────────────────────────────────────────

export function BetPanel() {
  const socket = useSocket();
  // No multiplier subscription — tick data read from liveRef via RAF in subcomponents
  const { phase, myBet, betError, clearBetError, isDemoMode } = useGameStore();
  const [amount, setAmount] = useState('5.00');
  const [autoCashOut, setAutoCashOut] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);

  const amountCents = Math.round(Number.parseFloat(amount || '0') * 100);
  const autoCashOutTarget = Number.parseFloat(autoCashOut);
  const hasAutoCashOut =
    !Number.isNaN(autoCashOutTarget) && autoCashOutTarget > 1;
  const canBet = phase === 'WAITING' && myBet === null && amountCents >= 100;
  const canCashOut = phase === 'RUNNING' && myBet?.status === 'ACTIVE';
  const inputDisabled = phase !== 'WAITING' || myBet !== null;

  // Clear loading when server confirms the action (myBet set) or phase leaves WAITING
  useEffect(() => {
    if (myBet !== null || phase !== 'WAITING') {
      setLoading(false);
    }
  }, [myBet, phase]);

  // Clear loading when bet fails
  useEffect(() => {
    if (betError) {
      setLoading(false);
    }
  }, [betError]);

  const handlePlaceBet = useCallback(() => {
    if (!socket || !canBet) return;
    clearBetError();
    setLoading(true);
    socket.emit('placeBet', {
      betAmountCents: amountCents,
      isDemo: isDemoMode,
      ...(hasAutoCashOut ? { autoCashOutAt: autoCashOutTarget } : {}),
    });
  }, [socket, canBet, clearBetError, amountCents, isDemoMode, hasAutoCashOut, autoCashOutTarget]);

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

  function handleCashOut() {
    if (!socket || !canCashOut) return;
    setLoading(true);
    socket.emit('cashOut');
  }

  return (
    <Box
      bg="gray.900"
      borderRadius={{ base: 'none', lg: 'lg' }}
      border={{ base: 'none', lg: '1px solid' }}
      borderColor="gray.700"
      p={{ base: 3, lg: 4 }}
    >
      <Flex gap={3} align="center" mb={3}>
        <Box flex={1}>
          <Text fontSize="xs" color="gray.500" mb={1} letterSpacing="wide">
            BET AMOUNT
          </Text>
          <Flex align="center" gap={2}>
            <Text color="gray.400" fontSize="lg">
              $
            </Text>
            <Input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              type="number"
              min="1"
              step="1"
              bg="gray.800"
              border="1px solid"
              borderColor="gray.600"
              color="white"
              fontFamily="mono"
              fontSize="lg"
              fontWeight="bold"
              px={3}
              py={2}
              borderRadius="md"
              disabled={inputDisabled}
              _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
              _focus={{ borderColor: 'green.500', outline: 'none' }}
            />
          </Flex>
        </Box>

        {/* Auto cash-out target */}
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
            <Text color="gray.500" fontSize="sm">
              x
            </Text>
          </Flex>
        </Box>

        <Box pt={5}>
          {canCashOut ? (
            <CashOutButton loading={loading} onCashOut={handleCashOut} />
          ) : (
            <PlaceBetButton
              canBet={canBet}
              loading={loading}
              myBet={myBet}
              onPlaceBet={handlePlaceBet}
            />
          )}
        </Box>
      </Flex>

      {/* Error message */}
      {betError && (
        <Text
          fontSize="sm"
          color="red.400"
          fontFamily="mono"
          mb={2}
          px={1}
        >
          {betError}
        </Text>
      )}

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
            _hover={{ borderColor: 'green.500', color: 'green.400' }}
            _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
            px={3}
          >
            ${a}
          </Button>
        ))}

        {/* Auto-play toggle — requires auto exit to be set */}
        <Button
          size="xs"
          variant="outline"
          borderColor={autoPlay ? 'green.500' : hasAutoCashOut ? 'gray.600' : 'gray.800'}
          color={autoPlay ? 'green.400' : hasAutoCashOut ? 'gray.500' : 'gray.700'}
          fontFamily="mono"
          fontSize="xs"
          disabled={!hasAutoCashOut}
          onClick={() => setAutoPlay(v => !v)}
          _hover={{ borderColor: 'green.400', color: 'green.300' }}
          _disabled={{ opacity: 0.35, cursor: 'not-allowed' }}
          title={!hasAutoCashOut ? 'Set an AUTO EXIT value to enable auto-play' : autoPlay ? 'Auto-play ON — click to stop' : 'Auto-play: bet automatically each round'}
        >
          {autoPlay ? 'AUTO ON' : 'AUTO'}
        </Button>
      </Flex>

      {myBet !== null && phase !== 'WAITING' && (
        <BetStatusBar myBet={myBet} />
      )}
    </Box>
  );
}
