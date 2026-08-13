import { useEffect } from 'react';
import { LoginForm } from './components/auth/LoginForm';
import { OAuthCallback } from './components/auth/OAuthCallback';
import { Game } from './components/game/Game';
import { AuthMiddleware } from './middleware/authMiddleware';
import { SocketProvider } from './SocketContext';
import { useAuthStore } from './store/authStore';

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    AuthMiddleware.initialize();
    return () => AuthMiddleware.cleanup();
  }, []);

  if (window.location.pathname === '/oauth/callback') {
    return <OAuthCallback />;
  }

  // Guard against stale localStorage state (isAuthenticated=true but token/user missing)
  if (!isAuthenticated || !token || !user) {
    return <LoginForm />;
  }

  return (
    <SocketProvider>
      <Game />
    </SocketProvider>
  );
}

export default App;
