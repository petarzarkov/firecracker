import { Box, Image, SimpleGrid, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { Button } from './Button';
import { InputField } from './InputField';

/**
 * Bundled with the app, so the picker works offline and on first paint. Replace
 * with a real gallery by putting files in `public/png/avatars/` and listing them
 * here - no server route needed for a static set.
 */
const AVATARS: readonly string[] = [
  '/png/android-chrome-192x192.png',
  '/png/apple-touch-icon.png',
  '/png/favicon-32x32.png',
];

export const AvatarPicker = ({
  currentPicture,
  customUrl,
  onSelect,
  onCustomUrlChange,
}: {
  currentPicture: string;
  customUrl: string;
  onSelect: (url: string) => void;
  onCustomUrlChange: (val: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  /**
   * The suggestion grid used to come from `GET /api/auth/avatars/trending`, a
   * route on the NestJS auth controller that proxied an avatar service. That
   * controller is gone and Better Auth has no equivalent, so the grid is now a
   * fixed local set.
   *
   * Deterministic rather than remote on purpose: a sign-up form that cannot finish
   * because a third-party image host is slow is a worse trade than eight fewer
   * choices. A custom URL still accepts anything, and OAuth sign-ins bring their
   * provider's picture with them.
   */
  const avatars = AVATARS;

  const togglePicker = () => setIsOpen((open) => !open);

  return (
    <Box>
      <Text
        color="rgba(255,255,255,0.7)"
        mb="2"
        fontSize="sm"
        fontFamily="monospace"
        letterSpacing="wide"
      >
        Avatar (optional)
      </Text>
      {currentPicture && (
        <Box mb="3" textAlign="center">
          <Image
            src={currentPicture}
            boxSize="64px"
            borderRadius="md"
            border="2px solid"
            borderColor="orange.400"
            mx="auto"
          />
        </Box>
      )}
      <Button
        onClick={togglePicker}
        variant="glass"
        width="full"
        mb="3"
        color="orange.300"
      >
        {isOpen ? 'Hide Avatar Picker' : 'Choose Avatar'}
      </Button>

      {isOpen && (
        <Box
          p="4"
          borderRadius="md"
          mb="3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,107,0,0.15)',
          }}
        >
          <SimpleGrid columns={5} gap={2} mb="4">
            {avatars.map((url) => (
              <Box
                as="button"
                key={url}
                onClick={() => onSelect(url)}
                border="2px solid"
                borderColor={
                  currentPicture === url ? 'orange.400' : 'transparent'
                }
                borderRadius="md"
                overflow="hidden"
                _hover={{ borderColor: 'orange.400' }}
              >
                <Image src={url} width="100%" />
              </Box>
            ))}
          </SimpleGrid>
          <InputField
            label="Or paste custom image URL:"
            placeholder="https://example.com/avatar.png"
            value={customUrl}
            onChange={(e) => onCustomUrlChange(e.target.value)}
            fontSize="xs"
          />
        </Box>
      )}
    </Box>
  );
};
