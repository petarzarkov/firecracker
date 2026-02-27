import { Box, Flex, Text } from '@chakra-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { useGameStore } from '@/store/gameStore';

interface BetEntry {
  id: string;
  betAmountCents: number;
  status: 'active' | 'cashed_out' | 'lost' | 'refunded';
  cashedOutAt?: number;
  payoutCents?: number;
  crashPoint?: number;
}

function fmtCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function BetRow({ bet }: { bet: BetEntry }) {
  const isWon = bet.status === 'cashed_out';
  const isLost = bet.status === 'lost';
  const dotColor = isWon
    ? 'green.500'
    : isLost
      ? 'red.500'
      : bet.status === 'active'
        ? 'blue.500'
        : 'gray.500';
  const resultColor = isWon ? 'green.400' : isLost ? 'red.400' : 'gray.500';

  const profitCents = isWon
    ? (bet.payoutCents ?? 0) - bet.betAmountCents
    : isLost
      ? -bet.betAmountCents
      : 0;
  const profitColor = profitCents >= 0 ? 'green.400' : 'red.400';
  const profitLabel =
    isWon || isLost
      ? `${profitCents >= 0 ? '+' : '-'}$${fmtCents(Math.abs(profitCents))}`
      : null;

  const resultLabel = isWon
    ? `✓${bet.cashedOutAt?.toFixed(2)}x`
    : `×${(bet.crashPoint ?? 0).toFixed(2)}x`;

  return (
    <Flex
      py={1.5}
      px={2}
      borderBottom="1px solid"
      borderColor="gray.800"
      justify="space-between"
      align="center"
      _hover={{ bg: 'rgba(255,255,255,0.03)' }}
    >
      <Flex align="center" gap={1.5}>
        <Box w="5px" h="5px" borderRadius="full" bg={dotColor} flexShrink={0} />
        <Box>
          <Text
            fontSize="xs"
            color="gray.100"
            lineHeight={1.3}
            fontFamily="mono"
          >
            ${fmtCents(bet.betAmountCents)}
          </Text>
          {profitLabel && (
            <Text
              fontSize="9px"
              color={profitColor}
              lineHeight={1.2}
              fontFamily="mono"
            >
              {profitLabel}
            </Text>
          )}
        </Box>
      </Flex>
      <Text fontSize="xs" color={resultColor} fontFamily="mono">
        {resultLabel}
      </Text>
    </Flex>
  );
}

export function PlayerHistory() {
  const token = useAuthStore(state => state.token);
  const phase = useGameStore(state => state.phase);
  const [bets, setBets] = useState<BetEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const loadedOnce = useRef(false);

  const fetchBets = useCallback(
    async (cursor?: string) => {
      if (!token) return;
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ take: '20' });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`/api/game/my-bets?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cursor) {
          setBets(prev => [...prev, ...(data.data ?? [])]);
        } else {
          setBets(data.data ?? []);
        }
        setNextCursor(data.meta?.nextCursor ?? null);
        setHasNextPage(data.meta?.hasNextPage ?? false);
      } finally {
        setIsLoading(false);
        loadedOnce.current = true;
      }
    },
    [token],
  );

  // Initial load
  useEffect(() => {
    fetchBets();
  }, [fetchBets]);

  // Auto-refresh at the start of each new WAITING phase (previous round resolved)
  useEffect(() => {
    if (phase === 'WAITING' && loadedOnce.current) {
      fetchBets();
    }
  }, [phase, fetchBets]);

  return (
    <Flex
      direction="column"
      flex={1}
      h="100%"
      minH={0}
      overflow="hidden"
      borderBottom="1px solid"
      borderColor="gray.700"
    >
      <Flex
        px={3}
        py={2}
        align="center"
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
          MY BETS
        </Text>
      </Flex>

      <Box
        flex={1}
        minH={0}
        overflowY="auto"
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
        {bets.length === 0 && !isLoading ? (
          <Text fontSize="xs" color="gray.600" textAlign="center" mt={6} px={2}>
            No bets yet
          </Text>
        ) : (
          <>
            {bets.map(bet => (
              <BetRow key={bet.id} bet={bet} />
            ))}
            {hasNextPage && (
              <Button
                size="xs"
                variant="ghost"
                color="gray.500"
                fontFamily="mono"
                width="full"
                my={2}
                loading={isLoading}
                onClick={() => fetchBets(nextCursor ?? undefined)}
              >
                load more
              </Button>
            )}
          </>
        )}
      </Box>
    </Flex>
  );
}
