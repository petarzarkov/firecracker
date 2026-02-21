import { Box, Flex, Text } from '@chakra-ui/react';
import { useGameStore } from '@/store/gameStore';

function crashColor(cp: number): string {
  if (cp < 1.5) return '#ff4444';
  if (cp < 2) return '#ff8844';
  if (cp < 5) return '#4CAF50';
  if (cp < 10) return '#44aaff';
  return '#bb44ff';
}

export function RoundHistory() {
  const recentCrashes = useGameStore(state => state.recentCrashes);

  return (
    <Box>
      <Text
        fontSize="xs"
        color="gray.500"
        fontWeight="bold"
        letterSpacing="wide"
        mb={2}
      >
        HISTORY
      </Text>

      {recentCrashes.length === 0 ? (
        <Text fontSize="xs" color="gray.600" textAlign="center" py={2}>
          No rounds yet
        </Text>
      ) : (
        <Flex flexWrap="wrap" gap={1}>
          {recentCrashes.map(r => (
            <Box
              key={r.roundId}
              px={2}
              py={0.5}
              borderRadius="full"
              border="1px solid"
              borderColor={crashColor(r.crashPoint)}
              fontSize="xs"
              fontFamily="mono"
              fontWeight="bold"
              color={crashColor(r.crashPoint)}
              flexShrink={0}
            >
              {r.crashPoint.toFixed(2)}x
            </Box>
          ))}
        </Flex>
      )}
    </Box>
  );
}
