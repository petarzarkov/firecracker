import { useEffect, useState } from 'react';
import { io, type Socket } from './socket';
import { type User, useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import type { ChatMessage } from '@/types';

// Raw shape the server emits on the 'message' event (EventsGateway.handleChatMessage)
interface ServerChatMessage {
  username: string;
  message: string;
  timestamp: Date;
  picture?: string | null;
}

export function useWebSocket() {
  // useState (not useRef) so that setting the socket triggers a re-render and
  // the SocketContext.Provider picks up the new value.
  const [socket, setSocket] = useState<Socket | null>(null);

  /**
   * One selector per value. `useAuthStore((state) => state)` returns a fresh
   * snapshot on **every** store write, so this component re-rendered whenever
   * anything in the store changed - including changes it caused itself.
   */
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.user?.id);
  const updateUser = useAuthStore((state) => state.updateUser);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const createPlayerChat = useChatStore((state) => state.createPlayerChat);
  const addPlayerChatMessage = useChatStore(
    (state) => state.addPlayerChatMessage,
  );
  const addGlobalChatMessage = useChatStore(
    (state) => state.addGlobalChatMessage,
  );
  const setConnectedPlayers = useChatStore(
    (state) => state.setConnectedPlayers,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: we need to update the user when the socket is connected
  useEffect(() => {
    // The token is optional - see `authStore`. A cookie-authenticated session
    // upgrades fine because the app is same-origin.
    if (userId === undefined) {
      setSocket((prev) => {
        prev?.disconnect();
        return null;
      });
      return;
    }

    // Empty in both modes: development goes through Vite's proxy, which forwards
    // the upgrade (`ws: true`), so the origin is the same one the session cookie
    // was issued for. See vite.config.ts.
    const apiUrl = import.meta.env.VITE_API_URL ?? '';

    // Track whether this effect run was cleaned up before the socket connected.
    // In React StrictMode, effects run twice: mount → cleanup → mount.
    // Without this guard the first socket gets disconnected mid-handshake,
    // causing "WebSocket is closed before the connection is established".
    // Deferring to a macrotask lets StrictMode's synchronous cleanup cancel
    // the timer before the socket is ever created.
    let dismissed = false;
    let activeSocket: Socket | null = null;

    const timerId = setTimeout(() => {
      if (dismissed) return;

      // `token` rather than socket.io's `auth` handshake: a browser cannot set a
      // header on a WebSocket, so the gateway reads `?token=` and turns it into
      // the `Authorization` better-auth's bearer plugin expects. Same-origin
      // production sends the session cookie and this is redundant there.
      // `transports` is gone - there is one transport now.
      const newSocket = io(apiUrl, {
        token: token ?? undefined,
        path: '/ws',
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      activeSocket = newSocket;

      newSocket.on('disconnect', (reason: string) => {
        if (reason === 'io server disconnect') {
          clearAuth();
          window.location.href = '/';
        }
      });

      newSocket.on('connect_error', (error: Error) => {
        console.error('[WebSocket] Connection error:', error);
        if (
          error.message.includes('jwt expired') ||
          error.message.includes('unauthorized') ||
          error.message.includes('Authentication token missing')
        ) {
          clearAuth();
          window.location.href = '/';
        }
      });

      newSocket.io.on('reconnect_failed', () => {
        console.warn('[WebSocket] Reconnection failed after max attempts');
      });

      newSocket.on('connected', (data: { payload: User }) => {
        updateUser(data.payload);
      });

      newSocket.on('error', (error: unknown) => {
        console.error('WebSocket error:', error);
        if (error && typeof error === 'object' && 'message' in error) {
          const errorMessage = String(error.message);
          if (
            errorMessage.includes('jwt expired') ||
            errorMessage.includes('unauthorized')
          ) {
            clearAuth();
            window.location.href = '/';
          }
        }
      });

      // ── Player chat events ──────────────────────────────────────────────

      newSocket.on(
        'playerChatRoomCreated',
        (data: {
          roomId: string;
          participants: string[];
          participantNames: Record<string, string>;
          creatorId: string;
          creatorName: string;
        }) => {
          newSocket.emit('joinPlayerChat', {
            roomId: data.roomId,
            targetUserId: '',
          });
          createPlayerChat(
            data.roomId,
            data.participants,
            data.participantNames,
            data.creatorId,
            data.creatorName,
          );
        },
      );

      newSocket.on(
        'playerChatRoomJoined',
        (data: {
          roomId: string;
          participants: string[];
          participantNames: Record<string, string>;
          creatorId: string;
          creatorName: string;
        }) => {
          createPlayerChat(
            data.roomId,
            data.participants,
            data.participantNames,
            data.creatorId,
            data.creatorName,
          );
        },
      );

      newSocket.on(
        'playerChatMessage',
        (data: ChatMessage & { roomId: string }) => {
          addPlayerChatMessage(data.roomId, {
            senderId: data.senderId,
            senderName: data.senderName,
            senderPicture: data.senderPicture,
            message: data.message,
            timestamp: data.timestamp,
          });
        },
      );

      newSocket.on(
        'playerChatSystemMessage',
        (data: {
          roomId: string;
          message: string;
          timestamp: Date;
          type: 'join' | 'leave';
        }) => {
          addPlayerChatMessage(data.roomId, {
            senderId: 'system',
            senderName: 'System',
            message: data.message,
            timestamp: data.timestamp,
            isSystem: true,
          });
        },
      );

      // ── Global chat — server emits 'message' (EventsGateway.handleChatMessage) ──
      // Server shape: { username, message, timestamp, picture }
      newSocket.on('message', (data: ServerChatMessage) => {
        addGlobalChatMessage({
          senderId: data.username,
          senderName: data.username,
          senderPicture: data.picture ?? undefined,
          message: data.message,
          timestamp: new Date(data.timestamp),
        });
      });

      // ── Connected player count ──────────────────────────────────────────
      newSocket.on('userCount', (count: number) => {
        setConnectedPlayers(count);
      });

      // Expose socket to context — this setState triggers re-render so
      // SocketContext.Provider propagates the value to all consumers.
      setSocket(newSocket);
    }, 0);

    return () => {
      dismissed = true;
      clearTimeout(timerId);
      if (activeSocket) {
        activeSocket.off('disconnect');
        activeSocket.off('connect_error');
        activeSocket.off('connected');
        activeSocket.off('error');
        activeSocket.off('playerChatRoomCreated');
        activeSocket.off('playerChatRoomJoined');
        activeSocket.off('playerChatMessage');
        activeSocket.off('playerChatSystemMessage');
        activeSocket.off('message');
        activeSocket.off('userCount');
        activeSocket.io.off('reconnect_failed');
        activeSocket.disconnect();
        setSocket(null);
      }
    };
    /**
     * `userId`, a string - **never the `user` object**.
     *
     * This effect closes over a socket and disconnects it on cleanup, so any
     * dependency whose identity changes rebuilds the connection. `user` was that
     * dependency, the `connected` handler below writes to the store, and the
     * result was a connect/disconnect loop twice a second. `authStore` now also
     * refuses to mint a new user object for an unchanged user, so this is belt
     * and braces - both halves are worth having.
     */
  }, [
    token,
    userId,
    clearAuth,
    updateUser,
    createPlayerChat,
    addPlayerChatMessage,
    addGlobalChatMessage,
    setConnectedPlayers,
  ]);

  return socket;
}
