import { Box, Flex, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { FairnessDialog } from './FairnessDialog';

/**
 * The bands the pills are coloured by, and the legend beside the title - one list,
 * so the two cannot drift into disagreeing about what blue means.
 */
const BANDS = [
  { upTo: 2, color: '#ff8844' },
  { upTo: 5, color: '#ffd700' },
  { upTo: 10, color: '#44aaff' },
  { upTo: null, color: '#bb44ff' },
] as const;

function crashColor(cp: number): string {
  if (cp < 1.5) return '#ff4444';
  for (const band of BANDS) {
    if (band.upTo !== null && cp < band.upTo) return band.color;
  }
  return '#bb44ff';
}

export function RoundHistory() {
  const recentCrashes = useGameStore((state) => state.recentCrashes);
  /**
   * Which round's proof is open. `undefined` is closed; `null` is the round in
   * progress, which has a commitment but no reveal yet.
   */
  const [openRound, setOpenRound] = useState<string | null | undefined>(
    undefined,
  );

  return (
    <Box>
      <Flex align="baseline" justify="space-between" mb={2} gap={2}>
        <Text
          as="h2"
          fontSize="xs"
          color="#aaa"
          fontWeight="bold"
          letterSpacing="wide"
        >
          HISTORY
        </Text>
        {/*
          The pills have always been colour-banded and nothing said by what. Four
          swatches and their thresholds cost one line and turn a decoration into a
          reading of how the last twenty rounds went.
        */}
        <Flex align="center" gap={1.5} aria-label="Crash point bands">
          {BANDS.map(({ upTo, color }) => (
            <Flex key={color} align="center" gap={0.5}>
              <Box w="6px" h="6px" borderRadius="full" bg={color} />
              <Text fontSize="2xs" color="gray.500" fontFamily="mono">
                {upTo === null ? '10+' : `<${upTo}`}
              </Text>
            </Flex>
          ))}
        </Flex>
      </Flex>

      {recentCrashes.length === 0 ? (
        <Text fontSize="xs" color="gray.600" textAlign="center" py={2}>
          No rounds yet
        </Text>
      ) : (
        <Flex flexWrap="wrap" gap={1.5}>
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
                {/*
                  A pill is the only place a player ever sees a past round, so it is
                  where "was that real?" has to be answerable. It was a `Box`.
                */}
                <Box
                  as="button"
                  aria-label={`Show how round ${index + 1} was drawn — crashed at ${r.crashPoint.toFixed(2)}x`}
                  onClick={() => setOpenRound(r.roundId)}
                  cursor="pointer"
                  px={isLatest ? 2.5 : 2}
                  py={0.5}
                  borderRadius="full"
                  border="1px solid"
                  borderColor={color}
                  bg={`${color}1a`}
                  fontSize={isLatest ? 'sm' : 'xs'}
                  fontFamily="mono"
                  fontWeight="bold"
                  color="white"
                  boxShadow={isLatest ? `0 0 6px ${color}` : 'none'}
                  _hover={{ bg: `${color}33` }}
                >
                  {r.crashPoint.toFixed(2)}x
                </Box>
              </Box>
            );
          })}
        </Flex>
      )}

      <Box
        as="button"
        onClick={() => setOpenRound(null)}
        mt={2}
        fontSize="2xs"
        fontFamily="mono"
        color="gray.500"
        letterSpacing="wide"
        cursor="pointer"
        _hover={{ color: 'orange.300' }}
      >
        ⚄ provably fair — check this round
      </Box>

      <FairnessDialog
        roundId={openRound ?? null}
        open={openRound !== undefined}
        onClose={() => setOpenRound(undefined)}
      />
    </Box>
  );
}
