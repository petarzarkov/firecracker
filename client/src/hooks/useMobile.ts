import { useEffect, useState } from 'react';

/**
 * Hook to detect if the current device is mobile
 * Checks both user agent and window width (< 800px)
 * Updates on window resize
 */
export function useMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
          window.innerWidth < 800,
      );
    };

    // Check immediately
    checkMobile();

    // Listen for resize events
    window.addEventListener('resize', checkMobile);

    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  return isMobile;
}
