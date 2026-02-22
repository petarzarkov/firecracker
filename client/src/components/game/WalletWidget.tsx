import { Flex, Text } from '@chakra-ui/react';
import { useGameStore } from '@/store/gameStore';

export function WalletWidget() {
  const demoBalanceCents = useGameStore(state => state.demoBalanceCents);
  const balance =
    demoBalanceCents !== null ? (demoBalanceCents / 100).toFixed(2) : null;

  return (
    <Flex
      align="center"
      gap={2}
      px={3}
      py={1.5}
      borderRadius="md"
      bg="gray.800"
      border="1px solid"
      borderColor="gray.700"
    >
      <Text fontSize="xs" color="gray.500" fontFamily="mono">
        DEMO
      </Text>
      <Text
        fontSize="sm"
        fontWeight="bold"
        color={balance !== null ? 'yellow.400' : 'gray.500'}
        fontFamily="mono"
      >
        {balance !== null ? `$${balance}` : '...'}
      </Text>
    </Flex>
  );
}
