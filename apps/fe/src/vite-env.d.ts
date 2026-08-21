/// <reference types="vite/client" />

/**
 * `import.meta.env` and the asset module declarations.
 *
 * Referenced explicitly rather than arriving through a dependency's transitive
 * `@types/node`, which is what a browser bundle should not be typed against.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
