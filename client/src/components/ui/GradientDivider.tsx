import { Box, Flex, Text } from '@chakra-ui/react';

export const GradientDivider = () => (
  <Flex alignItems="center" gap={3} my={2}>
    <Box
      flex={1}
      style={{
        height: '1px',
        background:
          'linear-gradient(90deg, transparent, rgba(255,107,0,0.4), transparent)',
      }}
    />
    <Text color="rgba(255,255,255,0.4)" fontSize="xs" fontFamily="monospace">
      OR
    </Text>
    <Box
      flex={1}
      style={{
        height: '1px',
        background: 'linear-gradient(90deg, rgba(255,107,0,0.4), transparent)',
      }}
    />
  </Flex>
);
