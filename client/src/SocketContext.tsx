import { createContext, useContext } from 'react';
import { Socket } from 'socket.io-client';
import { useWebSocket } from './systems/network/useWebSocket';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  // This is the ONLY place useWebSocket is called
  const socket = useWebSocket();
  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}

export const useSocket = () => useContext<Socket | null>(SocketContext);
