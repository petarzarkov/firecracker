import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { version } from './package.json';

export default defineConfig(({ mode }) => {
  const apiTarget =
    loadEnv(mode, process.cwd())['VITE_API_PROXY_TARGET'] ??
    'http://localhost:3999';

  process.env = {
    ...process.env,
    ...loadEnv(mode, process.cwd()),
    VITE_VERSION: version,
    /**
     * Empty in both modes, meaning **the current origin**, and that is the whole
     * point.
     *
     * It used to be `http://localhost:3999` in development, so the browser talked
     * to the API cross-origin. That works for `fetch` with CORS and breaks two
     * things that matter:
     *
     *  - **The session cookie.** better-auth issues it `SameSite=Lax`, which a
     *    browser does not send on a cross-origin WebSocket upgrade - so every
     *    socket in development connected as a spectator.
     *  - **Social sign-in.** The OAuth callback sets the cookie and redirects; the
     *    client never sees a bearer token, so there is nothing to fall back to.
     *
     * Going through Vite's proxy below makes development the same shape as
     * production - one origin, cookies everywhere - and the proxy has `ws: true`,
     * so the upgrade is forwarded rather than dropped. Override it only to point a
     * client at a remote API deliberately.
     */
    VITE_API_URL: loadEnv(mode, process.cwd())['VITE_API_URL'] ?? '',
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
      /**
       * Must match `API_PORT` in apps/be/.env, and `http://localhost:5173` must be
       * in that file's `AUTH_TRUSTED_ORIGINS` - better-auth checks the `Origin`
       * header, which the browser still sets to Vite's port through a proxy.
       */
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
        // `ws: true` is what forwards the upgrade rather than answering it.
        '/ws': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
          secure: false,
        },
      },
    },
    build: {
      emptyOutDir: true,
      chunkSizeWarningLimit: 1000,
      /**
       * **No `manualChunks`.** There was one - `vendor`, `ui`, `state`, `markdown`,
       * `syntax` - and naming a chunk after a CommonJS package is what made the
       * initial load 1.4 MB.
       *
       * `react-syntax-highlighter` is CJS, so `@rollup/plugin-commonjs` gives it an
       * interop helper. Told to put that package in a chunk called `syntax`, rollup
       * put the *helper* there too - and the helper is shared, so every other chunk,
       * the entry and all seven PIXI ones, ended up statically importing `syntax`.
       * Vite then listed it and its `markdown` dependency in `index.html` as
       * `modulepreload`, and a crash game fetched 740 kB of markdown renderer and
       * syntax highlighter, eagerly, to draw a rocket.
       *
       * Left alone, rollup splits on the dynamic imports that are actually there -
       * `@firecracker/stage` and `LazyChatWindow` - and the entry is the app.
       * Nothing gained a chunk boundary by being named; two things lost one.
       */
    },
  };
});
