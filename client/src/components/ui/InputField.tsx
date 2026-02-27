import { Box, Input, InputProps, Text } from '@chakra-ui/react';

export const InputField = ({
  label,
  ...props
}: InputProps & { label: string }) => (
  <Box>
    <Text
      color="rgba(255,255,255,0.7)"
      mb="2"
      fontSize="sm"
      fontFamily="monospace"
      letterSpacing="wide"
    >
      {label}
    </Text>
    <Input
      color="white"
      fontFamily="monospace"
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,107,0,0.25)',
      }}
      _focus={{
        borderColor: 'fire.amber',
        boxShadow: '0 0 0 1px #ff9500, 0 0 12px rgba(255,149,0,0.3)',
      }}
      {...props}
    />
  </Box>
);
