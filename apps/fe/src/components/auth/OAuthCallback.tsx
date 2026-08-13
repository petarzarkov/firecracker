import { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';

export function OAuthCallback() {
  const setAuth = useAuthStore((state) => state.setAuth);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const userStr = params.get('user');

    if (token && userStr) {
      try {
        const user = JSON.parse(decodeURIComponent(userStr));
        setAuth(token, user);
        window.location.href = '/';
      } catch (error) {
        console.error('Failed to parse OAuth callback:', error);
        window.location.href = '/?error=auth_failed';
      }
    } else {
      window.location.href = '/?error=missing_params';
    }
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
      }}
    >
      <div>Processing authentication...</div>
    </div>
  );
}
