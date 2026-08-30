import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HttpFactory, type HttpApp } from '@dunx/http';
import { OpenApiModule } from '@dunx/openapi';
import { testRoot } from '@dunx/testing';
import { request } from 'node:http';
import { AppModule } from './app.module.js';
import { dropTestNamespaces, testNamespace } from './test-support/namespace.js';

/**
 * Response compression, against a real `Bun.serve`.
 *
 * `Bun.serve` does no content encoding, so before dunx 2.5.0 this app shipped its
 * 1.5 MB explorer bundle as plain bytes. `Compression` is opt-in middleware whose
 * **position** is the app's decision, and that is the half worth testing:
 * `http.options.ts` puts it ahead of `StaticFiles` rather than in the
 * `app.use(Compression)` the docs show, because `use()` appends and `StaticFiles`
 * answers without calling anything inside it.
 *
 * The graph is `OpenApiModule` over `AppModule`, as `main.ts` builds it, because
 * the assets worth compressing are the explorer's.
 */
const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  QUEUE_CONSUME: 'false',
  THROTTLE_LIMIT: '10000',
  ...testNamespace(),
};

interface Wire {
  readonly encoding: string | null;
  readonly vary: string | null;
  readonly contentLength: string | null;
  readonly bytes: number;
}

let app: HttpApp;
let port: number;

/**
 * `node:http`, not `fetch`. Bun's `fetch` decodes the body transparently, so it
 * can report the header but never the encoded size - and the encoded size is the
 * entire point of this file.
 */
const wire = (path: string, acceptEncoding: string): Promise<Wire> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: { 'accept-encoding': acceptEncoding },
      },
      (res) => {
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
        });
        res.on('end', () =>
          resolve({
            encoding: res.headers['content-encoding'] ?? null,
            vary: res.headers['vary'] ?? null,
            contentLength: res.headers['content-length'] ?? null,
            bytes,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });

const BUNDLE = '/api/docs/swagger-ui-bundle.js';

beforeAll(async () => {
  app = await HttpFactory.create(
    OpenApiModule.forRoot({
      title: 'firecracker-be',
      version: '0.1.0',
      root: testRoot([AppModule.forRoot({ source, logLevel: 'fatal' })]),
    }),
    { requestLogging: false },
  );
  app.setGlobalPrefix('api');
  port = Number(new URL(await app.listen(0)).port);
});

afterAll(async () => {
  await app.shutdown();
  await dropTestNamespaces();
});

describe('response compression', () => {
  /**
   * The explorer bundle is the largest thing this app serves, and the reason
   * compression is on at all.
   */
  test('the explorer bundle is encoded, and zstd is preferred', async () => {
    const plain = await wire(BUNDLE, 'identity');
    const encoded = await wire(BUNDLE, 'zstd, gzip');

    expect(plain.encoding).toBeNull();
    expect(encoded.encoding).toBe('zstd');
    // Better than halved, on the one response nobody can avoid downloading.
    expect(encoded.bytes).toBeLessThan(plain.bytes / 2);
  });

  /** Negotiated, not assumed: a client that cannot take zstd still gets gzip. */
  test('a gzip-only client gets gzip', async () => {
    const gzip = await wire(BUNDLE, 'gzip');
    expect(gzip.encoding).toBe('gzip');
    expect(gzip.bytes).toBeLessThan(500_000);
  });

  /**
   * `vary` rides every response the middleware considered, encoded or not, or a
   * cache keyed on one would hand encoded bytes to a client that asked for none.
   */
  test.each(['identity', 'gzip', 'zstd, gzip'])(
    'vary is set for accept-encoding: %s',
    async (accept) => {
      expect((await wire(BUNDLE, accept)).vary).toContain('accept-encoding');
    },
  );

  /**
   * Two encoders, and the difference is observable. A body under the buffer limit
   * is encoded synchronously and keeps an accurate `content-length`; one over it
   * goes through `CompressionStream` and must lose the header.
   */
  test('a buffered body keeps its content-length, a streamed one cannot', async () => {
    const buffered = await wire('/api/openapi.json', 'gzip');
    expect(buffered.encoding).toBe('gzip');
    expect(buffered.contentLength).toBe(String(buffered.bytes));

    const streamed = await wire(BUNDLE, 'gzip');
    expect(streamed.contentLength).toBeNull();
  });

  /**
   * A PNG comes out of a second pass slightly larger, having spent the CPU to get
   * there, so an incompressible type is skipped rather than attempted.
   */
  test('an already-compressed type is left alone', async () => {
    const png = await wire('/api/docs/favicon-32x32.png', 'zstd, gzip');
    expect(png.encoding).toBeNull();
  });

  /**
   * Under the 1024-byte threshold. A short body grows under gzip - the header and
   * trailer alone are 18 bytes - so the round trip would send more, slower.
   */
  test('a body below the threshold is sent as it is', async () => {
    const small = await wire('/api/service/config', 'zstd, gzip');
    expect(small.encoding).toBeNull();
    expect(small.bytes).toBeLessThan(1024);
  });
});
