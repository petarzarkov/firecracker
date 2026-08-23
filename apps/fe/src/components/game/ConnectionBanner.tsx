import { Box, Button, Flex, Spinner, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { useSocket } from '@/SocketContext';
import {
  RECONNECT_ATTEMPTS,
  useConnectionStore,
} from '@/store/connectionStore';

/**
 * How long a first connect may take before it is worth mentioning.
 *
 * A healthy upgrade is well under this, and a banner that flashes on every load
 * teaches a player to ignore the one that matters. A *drop* is shown immediately -
 * there the player is already mid-round and owed an explanation.
 */
const FIRST_CONNECT_GRACE_MS = 1500;

/**
 * Says when the client has lost the server.
 *
 * Everything under it - the chart, the countdown, the bet button - renders from the
 * last frame the server sent, and goes on rendering it happily after the server
 * stops sending. So a dead connection looked like a round that had simply stalled:
 * a frozen multiplier, a countdown at 8s forever, and a PLACE BET that queued a
 * frame into `#pending` and never answered.
 *
 * Fixed over the header rather than pushed into the layout. In flow it would resize
 * the chart box on appearance and again on dismissal, which is a canvas resize and
 * a redrawn axis in the middle of the moment a player is trying to read.
 */
export function ConnectionBanner() {
  const socket = useSocket();
  const status = useConnectionStore((state) => state.status);
  const attempt = useConnectionStore((state) => state.attempt);
  const setStatus = useConnectionStore((state) => state.setStatus);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (status === 'online') {
      setShown(false);
      return;
    }
    const delay = status === 'connecting' ? FIRST_CONNECT_GRACE_MS : 0;
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [status]);

  if (!shown) return null;

  const offline = status === 'offline';

  return (
    <Flex
      position="fixed"
      top={0}
      left={0}
      right={0}
      zIndex={1300}
      px={3}
      py={2}
      gap={3}
      align="center"
      justify="center"
      fontFamily="mono"
      bg={offline ? 'red.700' : 'orange.600'}
      color="white"
      boxShadow="0 2px 12px rgba(0,0,0,0.6)"
    >
      {!offline && <Spinner size="xs" borderWidth="2px" flexShrink={0} />}

      <Box minW={0}>
        <Text fontSize={{ base: 'xs', lg: 'sm' }} fontWeight="bold">
          {offline ? 'Connection lost' : 'Reconnecting…'}
        </Text>
        <Text fontSize="xs" opacity={0.85}>
          {offline
            ? 'The game server is not answering.'
            : attempt > 0
              ? `Attempt ${attempt} of ${RECONNECT_ATTEMPTS} — bets are paused.`
              : 'Bets are paused until the server answers.'}
        </Text>
      </Box>

      {offline && (
        <Button
          size="xs"
          bg="white"
          color="red.800"
          fontFamily="mono"
          fontWeight="bold"
          flexShrink={0}
          _hover={{ bg: 'gray.200' }}
          onClick={() => {
            if (socket === null) return;
            // Optimistic, so the button answers on the click rather than on the
            // shim's first `connect_error` a second later.
            setStatus('connecting');
            socket.connect();
          }}
        >
          RETRY
        </Button>
      )}
    </Flex>
  );
}
