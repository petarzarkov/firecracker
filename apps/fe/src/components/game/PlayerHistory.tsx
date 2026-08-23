import { Box, Flex, Text } from '@chakra-ui/react';
import { GameBetStatus, type GameBetView } from '@firecracker/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from '@/components/Tooltip';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { ApiError, fetchMyBets } from '@/systems/network/bets';
import { AuthMiddleware } from '@/middleware/authMiddleware';
import { type BetEntry, useGameStore } from '@/store/gameStore';

function fmtCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function BetRow({ bet }: { bet: GameBetView }) {
  const isWon = bet.status === GameBetStatus.CASHED_OUT;
  const isLost = bet.status === GameBetStatus.LOST;
  const isActive = bet.status === GameBetStatus.ACTIVE;
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

/**
 * The current round's bet, from the store rather than from the API.
 *
 * Deliberately not a faked {@link GameBetView}: it has no id, no crash point and no
 * settled status, and inventing them would let it flow into code that assumes a
 * settled row. It is a live line, and it reads like one.
 */
function LiveBetRow({ bet }: { bet: BetEntry }) {
  const phase = useGameStore((state) => state.phase);
  const live = bet.status === 'ACTIVE';

  return (
    <Flex
      px={2}
      py={1.5}
      align="center"
      justify="space-between"
      gap={2}
      borderBottom="1px solid"
      borderColor="#1e1e1e"
      bg="rgba(96,165,250,0.07)"
    >
      <Flex align="center" gap={2} minW={0}>
        <Box
          w="6px"
          h="6px"
          borderRadius="full"
          bg={live ? '#60a5fa' : '#666'}
        />
        <Box minW={0}>
          <Text fontSize="xs" color="gray.100" fontFamily="mono">
            ${fmtCents(bet.betAmountCents)}
          </Text>
          <Text fontSize="2xs" color="gray.500" fontFamily="mono">
            {phase === 'WAITING' ? 'this round · waiting' : 'this round'}
          </Text>
        </Box>
      </Flex>
      <Text fontSize="2xs" color="#60a5fa" fontFamily="mono">
        {bet.status === 'CASHED_OUT'
          ? `✓${bet.cashedOutAt?.toFixed(2)}x`
          : bet.status === 'LOST'
            ? 'lost'
            : 'open'}
      </Text>
    </Flex>
  );
}

export function PlayerHistory() {
  const userId = useAuthStore((state) => state.user?.id);
  const phase = useGameStore((state) => state.phase);
  const myBet = useGameStore((state) => state.myBet);
  const [bets, setBets] = useState<readonly GameBetView[]>([]);
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
        // The envelope and the row both come from `@firecracker/contracts`, so a
        // field this panel reads is a field the route is declared to send. It read
        // a `crashPoint` nobody sent for months, and rendered every loss as a
        // crash at zero.
        const page = await fetchMyBets(20, cursor);
        if (cursor) {
          setBets((prev) => [...prev, ...page.data]);
        } else {
          setBets([...page.data]);
        }
        setNextCursor(page.meta.nextCursor);
        setHasNextPage(page.meta.hasNextPage);
      } catch (error) {
        // A refusal must not reach the render. This panel is gated on a *persisted*
        // user, so a browser holding a dead cookie mounts it and asks - and the old
        // code cast the 401 body to a page, wrote `undefined` into `bets` and threw
        // on `meta.nextCursor`, which white-screened the whole app.
        //
        // 401 means the cookie is no longer accepted, so ask the middleware to
        // settle it: it clears the persisted session and the app renders signed
        // out, rather than waiting for the next five-minute poll.
        if (error instanceof ApiError && error.status === 401) {
          AuthMiddleware.revalidate();
        }
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
          as="h2"
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
        {/*
          The bet on the table, before the server has been asked about it.

          This list is fetched, and it refreshes when a betting window opens and
          after a cash-out - so a bet placed *during* a window missed both, and a
          panel headed MY BETS said "No bets yet" while the player list beside it
          showed the same player's stake. The store has it; this renders it.
        */}
        {myBet !== null && <LiveBetRow bet={myBet} />}

        {bets.length === 0 && myBet === null && !isLoading ? (
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
