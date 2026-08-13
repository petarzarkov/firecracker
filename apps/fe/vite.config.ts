import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { version } from './package.json';

export default defineConfig(({ mode }) => {
  process.env = {
    ...process.env,
    ...loadEnv(mode, process.cwd()),
    VITE_VERSION: version,
    // In development the client talks to the backend directly rather than through
    // Vite's proxy, which drops the HTTP→WebSocket upgrade handshake. Must match
    // `API_PORT` in apps/be/.env.
    //
    // In production this is '' → the current origin, which is where the API serves
    // the built client from and therefore where the session cookie is valid. That
    // is also the only configuration in which the socket authenticates by cookie
    // rather than by the `?token=` fallback.
    VITE_API_URL:
      loadEnv(mode, process.cwd()).VITE_API_URL ??
      (mode === 'development' ? 'http://localhost:3999' : ''),
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
          rewrite: (path) => path,
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
            markdown: ['react-markdown'],
            syntax: ['react-syntax-highlighter'],
          },
        },
      },
    },
  };
});
