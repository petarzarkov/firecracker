import { afterEach, describe, expect, test } from 'bun:test';
import { chooseAvatar, uploadAvatar } from './avatar';

/**
 * Two calls, in one order: the bytes reach `POST /api/files`, and only the id it
 * answers with reaches `POST /api/profile/avatar`.
 *
 * That order is the feature. The client cannot mint the URL an avatar is served
 * from - the server does, from the file id - so a client that skipped the second
 * call would have uploaded an object nothing points at, and one that sent the file
 * to the profile route would be asking a column write to parse multipart.
 */
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

interface Call {
  readonly path: string;
  readonly body: unknown;
}

const stub = (routes: Record<string, () => Response>): { calls: Call[] } => {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const path = Object.keys(routes).find((key) => url.endsWith(key));
    calls.push({ path: path ?? url, body: init?.body });
    if (path === undefined) return Promise.resolve(json(404, {}));
    return Promise.resolve(routes[path]!());
  }) as typeof fetch;
  return { calls };
};

const PICTURE = '/api/profile/avatar/f1c2b3a4-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('uploadAvatar', () => {
  test('uploads the file, then wears what came back', async () => {
    const { calls } = stub({
      '/api/files': () =>
        json(201, { id: 'f1c2b3a4-5d6e-4f70-8a9b-0c1d2e3f4a5b' }),
      '/api/profile/avatar': () => json(200, { picture: PICTURE }),
    });

    const updated = await uploadAvatar(
      new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' }),
    );

    expect(updated.picture).toBe(PICTURE);
    expect(calls.map((call) => call.path)).toEqual([
      '/api/files',
      '/api/profile/avatar',
    ]);
    // `FormData`, so the browser writes the multipart boundary itself. A JSON
    // body here is a 400 from the upload schema.
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    expect(calls[1]?.body).toBe(
      JSON.stringify({ fileId: 'f1c2b3a4-5d6e-4f70-8a9b-0c1d2e3f4a5b' }),
    );
  });

  test('a refused upload never reaches the profile route', async () => {
    const { calls } = stub({
      '/api/files': () => json(413, { message: 'File is too large' }),
      '/api/profile/avatar': () => json(200, { picture: PICTURE }),
    });

    await expect(
      uploadAvatar(new File(['x'], 'huge.png', { type: 'image/png' })),
    ).rejects.toThrow('File is too large');
    expect(calls.map((call) => call.path)).toEqual(['/api/files']);
  });
});

describe('chooseAvatar', () => {
  test('sends a URL as it is', async () => {
    const url = 'https://cdn.betterttv.net/emote/abc/3x';
    const { calls } = stub({
      '/api/profile/avatar': () => json(200, { picture: url }),
    });

    expect((await chooseAvatar({ url })).picture).toBe(url);
    expect(calls[0]?.body).toBe(JSON.stringify({ url }));
  });

  test('a refusal surfaces the server’s own words', async () => {
    stub({
      '/api/profile/avatar': () =>
        json(403, { message: 'That file belongs to somebody else' }),
    });

    await expect(chooseAvatar({ fileId: 'nope' })).rejects.toThrow(
      'That file belongs to somebody else',
    );
  });
});
