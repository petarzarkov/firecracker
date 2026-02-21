import { Box, IconButton } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { BsEmojiSmile } from 'react-icons/bs';

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  themeColor?: string;
}

// Common emojis - most frequently used
const COMMON_EMOJIS = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😆',
  '😅',
  '🤣',
  '😂',
  '🙂',
  '🙃',
  '😉',
  '😊',
  '😇',
  '🥰',
  '😍',
  '🤩',
  '😘',
  '😗',
  '😚',
  '😙',
  '😋',
  '😛',
  '😜',
  '🤪',
  '😝',
  '🤑',
  '🤗',
  '🤭',
  '🤫',
  '🤔',
  '👋',
  '🤚',
  '🖐',
  '✋',
  '🖖',
  '👌',
  '🤏',
  '✌️',
  '🤞',
  '🤟',
  '🤘',
  '🤙',
  '👍',
  '👎',
  '✊',
  '👊',
  '🤛',
  '🤜',
  '👏',
  '🙌',
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🖤',
  '🤍',
  '🤎',
  '💔',
  '✅',
  '❌',
  '➕',
  '➖',
  '💯',
  '🔥',
  '💪',
  '🙏',
  '🎉',
  '🎊',
  '🎈',
  '🎁',
  '🏆',
  '⭐',
  '🌟',
  '💫',
  '✨',
  '💥',
  '💢',
  '😎',
  '🤓',
  '🧐',
  '😏',
  '😒',
  '😞',
  '😔',
  '😟',
  '😕',
  '🙁',
  '😣',
];

export function EmojiPicker({
  onEmojiSelect,
  themeColor = '#4CAF50',
}: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEmojiClick = (emoji: string) => {
    onEmojiSelect(emoji);
    setIsOpen(false);
  };

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <Box position="relative" ref={containerRef}>
      <IconButton
        aria-label="Select emoji"
        size="md"
        variant="ghost"
        color={isOpen ? themeColor : 'gray.400'}
        _hover={{ color: themeColor, bg: 'whiteAlpha.100' }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <BsEmojiSmile size={20} />
      </IconButton>
      {isOpen && (
        <Box
          position="absolute"
          bottom="100%"
          right="0"
          mb={2}
          bg="rgba(18, 20, 24, 0.98)"
          backdropFilter="blur(10px)"
          border="1px solid"
          borderColor="whiteAlpha.200"
          borderRadius="lg"
          p={3}
          width="300px"
          maxH="400px"
          overflowY="auto"
          zIndex={1001}
          boxShadow="lg"
          css={{
            '&::-webkit-scrollbar': { width: '6px' },
            '&::-webkit-scrollbar-track': { background: 'transparent' },
            '&::-webkit-scrollbar-thumb': {
              background: '#ffffff20',
              borderRadius: '3px',
            },
            '&::-webkit-scrollbar-thumb:hover': { background: '#ffffff40' },
          }}
        >
          <Box display="grid" gridTemplateColumns="repeat(8, 1fr)" gap={2}>
            {COMMON_EMOJIS.map(emoji => (
              <Box
                key={emoji}
                as="button"
                p={2}
                borderRadius="md"
                fontSize="xl"
                cursor="pointer"
                _hover={{ bg: 'whiteAlpha.100' }}
                _active={{ bg: 'whiteAlpha.200' }}
                onClick={() => handleEmojiClick(emoji)}
                aria-label={`Select ${emoji} emoji`}
              >
                {emoji}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
