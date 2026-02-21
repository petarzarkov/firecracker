import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { version } from './package.json';

export default defineConfig(({ mode }) => {
  process.env = {
    ...process.env,
    ...loadEnv(mode, process.cwd()),
    VITE_VERSION: version,
    // In development, socket.io connects directly to the backend to avoid
    // Vite's WS proxy issues with the HTTP→WebSocket upgrade handshake.
    // In production builds (or when VITE_API_URL is set in .env), this is overridden.
    VITE_API_URL:
      loadEnv(mode, process.cwd()).VITE_API_URL ??
      (mode === 'development' ? 'http://localhost:3011' : ''),
  };
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3011',
          changeOrigin: true,
          secure: false,
          rewrite: path => path,
        },
        '/ws': {
          target: 'http://localhost:3011',
          changeOrigin: true,
          ws: true,
          secure: false,
        },
      },
    },
    build: {
      emptyOutDir: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-icons'],
            ui: ['@chakra-ui/react'],
            state: ['zustand', 'immer'],
            socket: ['socket.io-client'],
            markdown: ['react-markdown'],
            syntax: ['react-syntax-highlighter'],
          },
        },
      },
    },
  };
});
