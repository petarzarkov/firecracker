import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
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

  const token = useAuthStore(state => state.token);
  const { user, updateUser } = useAuthStore(state => state);
  const clearAuth = useAuthStore(state => state.clearAuth);
  const {
    createPlayerChat,
    addPlayerChatMessage,
    addGlobalChatMessage,
    setConnectedPlayers,
  } = useChatStore();

  // biome-ignore lint/correctness/useExhaustiveDependencies: we need to update the user when the socket is connected
  useEffect(() => {
    if (!token || !user) {
      console.log('[WebSocket] No token or user, skipping socket connection', {
        token,
        user,
      });
      setSocket(prev => {
        prev?.disconnect();
        return null;
      });
      return;
    }

    // In dev, VITE_API_URL = 'http://localhost:3011' (set in vite.config.ts),
    // so socket.io connects directly to the backend instead of going through
    // Vite's proxy (which drops WS upgrade handshakes).
    // In production builds VITE_API_URL is '' → connects to the current origin.
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

      const newSocket = io(apiUrl, {
        auth: {
          token: `Bearer ${token}`,
        },
        path: '/ws',
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      activeSocket = newSocket;

      newSocket.on('disconnect', reason => {
        if (reason === 'io server disconnect') {
          clearAuth();
          window.location.href = '/';
        }
      });

      newSocket.on('connect_error', error => {
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

      newSocket.on('error', error => {
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
  }, [
    token,
    user?.id,
    clearAuth,
    updateUser,
    createPlayerChat,
    addPlayerChatMessage,
    addGlobalChatMessage,
    setConnectedPlayers,
  ]);

  return socket;
}
