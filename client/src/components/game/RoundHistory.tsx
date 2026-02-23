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
          {recentCrashes.map((r, index) => {
            const color = crashColor(r.crashPoint);
            const isLatest = index === 0;
            return (
              <Box key={r.roundId} position="relative" flexShrink={0}>
                {isLatest && (
                  <Text
                    position="absolute"
                    top="-10px"
                    left="50%"
                    transform="translateX(-50%)"
                    fontSize="8px"
                    fontWeight="bold"
                    color={color}
                    lineHeight={1}
                    whiteSpace="nowrap"
                    pointerEvents="none"
                  >
                    ▼
                  </Text>
                )}
                <Box
                  px={isLatest ? 2.5 : 2}
                  py={0.5}
                  borderRadius="full"
                  border="1px solid"
                  borderColor={color}
                  fontSize={isLatest ? 'sm' : 'xs'}
                  fontFamily="mono"
                  fontWeight="bold"
                  color={color}
                  boxShadow={isLatest ? `0 0 6px ${color}` : 'none'}
                >
                  {r.crashPoint.toFixed(2)}x
                </Box>
              </Box>
            );
          })}
        </Flex>
      )}
    </Box>
  );
}
