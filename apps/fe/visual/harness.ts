import { file, serve } from 'bun';

/**
 * The stage harness, served.
 *
 * `stage.entry.ts` bundled for the browser and handed out over a socket on a
 * throwaway port, along with the sprites out of `public/`. **No Vite, no API, no
 * Redis and no round of anyone else's** - the whole reason the stage specs are
 * cheap enough to run on every change is that the thing they drive is a lib with a
 * sampler for an input.
 *
 * Bundled with Bun rather than served through the dev server for the same reason:
 * a spec that needs `bun run dev` up needs the API up too, and then a screenshot of
 * a rocket depends on a queue.
 */

const ROOT = import.meta.dir;
const PUBLIC = `${ROOT}/../public`;

const PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>stage harness</title></head>
  <body style="margin:0;background:#0a0a0a">
    <script type="module" src="/harness.js"></script>
  </body>
</html>`;

export interface Harness {
  readonly url: string;
  stop(): Promise<void>;
}

const TYPES: Readonly<Record<string, string>> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  json: 'application/json',
};

export const serveHarness = async (): Promise<Harness> => {
  const built = await Bun.build({
    entrypoints: [`${ROOT}/stage.entry.ts`],
    target: 'browser',
    // PIXI reaches its renderers through dynamic `import()`, so without this the
    // bundle carries an import of a path nothing serves and the page dies at
    // `Application.init()` with a network error rather than a stack.
    splitting: true,
    // The page asks for `/harness.js` by name; left to the default the entry keeps
    // the source file's basename and the only script on the page 404s.
    naming: { entry: 'harness.[ext]', chunk: '[name]-[hash].[ext]' },
  });

  if (!built.success) {
    throw new AggregateError(built.logs, 'the harness bundle did not build');
  }

  /** Every chunk by the name it is imported as, so the page can fetch them. */
  const chunks = new Map<string, string>();
  for (const output of built.outputs) {
    chunks.set(output.path.replace(/^\.\//, ''), await output.text());
  }

  const server = serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;

      if (path === '/') {
        return new Response(PAGE, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }

      const chunk = chunks.get(path.slice(1));
      if (chunk !== undefined) {
        return new Response(chunk, {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
        });
      }

      // The sprites, from where the app itself serves them - so a rocket that
      // fails to load here is a rocket that fails to load there.
      if (path.startsWith('/sprites/') && !path.includes('..')) {
        const asset = file(`${PUBLIC}${path}`);
        if (await asset.exists()) {
          const extension = path.split('.').pop() ?? '';
          return new Response(asset, {
            headers: {
              'content-type': TYPES[extension] ?? 'application/octet-stream',
            },
          });
        }
      }

      return new Response('not found', { status: 404 });
    },
  });

  return {
    url: server.url.toString(),
    async stop(): Promise<void> {
      await server.stop(true);
    },
  };
};
