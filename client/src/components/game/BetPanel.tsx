import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { useSocket } from '@/SocketContext';
import type { BetEntry } from '@/store/gameStore';
import { useGameStore } from '@/store/gameStore';

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

function statusMessage(bet: BetEntry, multiplier: number): string {
  if (bet.status === 'ACTIVE') {
    const current = ((bet.betAmountCents * multiplier) / 100).toFixed(2);
    return `Bet: $${(bet.betAmountCents / 100).toFixed(2)} — Current: $${current}`;
  }
  if (bet.status === 'CASHED_OUT') {
    const payout = ((bet.payoutCents ?? 0) / 100).toFixed(2);
    return `Cashed out at ${bet.cashedOutAt?.toFixed(2)}x — Won $${payout}`;
  }
  return `Lost $${(bet.betAmountCents / 100).toFixed(2)}`;
}

interface CashOutButtonProps {
  multiplier: number;
  loading: boolean;
  onCashOut: () => void;
}

function CashOutButton({ multiplier, loading, onCashOut }: CashOutButtonProps) {
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
      CASH OUT {multiplier.toFixed(2)}x
    </Button>
  );
}

interface PlaceBetButtonProps {
  canBet: boolean;
  loading: boolean;
  myBet: BetEntry | null;
  onPlaceBet: () => void;
}

function PlaceBetButton({
  canBet,
  loading,
  myBet,
  onPlaceBet,
}: PlaceBetButtonProps) {
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

interface BetStatusBarProps {
  myBet: BetEntry;
  multiplier: number;
}

function BetStatusBar({ myBet, multiplier }: BetStatusBarProps) {
  return (
    <Box mt={3} p={2} borderRadius="md" bg={statusBg(myBet.status)}>
      <Text fontSize="sm" color={statusColor(myBet.status)} fontFamily="mono">
        {statusMessage(myBet, multiplier)}
      </Text>
    </Box>
  );
}

export function BetPanel() {
  const socket = useSocket();
  const { phase, myBet, multiplier } = useGameStore();
  const [amount, setAmount] = useState('5.00');
  const [loading, setLoading] = useState(false);

  const amountCents = Math.round(Number.parseFloat(amount || '0') * 100);
  const canBet = phase === 'WAITING' && myBet === null && amountCents >= 100;
  const canCashOut =
    phase === 'RUNNING' && myBet?.status === 'ACTIVE' && !loading;
  const inputDisabled = phase !== 'WAITING' || myBet !== null;

  function handlePlaceBet() {
    if (!socket || !canBet) return;
    setLoading(true);
    socket.emit('placeBet', { amountCents });
    setTimeout(() => setLoading(false), 3000);
  }

  function handleCashOut() {
    if (!socket || !canCashOut) return;
    setLoading(true);
    socket.emit('cashOut');
    setTimeout(() => setLoading(false), 2000);
  }

  return (
    <Box
      bg="gray.900"
      borderRadius="lg"
      border="1px solid"
      borderColor="gray.700"
      p={4}
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

        <Box pt={5}>
          {canCashOut ? (
            <CashOutButton
              multiplier={multiplier}
              loading={loading}
              onCashOut={handleCashOut}
            />
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

      <Flex gap={2} flexWrap="wrap">
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
      </Flex>

      {myBet !== null && phase !== 'WAITING' && (
        <BetStatusBar myBet={myBet} multiplier={multiplier} />
      )}
    </Box>
  );
}
