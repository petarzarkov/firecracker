import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import * as authApi from '../../systems/auth/auth-api';

/**
 * Where a social sign-in lands.
 *
 * ## What changed
 *
 * The NestJS version redirected here with `?token=…&user=…` in the query string -
 * the callback controller signed a JWT, serialised the user, and put both in a
 * URL. That is gone, and good riddance: a session token in a URL lands in browser
 * history, in the `Referer` of the next request, and in any access log between
 * here and there.
 *
 * better-auth sets an `HttpOnly` session cookie on its own callback and redirects.
 * So there is nothing to parse: this asks the server who the caller is, which
 * works because the request carries that cookie.
 */
export function OAuthCallback() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // `error` is what better-auth appends when the provider refused, or when
      // the state cookie did not survive the round trip.
      const failure = new URLSearchParams(window.location.search).get('error');
      if (failure !== null) {
        if (!cancelled) setError(failure);
        return;
      }

      const session = await authApi.currentSession();
      if (cancelled) return;

      if (session === null) {
        setError('no_session');
        return;
      }

      setAuth(session.token, session.user);
      // `replace`, not `href`: the callback URL should not be a back-button stop.
      window.location.replace('/');
    })();

    return () => {
      cancelled = true;
    };
  }, [setAuth]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1a1a',
        color: 'white',
        fontFamily: 'monospace',
        gap: '1rem',
        flexDirection: 'column',
      }}
    >
      {error === null ? (
        <div>Signing you in…</div>
      ) : (
        <>
          <div>Sign-in failed ({error}).</div>
          <a href="/" style={{ color: '#f6ad55' }}>
            Back to sign in
          </a>
        </>
      )}
    </div>
  );
}
