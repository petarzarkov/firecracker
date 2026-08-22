import {
  type ChatAckPayload,
  type ChatLine,
  GAME_CLIENT_EVENTS,
  type ConnectedPayload,
  NotificationKind,
  type NotificationPayload,
  PLAYER_CHAT_EVENTS,
  type PlayerChatMessagePayload,
  type PlayerChatRoom,
  type PlayerChatSystemPayload,
  SOCKET_EVENTS,
} from '@firecracker/contracts';
import { useEffect, useState } from 'react';
import { io, type Socket } from './socket';
import { useNotify } from '@/hooks/useNotify';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';

/**
 * A line of chat is one type, `ChatLine`, for both the live `message` frame and the
 * `chatHistory` replay - `ChatService` stores exactly what it broadcasts.
 *
 * It used to be declared here as well as on the server, and the two diverged: the
 * history arrived as `username` while this file mapped a `senderName` the server
 * had stopped sending, and the chat panel crashed on render. It also had
 * `timestamp: Date`, which no JSON frame has ever carried - the server sends an
 * ISO string, and `new Date(...)` below is what turns it into one.
 */

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
  const setGlobalChatMessages = useChatStore(
    (state) => state.setGlobalChatMessages,
  );
  const setConnectedPlayers = useChatStore(
    (state) => state.setConnectedPlayers,
  );
  const { notify } = useNotify();

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

      newSocket.on(SOCKET_EVENTS.CONNECTED, (data: ConnectedPayload) => {
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

      newSocket.on(PLAYER_CHAT_EVENTS.ROOM_CREATED, (data: PlayerChatRoom) => {
        newSocket.emit(GAME_CLIENT_EVENTS.JOIN_PLAYER_CHAT, {
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
      });

      newSocket.on(PLAYER_CHAT_EVENTS.ROOM_JOINED, (data: PlayerChatRoom) => {
        createPlayerChat(
          data.roomId,
          data.participants,
          data.participantNames,
          data.creatorId,
          data.creatorName,
        );
      });

      newSocket.on(
        PLAYER_CHAT_EVENTS.MESSAGE,
        (data: PlayerChatMessagePayload) => {
          addPlayerChatMessage(data.roomId, {
            senderId: data.senderId,
            senderName: data.senderName,
            message: data.message,
            // The frame carries an ISO string; `ChatMessage.timestamp` is a
            // `Date`, and the panel calls `toLocaleTimeString` on it. This
            // handler was passing the string straight through under a `Date`
            // annotation, which the shared type no longer permits.
            timestamp: new Date(data.timestamp),
          });
        },
      );

      newSocket.on(
        PLAYER_CHAT_EVENTS.SYSTEM_MESSAGE,
        (data: PlayerChatSystemPayload) => {
          addPlayerChatMessage(data.roomId, {
            senderId: 'system',
            senderName: 'System',
            message: data.message,
            timestamp: new Date(data.timestamp),
            isSystem: true,
          });
        },
      );

      /**
       * The scrollback, sent once when the socket opens.
       *
       * Chat is persisted server-side, so a reload does not start an empty room -
       * it did before this handler existed, which read as the feature being
       * broken rather than reset. See `ChatService` on the server.
       */
      newSocket.on(SOCKET_EVENTS.CHAT_HISTORY, (lines: readonly ChatLine[]) => {
        setGlobalChatMessages(
          (lines ?? []).map((line) => ({
            senderId: line.username,
            senderName: line.username,
            senderPicture: line.picture ?? undefined,
            message: line.message,
            timestamp: new Date(line.timestamp),
          })),
        );
      });

      // Chat — the server emits 'message' for each new line
      // Server shape: { username, message, timestamp }
      newSocket.on(SOCKET_EVENTS.MESSAGE, (data: ChatLine) => {
        addGlobalChatMessage({
          senderId: data.username,
          senderName: data.username,
          senderPicture: data.picture ?? undefined,
          message: data.message,
          timestamp: new Date(data.timestamp),
        });
      });

      newSocket.on(SOCKET_EVENTS.USER_COUNT, (count: number) => {
        setConnectedPlayers(count);
      });

      /**
       * The answer to a line this client sent. Only the refusals are worth showing:
       * the line itself arrives back through `message` like everyone else's, so a
       * toast on success would be a second copy of what the panel already renders.
       */
      newSocket.on(SOCKET_EVENTS.CHAT_ACK, (ack: ChatAckPayload) => {
        if (ack.error !== undefined)
          notify('Message not sent', ack.error, 'error');
      });

      /**
       * Notices published by the worker process - a sign-up, a suspension - onto
       * this user's own topic and, for an administrator, the admin room.
       *
       * The text arrives written: the server knows which job produced it, and a
       * browser reading a job name off the wire is a browser coupled to the queue.
       * `kind` only decides how the toast looks.
       */
      newSocket.on(SOCKET_EVENTS.NOTIFICATION, (data: NotificationPayload) => {
        notify(
          data.title,
          data.message,
          data.kind === NotificationKind.USER_BANNED ? 'error' : 'success',
        );
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
        activeSocket.off(SOCKET_EVENTS.CONNECTED);
        activeSocket.off('error');
        for (const event of Object.values(PLAYER_CHAT_EVENTS))
          activeSocket.off(event);
        activeSocket.off(SOCKET_EVENTS.CHAT_HISTORY);
        activeSocket.off(SOCKET_EVENTS.MESSAGE);
        activeSocket.off(SOCKET_EVENTS.USER_COUNT);
        activeSocket.off(SOCKET_EVENTS.CHAT_ACK);
        activeSocket.off(SOCKET_EVENTS.NOTIFICATION);
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
    setGlobalChatMessages,
    setConnectedPlayers,
    notify,
  ]);

  return socket;
}
