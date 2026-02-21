import {
  Box,
  Code,
  Flex,
  Heading,
  HStack,
  IconButton,
  Image,
  Link,
  List,
  Text,
  useClipboard,
} from '@chakra-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FaCheck, FaCopy } from 'react-icons/fa';
import { MdExpandLess, MdExpandMore } from 'react-icons/md';
import ReactMarkdown, { Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'; // Dark theme for code
import type { ChatMessage } from '../../types';
import { Tooltip } from '../Tooltip';

// Maximum height for collapsed code blocks (in pixels)
const MAX_COLLAPSED_HEIGHT_CODE_PX = 200;

interface MessageBubbleProps {
  message: ChatMessage;
  isOwnMessage: boolean;
  themeColor: string;
}

export function MessageBubble({
  message,
  isOwnMessage,
  themeColor,
}: MessageBubbleProps) {
  // --- STYLING CONSTANTS ---
  const userBg = `${themeColor}20`; // 20% opacity
  const botBg = 'whiteAlpha.100';
  const borderColor = isOwnMessage ? `${themeColor}40` : 'transparent';

  // --- MARKDOWN COMPONENTS (The Secret Sauce for formatting) ---
  const markdownComponents: Components = useMemo(
    () => ({
      // Handle Code Blocks & Inline Code
      code(props) {
        const { children, className, node, ...rest } = props;
        const match = /language-(\w+)/.exec(className || '');
        const codeString = String(children).replace(/\n$/, '');
        const isInline = !match && !String(children).includes('\n');

        // 1. INLINE CODE (e.g. `const x = 1`)
        if (isInline) {
          return (
            <Code
              px="2"
              py="0.5"
              borderRadius="sm"
              fontSize="xs"
              bg="blackAlpha.600"
              color="#e6edf3" // Light text for better visibility
              whiteSpace="pre-wrap" // CRITICAL: Allows wrapping
              wordBreak="break-word" // CRITICAL: Breaks long words
              border="1px solid"
              borderColor="whiteAlpha.200"
              {...rest}
            >
              {children}
            </Code>
          );
        }

        // 2. BLOCK CODE (e.g. ```typescript ... ```)
        return (
          <CodeBlock
            language={match ? match[1] : 'text'}
            codeString={codeString}
          />
        );
      },
      // Handle Paragraphs
      p: ({ children }) => (
        <Text mb={2} fontSize="sm" lineHeight="tall" wordBreak="break-word">
          {children}
        </Text>
      ),
      // Handle Links
      a: ({ children, href }) => (
        <Link
          href={href || ''}
          target="_blank"
          color="blue.300"
          textDecoration="underline"
          _hover={{ color: 'blue.200' }}
        >
          {children}
        </Link>
      ),
      ul: ({ children, node, ...props }) => (
        <List.Root as="ul" ml={5} my={2} gap={1} {...props}>
          {children}
        </List.Root>
      ),
      ol: ({ children, node, ...props }) => (
        <List.Root as="ol" ml={5} my={2} gap={1} {...props}>
          {children}
        </List.Root>
      ),
      li: ({ children, node, ...props }) => (
        <List.Item pb={1} {...props}>
          {children}
        </List.Item>
      ),
      h1: ({ children, node, ...props }) => (
        <Heading
          as="h1"
          size="lg"
          my={4}
          pb={1}
          borderBottomWidth="1px"
          {...props}
        >
          {children}
        </Heading>
      ),
      h2: ({ children, node, ...props }) => (
        <Heading
          as="h2"
          size="md"
          my={3}
          pb={1}
          borderBottomWidth="1px"
          {...props}
        >
          {children}
        </Heading>
      ),
      h3: ({ children, node, ...props }) => (
        <Heading as="h3" size="sm" my={2} {...props}>
          {children}
        </Heading>
      ),
      h4: ({ children, ...props }) => (
        <Heading as="h4" size="xs" my={2} {...props}>
          {children}
        </Heading>
      ),
    }),
    [],
  );

  return (
    <Flex w="full" justify={isOwnMessage ? 'flex-end' : 'flex-start'} mb={4}>
      <Flex
        maxW="85%"
        flexDirection="column"
        alignItems={isOwnMessage ? 'flex-end' : 'flex-start'}
      >
        {/* Sender Info */}
        <HStack mb={1} gap={2} align="center">
          {message.senderPicture && (
            <Image
              boxSize="2xs"
              objectFit="cover"
              objectPosition="center"
              borderRadius="full"
              h="20px"
              w="20px"
              src={message.senderPicture || ''}
              alt={message.senderName}
            />
          )}
          <Text fontSize="xs" color="gray.500" fontWeight="bold">
            {isOwnMessage
              ? 'You'
              : message.model
                ? `${message.senderName} (${message.model})`
                : message.senderName}
          </Text>
          <Text fontSize="2xs" color="gray.600">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </HStack>

        {/* The Bubble */}
        <Box
          bg={isOwnMessage ? userBg : botBg}
          border="1px solid"
          borderColor={borderColor}
          color="gray.100"
          px={4}
          py={3}
          borderRadius="lg"
          borderTopLeftRadius={!isOwnMessage ? '0' : 'lg'}
          borderTopRightRadius={isOwnMessage ? '0' : 'lg'}
          boxShadow="sm"
          width="fit-content"
          maxWidth="100%"
          overflow="hidden" // Prevents child content from overflowing
        >
          <ReactMarkdown components={markdownComponents}>
            {message.message}
          </ReactMarkdown>
        </Box>
      </Flex>
    </Flex>
  );
}

// Helper Component for Code Blocks with Copy Button and Expand/Collapse
function CodeBlock({
  language,
  codeString,
}: {
  language: string;
  codeString: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsible, setIsCollapsible] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { copied: hasCopied, copy } = useClipboard({ value: codeString });

  // Check if content exceeds threshold and enable collapse functionality
  // biome-ignore lint/correctness/useExhaustiveDependencies: codeString is needed to re-check height when content changes
  useEffect(() => {
    setIsCollapsible(false);
    setIsExpanded(false);

    const timeoutId = setTimeout(() => {
      if (contentRef.current) {
        const exceedsThreshold =
          contentRef.current.scrollHeight > MAX_COLLAPSED_HEIGHT_CODE_PX;
        setIsCollapsible(exceedsThreshold);
      }
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [codeString]);

  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <Box
      position="relative"
      my={3}
      borderRadius="md"
      overflow="hidden"
      border="1px solid"
      borderColor="whiteAlpha.200"
      bg="blackAlpha.800"
    >
      {/* Header bar for code block */}
      <Flex
        bg="blackAlpha.700"
        px={3}
        py={2}
        justify="space-between"
        align="center"
        borderBottom="1px solid"
        borderColor="whiteAlpha.100"
      >
        <Text
          fontSize="xs"
          color="gray.300"
          fontFamily="monospace"
          textTransform="uppercase"
          fontWeight="semibold"
        >
          {language}
        </Text>
        <HStack gap={1}>
          {/* Expand/Collapse Button */}
          {isCollapsible && (
            <Tooltip
              content={isExpanded ? 'Collapse' : 'Expand'}
              closeOnClick={false}
            >
              <IconButton
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                size="sm"
                variant="solid"
                bg="whiteAlpha.200"
                color="gray.100"
                _hover={{
                  bg: 'whiteAlpha.300',
                  color: 'white',
                }}
                _active={{
                  bg: 'whiteAlpha.400',
                }}
                onClick={toggleExpansion}
              >
                {isExpanded ? <MdExpandLess /> : <MdExpandMore />}
              </IconButton>
            </Tooltip>
          )}
          {/* Copy Button */}
          <Tooltip
            content={hasCopied ? 'Copied!' : 'Copy Code'}
            closeOnClick={false}
          >
            <IconButton
              aria-label="Copy code"
              size="sm"
              variant="solid"
              bg={hasCopied ? 'green.500' : 'whiteAlpha.200'}
              color={hasCopied ? 'white' : 'gray.100'}
              _hover={{
                bg: hasCopied ? 'green.600' : 'whiteAlpha.300',
                color: 'white',
              }}
              _active={{
                bg: hasCopied ? 'green.700' : 'whiteAlpha.400',
              }}
              onClick={copy}
            >
              {hasCopied ? <FaCheck /> : <FaCopy />}
            </IconButton>
          </Tooltip>
        </HStack>
      </Flex>

      {/* Code content container with expand/collapse */}
      <Box
        ref={contentRef}
        maxHeight={
          isCollapsible && !isExpanded
            ? `${MAX_COLLAPSED_HEIGHT_CODE_PX}px`
            : 'none'
        }
        overflowY={isCollapsible && !isExpanded ? 'auto' : 'visible'}
        overflowX="hidden"
        transition="max-height 0.3s ease-out"
        position="relative"
        css={{
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(0, 0, 0, 0.2)',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: 'rgba(255, 255, 255, 0.3)',
          },
        }}
      >
        {/* The actual code highlighter */}
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: '16px',
            fontSize: '0.85rem',
            backgroundColor: '#0d1117', // Dark GitHub-like background
            color: '#e6edf3', // Light text color for better visibility
            whiteSpace: 'pre-wrap', // Wrap long lines
            wordBreak: 'break-word', // Break long words
          }}
          wrapLines={true}
          wrapLongLines={true}
        >
          {codeString}
        </SyntaxHighlighter>
      </Box>
    </Box>
  );
}
