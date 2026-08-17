import { Box, Flex, Text } from '@chakra-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from '@/components/Tooltip';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { apiFetch } from '@/systems/network/api';
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
  const isActive = bet.status === 'active';
  const dotColor = isWon
    ? '#4ade80'
    : isLost
      ? '#f87171'
      : isActive
        ? '#60a5fa'
        : '#666';
  const resultColor = isWon ? '#fbbf24' : isLost ? '#f87171' : '#888';

  const profitCents = isWon
    ? (bet.payoutCents ?? 0) - bet.betAmountCents
    : isLost
      ? -bet.betAmountCents
      : 0;
  const profitColor = profitCents >= 0 ? '#4ade80' : '#f87171';
  const profitLabel =
    isWon || isLost
      ? `${profitCents >= 0 ? '+' : '-'}$${fmtCents(Math.abs(profitCents))}`
      : null;

  const resultLabel = isWon
    ? `✓${bet.cashedOutAt?.toFixed(2)}x`
    : `×${(bet.crashPoint ?? 0).toFixed(2)}x`;

  const tooltipContent = (
    <Box fontFamily="mono" fontSize="xs" lineHeight={1.8}>
      <Text color="gray.400" fontSize="9px" mb={1}>
        #{bet.id.slice(0, 12)}…
      </Text>
      <Flex justify="space-between" gap={4}>
        <Text color="gray.400">Bet</Text>
        <Text color="gray.100">${fmtCents(bet.betAmountCents)}</Text>
      </Flex>
      <Flex justify="space-between" gap={4}>
        <Text color="gray.400">Status</Text>
        <Text color={dotColor} textTransform="capitalize">
          {bet.status.replace('_', ' ')}
        </Text>
      </Flex>
      {isWon && (
        <>
          <Flex justify="space-between" gap={4}>
            <Text color="gray.400">Cashed at</Text>
            <Text color="#fbbf24">{bet.cashedOutAt?.toFixed(2)}x</Text>
          </Flex>
          <Flex justify="space-between" gap={4}>
            <Text color="gray.400">Payout</Text>
            <Text color="gray.100">${fmtCents(bet.payoutCents ?? 0)}</Text>
          </Flex>
          <Flex justify="space-between" gap={4}>
            <Text color="gray.400">Profit</Text>
            <Text color={profitColor}>{profitLabel}</Text>
          </Flex>
        </>
      )}
      {isLost && (
        <>
          <Flex justify="space-between" gap={4}>
            <Text color="gray.400">Crashed at</Text>
            <Text color="#f87171">{(bet.crashPoint ?? 0).toFixed(2)}x</Text>
          </Flex>
          <Flex justify="space-between" gap={4}>
            <Text color="gray.400">Loss</Text>
            <Text color={profitColor}>{profitLabel}</Text>
          </Flex>
        </>
      )}
    </Box>
  );

  return (
    <Tooltip
      content={tooltipContent}
      showArrow
      positioning={{ placement: 'left' }}
    >
      <Flex
        py={1.5}
        px={2}
        borderBottom="1px solid"
        borderColor="gray.800"
        justify="space-between"
        align="center"
        cursor="default"
        _hover={{ bg: 'rgba(255,255,255,0.05)' }}
      >
        <Flex align="center" gap={1.5}>
          <Box
            w="5px"
            h="5px"
            borderRadius="full"
            bg={dotColor}
            flexShrink={0}
          />
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
    </Tooltip>
  );
}

export function PlayerHistory() {
  const userId = useAuthStore((state) => state.user?.id);
  const phase = useGameStore((state) => state.phase);
  const myBet = useGameStore((state) => state.myBet);
  const [bets, setBets] = useState<BetEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const loadedOnce = useRef(false);
  /** The settlement already reflected here, so one event refetches once. */
  const settledKey = useRef<string | null>(null);

  const fetchBets = useCallback(
    async (cursor?: string) => {
      // Gated on the user, not the token: the session lives in a cookie and the
      // token is absent after a reload by design. See `authStore`.
      if (!userId) return;
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ take: '20' });
        if (cursor) params.set('cursor', cursor);
        const res = await apiFetch(`/api/game/my-bets?${params}`);
        const data = await res.json();
        if (cursor) {
          setBets((prev) => [...prev, ...(data.data ?? [])]);
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
    [userId],
  );

  // Initial load
  useEffect(() => {
    fetchBets();
  }, [fetchBets]);

  /**
   * Refresh the moment **my** bet settles, rather than at the next round.
   *
   * This list used to refresh only when a new WAITING phase began, so cashing out
   * - by hand or automatically - left "MY BETS" showing the bet as still open for
   * the rest of the round. For an auto-cashout that is the whole feature going
   * unacknowledged: the player is not watching the button, so this list is where
   * they find out it worked.
   *
   * Keyed so one settlement triggers one fetch. The server writes the row before
   * it publishes the frame that moves `myBet`, so by the time this runs the
   * refetch sees the settled bet.
   */
  useEffect(() => {
    if (myBet === null || myBet.status === 'ACTIVE') {
      // A new round cleared it - let the next settlement through.
      settledKey.current = null;
      return;
    }

    const key = `${myBet.userId}:${myBet.status}:${myBet.cashedOutAt ?? ''}`;
    if (settledKey.current === key) return;
    settledKey.current = key;
    fetchBets();
  }, [myBet, fetchBets]);

  /**
   * The backstop, at the start of each WAITING phase.
   *
   * Still here because not every settlement moves `myBet`: a refunded round is
   * resolved server-side without a per-bet frame, so without this such a bet would
   * sit stale until the page reloaded.
   */
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
          color="#aaa"
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
          <Text fontSize="xs" color="#888" textAlign="center" mt={6} px={2}>
            No bets yet
          </Text>
        ) : (
          <>
            {bets.map((bet) => (
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
