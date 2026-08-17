import { Box, Button, Input, Stack, Text } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { IoSend } from 'react-icons/io5';
import { useAuthStore } from '../../store/authStore';
import { useKeyboardStore } from '../../store/keyboardStore';
import type { ChatMessage } from '../../types';
import { EmojiPicker } from './EmojiPicker';
import { MessageBubble } from './MessageBubble';

interface ChatWindowProps {
  title: string;
  messages: ChatMessage[];
  isOpen: boolean;
  onClose: () => void;
  onSendMessage: (message: string) => void;
  position?: 'center' | 'bottom-right';
  themeColor?: string;
  width?: string;
  height?: string;
  placeholder?: string;
  isStreaming?: boolean;
  customHeader?: React.ReactNode;
  greeting?: string;
}

export function ChatWindow({
  title,
  messages,
  isOpen,
  onClose,
  onSendMessage,
  position = 'center',
  themeColor = '#4CAF50',
  width = '600px', // Slightly wider default
  height = '600px',
  placeholder = 'Type your message...',
  isStreaming = false,
  customHeader,
  greeting,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const user = useAuthStore((state) => state.user);
  const setKeyboardDisabled = useKeyboardStore((state) => state.setDisabled);

  // --- SCROLL LOGIC ---
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    isUserScrolledUp.current = !isAtBottom;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies  : messages, isStreaming, greeting are not needed as dependencies
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    if (!isUserScrolledUp.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [messages, isStreaming, greeting]);

  // --- KEYBOARD & FOCUS ---
  useEffect(() => {
    if (isFocused) setKeyboardDisabled(true);
    return () => setKeyboardDisabled(false);
  }, [isFocused, setKeyboardDisabled]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      isUserScrolledUp.current = false;
    }
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen && e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    isUserScrolledUp.current = false;
    onSendMessage(input);
    setInput('');
    // Keep focus
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const handleEmojiSelect = (emoji: string) => {
    const inputElement = inputRef.current;
    if (!inputElement) return;

    const start = inputElement.selectionStart || 0;
    const end = inputElement.selectionEnd || 0;
    const newValue = input.slice(0, start) + emoji + input.slice(end);

    setInput(newValue);

    // Restore cursor position after emoji insertion
    setTimeout(() => {
      inputElement.focus();
      const newPosition = start + emoji.length;
      inputElement.setSelectionRange(newPosition, newPosition);
    }, 0);
  };

  const positionStyles =
    position === 'center'
      ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
      : {
          bottom: { base: '10px', md: '20px' },
          right: { base: '10px', md: '20px' },
        };

  return (
    <Box
      {...positionStyles}
      position="fixed"
      width={width}
      maxW="95vw"
      height={height}
      maxH="90vh"
      // Modern Glass Effect
      // Matches the panels behind it: near-black, hairline border, small radius.
      bg="rgba(12, 12, 14, 0.97)"
      backdropFilter="blur(10px)"
      border="1px solid"
      borderColor={`${themeColor}55`}
      borderRadius="md"
      display="flex"
      flexDirection="column"
      zIndex="1000"
      boxShadow={`0 0 40px ${themeColor}20`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* HEADER */}
      <Box
        p="4"
        borderBottom="1px solid"
        borderColor="whiteAlpha.100"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        bg="blackAlpha.300"
        borderTopRadius="md"
      >
        <Stack direction="row" align="center" gap="4">
          <Text
            color={themeColor}
            // Monospace, like every other heading in this app - the window is a
            // panel of a terminal-styled UI, not a separate product.
            fontFamily="monospace"
            fontSize="md"
            fontWeight="bold"
            letterSpacing="wide"
            textTransform="uppercase"
          >
            {title}
          </Text>
          {customHeader}
        </Stack>
        <Button
          onClick={onClose}
          variant="ghost"
          size="sm"
          minW="auto"
          color="gray.400"
          _hover={{ color: 'white', bg: 'whiteAlpha.200' }}
        >
          <FiX size={20} />
        </Button>
      </Box>

      {/* MESSAGES AREA */}
      <Box
        flex="1"
        overflowY="auto"
        p="4"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        // Custom Scrollbar
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
        {/* Default Greeting */}
        {greeting && (
          <Box mb={4} display="flex" justifyContent="flex-start">
            <Box
              bg="whiteAlpha.100"
              p={3}
              borderRadius="lg"
              borderTopLeftRadius={0}
              border="1px solid"
              borderColor="whiteAlpha.100"
              maxW="85%"
            >
              <Text color="gray.200" fontSize="sm">
                {greeting}
              </Text>
            </Box>
          </Box>
        )}

        {/* Message List */}
        {messages.map((msg) => {
          // Filter out System messages for cleaner UI (or style them differently)
          if (msg.isSystem || msg.senderId === 'system') {
            return (
              <Box
                key={
                  new Date(msg.timestamp).getTime().toString() + msg.senderId
                }
                textAlign="center"
                my={4}
                opacity={0.6}
              >
                <Text fontSize="xs" color="gray.500" fontStyle="italic">
                  — {msg.message} —
                </Text>
              </Box>
            );
          }

          return (
            <MessageBubble
              key={new Date(msg.timestamp).getTime().toString() + msg.senderId}
              message={msg}
              isOwnMessage={msg.senderId === user?.id}
              themeColor={themeColor}
            />
          );
        })}

        {/* Typing Indicator */}
        {isStreaming && (
          <Box ml={4} mt={2}>
            <Text
              color={themeColor}
              fontSize="xs"
              fontWeight="bold"
              animation="pulse 1.5s infinite"
            >
              ● ● ●
            </Text>
          </Box>
        )}
      </Box>

      {/* INPUT AREA */}
      <Box
        as="form"
        onSubmit={handleSubmit}
        p="4"
        bg="blackAlpha.300"
        borderTop="1px solid"
        borderColor="whiteAlpha.100"
        borderBottomRadius="md"
        display="flex"
        gap="3"
      >
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={isStreaming}
          // Cleaner Input Styling
          bg="blackAlpha.400"
          border="1px solid"
          borderColor="whiteAlpha.200"
          _hover={{ borderColor: themeColor }}
          _focus={{
            borderColor: themeColor,
            boxShadow: `0 0 0 1px ${themeColor}`,
          }}
          color="white"
          fontFamily="monospace"
          fontSize="sm"
          borderRadius="4px"
          size="md"
          autoComplete="off"
        />
        <EmojiPicker
          onEmojiSelect={handleEmojiSelect}
          themeColor={themeColor}
        />
        <Button
          type="submit"
          disabled={!input.trim() || isStreaming}
          // `variant="plain"` because the app's button recipe would otherwise
          // impose its own `solid` background and ignore this one.
          variant="plain"
          bg={themeColor}
          color="black"
          fontFamily="monospace"
          borderRadius="4px"
          size="md"
          px={6}
          _hover={{ filter: 'brightness(1.15)' }}
          _active={{ filter: 'brightness(0.9)' }}
          _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
        >
          <IoSend />
        </Button>
      </Box>
    </Box>
  );
}
