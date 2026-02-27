import { Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { useGameStore } from '@/store/gameStore';

export function CountdownDisplay() {
  const waitingEndsAt = useGameStore(state => state.waitingEndsAt);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!waitingEndsAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((waitingEndsAt.getTime() - Date.now()) / 1000),
      );
      setSecs(remaining);
    }, 100);
    return () => clearInterval(interval);
  }, [waitingEndsAt]);

  return (
    <Text fontSize="2xl" color="#b0b0b0" fontWeight="semibold">
      {secs > 0 ? `Starting in ${secs}s` : 'Starting...'}
    </Text>
  );
}
