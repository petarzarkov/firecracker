import { useEffect, useState } from 'react';
import { LoginForm } from './components/auth/LoginForm';
import { OAuthCallback } from './components/auth/OAuthCallback';
import { Game } from './components/game/Game';
import { AuthMiddleware } from './middleware/authMiddleware';
import { SocketProvider } from './SocketContext';
import { useAuthStore } from './store/authStore';

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  /**
   * Whether a signed-out visitor has asked for the sign-in card.
   *
   * The lobby is what they get first now. Watching is public on the server - the
   * gateway admits anonymous callers and the state route is `@Public()` - and the
   * client was the only thing turning a first visit into a form. A crash game's
   * lobby is its own advertisement; asking for an account before showing it is
   * asking someone to buy a ticket to read the poster.
   */
  const [authView, setAuthView] = useState<'none' | 'login' | 'register'>(
    'none',
  );

  useEffect(() => {
    AuthMiddleware.initialize();
    return () => AuthMiddleware.cleanup();
  }, []);

  /**
   * Takes down `index.html`'s boot splash.
   *
   * From an effect rather than from `main.tsx`, because `render()` schedules a
   * commit rather than performing one - removing the splash beside the call can
   * uncover an `#root` React has not filled yet, which is the white flash the
   * splash exists to prevent. By the time an effect runs, the first commit is in
   * the DOM.
   */
  useEffect(() => {
    document.getElementById('boot')?.remove();
  }, []);

  /**
   * Puts the card away once it has done its job.
   *
   * Signing in is easy - the user appears. **Converting is not**: a demo player is
   * already signed in when they open the register form, so nothing about
   * `isAuthenticated` changes and the form sat there spinning over a sign-up the
   * server had already completed. What changes is that the account stops being a
   * demo one.
   */
  useEffect(() => {
    if (authView === 'none') return;
    const done =
      authView === 'register'
        ? isAuthenticated && user !== null && user.isDemo !== true
        : isAuthenticated && user !== null;
    if (done) setAuthView('none');
  }, [authView, isAuthenticated, user]);

  if (window.location.pathname === '/oauth/callback') {
    return <OAuthCallback />;
  }

  // Guards stale `localStorage` (isAuthenticated with no user). Deliberately does
  // **not** check the token: a social sign-in has a cookie and no token, and that
  // is a signed-in user. `AuthMiddleware` is what checks the session is still live.
  const signedIn = isAuthenticated && user !== null;

  /**
   * The card, for the two ways into an account: a visitor signing in, and a demo
   * player converting. `register` is the second - better-auth's `anonymous()` links
   * the sign-up to the session already open, so it keeps the run rather than
   * starting a new one.
   */
  if (authView !== 'none' && (!signedIn || authView === 'register')) {
    return (
      <LoginForm
        initialMode={authView === 'register' ? 'register' : 'login'}
        onBack={() => setAuthView('none')}
      />
    );
  }

  return (
    <SocketProvider>
      <Game
        onSignIn={() => setAuthView('login')}
        onConvert={() => setAuthView('register')}
      />
    </SocketProvider>
  );
}

export default App;
