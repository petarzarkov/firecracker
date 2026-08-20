import { useCallback } from 'react';
import { toaster } from '@/components/Toaster';

/**
 * A toast, from anywhere.
 *
 * `notify` is memoised with no dependencies, and that is load-bearing rather than
 * tidy: `useWebSocket` lists it in the dependencies of the effect that owns the
 * socket, so a fresh function identity on every render would tear the connection
 * down and open a new one twice a second. `toaster` is a module singleton, so there
 * is nothing for the closure to capture.
 */
export const useNotify = () => {
  const notify = useCallback(
    (
      title: string,
      description?: string,
      type: 'success' | 'error' | 'info' = 'info',
    ) => {
      toaster.create({ title, description, type });
    },
    [],
  );

  return { notify };
};
