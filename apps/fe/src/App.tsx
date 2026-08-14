import { useEffect } from 'react';
import { LoginForm } from './components/auth/LoginForm';
import { OAuthCallback } from './components/auth/OAuthCallback';
import { Game } from './components/game/Game';
import { AuthMiddleware } from './middleware/authMiddleware';
import { SocketProvider } from './SocketContext';
import { useAuthStore } from './store/authStore';

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    AuthMiddleware.initialize();
    return () => AuthMiddleware.cleanup();
  }, []);

  if (window.location.pathname === '/oauth/callback') {
    return <OAuthCallback />;
  }

  // Guards stale `localStorage` (isAuthenticated with no user). Deliberately does
  // **not** check the token: a social sign-in has a cookie and no token, and that
  // is a signed-in user. `AuthMiddleware` is what checks the session is still live.
  if (!isAuthenticated || !user) {
    return <LoginForm />;
  }

  return (
    <SocketProvider>
      <Game />
    </SocketProvider>
  );
}

export default App;
