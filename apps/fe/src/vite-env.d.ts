/// <reference types="vite/client" />

/**
 * `import.meta.env` and the asset module declarations.
 *
 * This file used to be unnecessary by accident: `socket.io-client` pulled in
 * `@types/node` transitively, which brought the ambient globals with it. Dropping
 * socket.io-client for the native WebSocket shim took those types with it, which
 * is the right outcome - a browser bundle should not be typed against Node - but
 * it means the Vite ambients have to be referenced explicitly, as they always
 * should have been.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
