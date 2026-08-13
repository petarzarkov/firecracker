import { Box, Flex, Text } from '@chakra-ui/react';
import { memo, useEffect, useRef } from 'react';
import type { BetEntry, GamePhase } from '@/store/gameStore';
import { getLiveMultiplier, useGameStore } from '@/store/gameStore';

function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Updates its text via RAF — no React re-renders on tick
function LiveBetValue({ betAmountCents }: { betAmountCents: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let animId: number;
    const update = () => {
      if (ref.current) {
        ref.current.textContent = formatUSD(
          Math.floor(betAmountCents * getLiveMultiplier()),
        );
      }
      animId = requestAnimationFrame(update);
    };
    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, [betAmountCents]);

  return (
    <span
      ref={ref}
      style={{
        fontSize: 'var(--chakra-font-sizes-xs)',
        fontFamily: 'monospace',
        color: 'var(--chakra-colors-yellow-400)',
      }}
    />
  );
}

function betCashoutColor(status: BetEntry['status'], phase: GamePhase): string {
  if (status === 'CASHED_OUT') return 'green.400';
  if (status === 'LOST') return 'red.500';
  if (phase === 'RUNNING') return 'yellow.400';
  return 'gray.600';
}

// Memoized — only re-renders when this specific bet reference or phase changes
const BetRow = memo(function BetRow({
  bet,
  phase,
}: {
  bet: BetEntry;
  phase: GamePhase;
}) {
  const isCashedOut = bet.status === 'CASHED_OUT';
  const isLost = bet.status === 'LOST';
  const isActive = bet.status === 'ACTIVE';

  return (
    <Flex
      px={2}
      py={1.5}
      align="center"
      borderRadius="sm"
      bg={
        isCashedOut
          ? 'rgba(76,175,80,0.08)'
          : isLost
            ? 'rgba(255,68,68,0.06)'
            : 'transparent'
      }
      opacity={isLost ? 0.5 : 1}
      _hover={{ bg: 'whiteAlpha.50' }}
      transition="background 0.2s, opacity 0.3s"
    >
      <Flex flex={1} align="center" gap={2} minW={0}>
        {/* Status indicator */}
        {isCashedOut ? (
          <Text
            fontSize="10px"
            fontWeight="bold"
            color="green.400"
            lineHeight={1}
            flexShrink={0}
          >
            ✓
          </Text>
        ) : isLost ? (
          <Text
            fontSize="10px"
            fontWeight="bold"
            color="red.500"
            lineHeight={1}
            flexShrink={0}
          >
            ×
          </Text>
        ) : (
          <>
            <style>{`
              @keyframes pl-pulse {
                0%, 100% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.7); opacity: 0.5; }
              }
            `}</style>
            <Box
              w="6px"
              h="6px"
              borderRadius="full"
              flexShrink={0}
              bg="blue.400"
              style={
                isActive && phase === 'RUNNING'
                  ? { animation: 'pl-pulse 1s ease-in-out infinite' }
                  : undefined
              }
            />
          </>
        )}
        <Text
          fontSize="10px"
          color={isCashedOut ? 'green.300' : isLost ? 'gray.500' : 'gray.200'}
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
        >
          {bet.username}
        </Text>
      </Flex>

      <Text
        fontSize="xs"
        color="gray.400"
        w="60px"
        textAlign="right"
        fontFamily="mono"
      >
        {formatUSD(bet.betAmountCents)}
      </Text>

      <Box w="70px" textAlign="right">
        {isCashedOut && (
          <Text
            fontSize="xs"
            fontFamily="mono"
            color={betCashoutColor(bet.status, phase)}
          >
            {bet.cashedOutAt?.toFixed(2)}x
          </Text>
        )}
        {isLost && (
          <Text
            fontSize="xs"
            fontFamily="mono"
            color={betCashoutColor(bet.status, phase)}
          >
            —
          </Text>
        )}
        {isActive && phase === 'RUNNING' && (
          <LiveBetValue betAmountCents={bet.betAmountCents} />
        )}
        {isActive && phase !== 'RUNNING' && (
          <Text fontSize="xs" fontFamily="mono" color="gray.600">
            —
          </Text>
        )}
      </Box>
    </Flex>
  );
});

export function PlayerList() {
  const activeBets = useGameStore((state) => state.activeBets);
  const phase = useGameStore((state) => state.phase);

  if (activeBets.length === 0) {
    return (
      <Box>
        <Text
          fontSize="xs"
          color="gray.500"
          fontWeight="bold"
          letterSpacing="wide"
          mb={2}
        >
          PLAYERS ({activeBets.length})
        </Text>
        <Text fontSize="xs" color="gray.600" textAlign="center" py={4}>
          {phase === 'WAITING' ? 'Waiting for bets...' : 'No bets this round'}
        </Text>
      </Box>
    );
  }

  return (
    <Box flex={1} overflow="hidden" display="flex" flexDirection="column">
      <Text
        fontSize="xs"
        color="gray.500"
        fontWeight="bold"
        letterSpacing="wide"
        mb={2}
      >
        PLAYERS ({activeBets.length})
      </Text>

      {/* Header row */}
      <Flex
        px={2}
        py={1}
        borderBottom="1px solid"
        borderColor="gray.700"
        mb={1}
      >
        <Text fontSize="2xs" color="gray.600" flex={1}>
          PLAYER
        </Text>
        <Text fontSize="2xs" color="gray.600" w="60px" textAlign="right">
          BET
        </Text>
        <Text fontSize="2xs" color="gray.600" w="70px" textAlign="right">
          CASHOUT
        </Text>
      </Flex>

      {/* Bet rows — each row is memoized, only re-renders when its bet changes */}
      <Box
        flex={1}
        overflowY="auto"
        css={{
          '&::-webkit-scrollbar': { width: '4px' },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '2px',
          },
        }}
      >
        {activeBets.map((bet) => (
          <BetRow key={bet.userId} bet={bet} phase={phase} />
        ))}
      </Box>
    </Box>
  );
}
