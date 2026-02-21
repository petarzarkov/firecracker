import { Box, Flex, Text } from '@chakra-ui/react';
import { useGameStore } from '@/store/gameStore';

function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PlayerList() {
  const activeBets = useGameStore(state => state.activeBets);
  const phase = useGameStore(state => state.phase);

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

      {/* Bet rows */}
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
        {activeBets.map(bet => {
          const isCashedOut = bet.status === 'CASHED_OUT';
          const isLost = bet.status === 'LOST';

          return (
            <Flex
              key={bet.userId}
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
              _hover={{ bg: 'whiteAlpha.50' }}
              transition="background 0.2s"
            >
              <Flex flex={1} align="center" gap={2} minW={0}>
                <Box
                  w="6px"
                  h="6px"
                  borderRadius="full"
                  flexShrink={0}
                  bg={
                    isCashedOut ? 'green.400' : isLost ? 'red.500' : 'blue.400'
                  }
                />
                <Text
                  fontSize="xs"
                  color={
                    isCashedOut ? 'green.300' : isLost ? 'gray.500' : 'gray.200'
                  }
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

              <Text
                fontSize="xs"
                w="70px"
                textAlign="right"
                fontFamily="mono"
                color={
                  isCashedOut ? 'green.400' : isLost ? 'red.500' : 'gray.600'
                }
              >
                {isCashedOut
                  ? `${bet.cashedOutAt?.toFixed(2)}x`
                  : isLost
                    ? '—'
                    : '...'}
              </Text>
            </Flex>
          );
        })}
      </Box>
    </Box>
  );
}
