import { useAuthStore } from '../store/authStore';

export class AuthMiddleware {
  /**
   * `ReturnType<typeof setInterval>` rather than `NodeJS.Timeout`: in a browser
   * this is a number, and typing it against Node was only possible because a
   * transitive `@types/node` happened to be in scope via socket.io-client.
   */
  private static checkInterval: ReturnType<typeof setInterval> | null = null;

  static initialize() {
    // Check token expiration every minute
    AuthMiddleware.checkInterval = setInterval(() => {
      AuthMiddleware.checkTokenExpiration();
    }, 60000);

    // Initial check
    AuthMiddleware.checkTokenExpiration();
  }

  static cleanup() {
    if (AuthMiddleware.checkInterval) {
      clearInterval(AuthMiddleware.checkInterval);
      AuthMiddleware.checkInterval = null;
    }
  }

  private static checkTokenExpiration() {
    const token = useAuthStore.getState().token;

    if (!token) return;

    try {
      // Decode JWT (simple base64 decode of payload)
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiresAt = payload.exp * 1000; // Convert to milliseconds

      // If expired or expiring in next 5 minutes, logout
      if (Date.now() >= expiresAt - 5 * 60 * 1000) {
        AuthMiddleware.handleExpiration();
      }
    } catch (error) {
      console.error('Failed to check token expiration:', error);
      AuthMiddleware.handleExpiration();
    }
  }

  private static handleExpiration() {
    // Clear auth state
    useAuthStore.getState().clearAuth();

    // Show notification (can add toast later)
    console.warn('Session expired. Please log in again.');
  }

  // Add to WebSocket connection handler
  static handleWebSocketError(error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string' &&
      (error.message.includes('jwt') || error.message.includes('token'))
    ) {
      AuthMiddleware.handleExpiration();
    }
  }
}
