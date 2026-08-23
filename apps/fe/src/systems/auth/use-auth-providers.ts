import { useEffect, useState } from 'react';
import { apiFetch } from '@/systems/network/api';
import type { SocialProvider } from './auth-api';

/**
 * Which social sign-ins this deployment can actually complete.
 *
 * The buttons were a fixed pair in the markup - GitHub and LinkedIn - and the server
 * enables a provider only when both halves of its credentials are set. So the list
 * was wrong in both directions at once: Google is supported and had no button, and a
 * deployment configured for Google alone still offered two that die at the callback.
 *
 * Fetched once per mount, and an empty list on failure. A missing button leaves the
 * email form and the demo working; a button that cannot work leaves a player on an
 * error page with nothing to press.
 */
export const enabledProviders = (): readonly SocialProvider[] => {
  const [providers, setProviders] = useState<readonly SocialProvider[]>([]);

  useEffect(() => {
    let live = true;

    apiFetch('/api/service/config')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { authProviders?: unknown } | null) => {
        if (!live || body === null || !Array.isArray(body.authProviders))
          return;
        setProviders(body.authProviders as readonly SocialProvider[]);
      })
      .catch(() => {
        /* Left empty: see above. */
      });

    return () => {
      live = false;
    };
  }, []);

  return providers;
};
