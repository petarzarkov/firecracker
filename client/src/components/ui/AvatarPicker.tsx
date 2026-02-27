import { Box, Image, SimpleGrid, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { Button } from './Button';
import { InputField } from './InputField';

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
  const [avatars, setAvatars] = useState<string[]>([]);

  const togglePicker = async () => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (newState && avatars.length === 0) {
      try {
        const res = await fetch('/api/auth/avatars/trending');
        const data = await res.json();
        setAvatars(data.avatars || []);
      } catch (e) {
        console.error('Avatar fetch failed', e);
      }
    }
  };

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
            {avatars.map(url => (
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
            onChange={e => onCustomUrlChange(e.target.value)}
            fontSize="xs"
          />
        </Box>
      )}
    </Box>
  );
};
