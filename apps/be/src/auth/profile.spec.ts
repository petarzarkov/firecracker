import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import type { AvatarUpdated, UploadedFile } from '@firecracker/contracts';
import type { Job } from 'bullmq';
import { AppModule } from '../app.module.js';
import { MediaJobs } from '../files/handlers/media.jobs.js';
import type { FileThumbnailJob } from '../notifications/events/events.js';
import {
  dropTestNamespaces,
  testNamespace,
} from '../test-support/namespace.js';
import { TestSession } from '../test-support/session.js';

/**
 * The avatar, end to end over the real `LocalStorage` backend: upload an image
 * through the files route, make it the caller's, and read it back the way a
 * browser does.
 *
 * The thumbnail job is called directly here, as it is in `files.spec.ts` - that it
 * also runs in a **forked child** is `queues.spec.ts`'s subject, because that is
 * the only suite that consumes.
 */
let server: TestServer;
let root: string;
let player: { token: string; userId: string };
let other: { token: string; userId: string };

/** A real 4x4 PNG, so `Bun.Image` has something to decode. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

const pngBytes = (): Uint8Array =>
  Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));

const upload = async (
  token: string,
  file = new File([pngBytes()], 'me.png', { type: 'image/png' }),
) =>
  server.json<UploadedFile>('api/files', {
    method: 'POST',
    headers: TestSession.bearer(token),
    body: (() => {
      const form = new FormData();
      form.set('file', file);
      form.set('context', 'avatars');
      return form;
    })(),
  });

const choose = (token: string, source: object) =>
  server.json<AvatarUpdated>('api/profile/avatar', {
    method: 'POST',
    headers: TestSession.bearer(token),
    json: source,
  });

/** Upload and choose in one go, which is what the client's two calls are. */
const setUploadedAvatar = async (token: string) => {
  const uploaded = await upload(token);
  expect(uploaded.status).toBe(201);
  const chosen = await choose(token, { fileId: uploaded.body.id });
  expect(chosen.status).toBe(200);
  return { fileId: uploaded.body.id, picture: chosen.body.picture };
};

/** better-auth's own view of the caller, which is what the socket reads too. */
const sessionImage = async (token: string): Promise<string | null> => {
  const { body } = await server.json<{ user: { image: string | null } }>(
    'api/auth/get-session',
    { headers: TestSession.bearer(token) },
  );
  return body.user.image;
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'firecracker-avatars-'));
  const source = {
    API_PORT: '0',
    SQLITE_DB_PATH: ':memory:',
    // Off: this graph includes the engine, which enqueues the first round at
    // `onInit`, so a consuming test server would start the clock under the assertions.
    QUEUE_CONSUME: 'false',
    STORAGE_LOCAL_ROOT: root,
    THROTTLE_LIMIT: '10000',
    ...testNamespace(),
    UPLOAD_MAX_BYTES: '4096',
  };

  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    requestLogging: false,
  });

  player = await TestSession.signUp(
    server,
    'player@example.com',
    'a-password-123',
  );
  other = await TestSession.signUp(
    server,
    'stranger@example.com',
    'a-password-123',
  );
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe('choosing an avatar', () => {
  test('an uploaded image becomes the caller’s, in the column everything reads', async () => {
    const { fileId, picture } = await setUploadedAvatar(player.token);

    expect(picture).toBe(`/api/profile/avatar/${fileId}`);
    // Through better-auth rather than beside it: the session is what the socket
    // resolves `picture` from on every connect.
    expect(await sessionImage(player.token)).toBe(picture);
  });

  test('a URL is a source too - the picker’s trending grid sends one', async () => {
    const url = 'https://cdn.betterttv.net/emote/5ada077451d4120ea3918426/3x';
    const { status, body } = await choose(other.token, { url });

    expect(status).toBe(200);
    expect(body.picture).toBe(url);
    expect(await sessionImage(other.token)).toBe(url);
  });

  test('a URL that is not http(s) is refused by the schema', async () => {
    const { status } = await choose(other.token, {
      url: 'javascript:alert(1)',
    });
    expect(status).toBe(400);
  });

  test('a caller cannot wear somebody else’s file', async () => {
    const theirs = await upload(other.token);
    expect(theirs.status).toBe(201);

    const { status } = await choose(player.token, { fileId: theirs.body.id });
    expect(status).toBe(403);
    // And the refusal did not change anything.
    expect(await sessionImage(player.token)).toStartWith(
      '/api/profile/avatar/',
    );
  });

  test('a file that is not an image cannot be one', async () => {
    const csv = new File(['a,b\n1,2\n'], 'notes.csv', { type: 'text/csv' });
    const uploaded = await upload(player.token, csv);
    expect(uploaded.status).toBe(201);

    const { status } = await choose(player.token, {
      fileId: uploaded.body.id,
    });
    expect(status).toBe(415);
  });

  test('an unknown file is a 404', async () => {
    const { status } = await choose(player.token, {
      fileId: crypto.randomUUID(),
    });
    expect(status).toBe(404);
  });

  test('an anonymous caller has no avatar to set', async () => {
    const response = await server.request('api/profile/avatar', {
      method: 'POST',
      json: { url: 'https://example.com/a.png' },
    });
    expect(response.status).toBe(401);
  });

  /**
   * The bytes are bounded before any of this: an avatar is an upload, and the
   * upload route is where `UPLOAD_MAX_BYTES` lives.
   */
  test('an oversized image never becomes a file, let alone an avatar', async () => {
    const big = new File([new Uint8Array(8192)], 'huge.png', {
      type: 'image/png',
    });
    const { status } = await upload(player.token, big);
    expect(status).toBe(413);
  });
});

describe('serving one back', () => {
  test('anybody may read it, because anybody can see the player', async () => {
    const { picture } = await setUploadedAvatar(player.token);

    // No session at all - a spectator reads the lobby chat, and a chat line
    // carries its sender's avatar.
    const response = await server.request(picture.slice(1));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('max-age');
    expect([
      ...new Uint8Array(await response.arrayBuffer()).slice(0, 4),
    ]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  /**
   * The gate is the reference, not the key's prefix: an object is public exactly
   * while its owner has chosen it, so an upload nobody wears is nobody's business.
   */
  test('a file that is not anybody’s avatar is not served', async () => {
    const uploaded = await upload(other.token);
    const response = await server.request(
      `api/profile/avatar/${uploaded.body.id}`,
    );
    expect(response.status).toBe(404);
  });

  test('once the media job has run, the thumbnail is what goes out', async () => {
    const { fileId, picture } = await setUploadedAvatar(player.token);

    const media = server.app.get(MediaJobs);
    const key = (
      await server.json<UploadedFile>(`api/files/${fileId}`, {
        headers: TestSession.bearer(player.token),
      })
    ).body.key;
    await media.thumbnail({
      data: { fileId, key, width: 4 },
    } as Job<FileThumbnailJob>);

    const response = await server.request(picture.slice(1));
    expect(response.status).toBe(200);
    // The WebP the child rendered, not the PNG the player uploaded.
    expect(response.headers.get('content-type')).toBe('image/webp');
  });
});

describe('replacing one', () => {
  test('the object it replaced is deleted, not left behind', async () => {
    const first = await setUploadedAvatar(player.token);
    const second = await setUploadedAvatar(player.token);
    expect(second.fileId).not.toBe(first.fileId);

    // The row is gone, so the bytes and the thumbnail beside them are too.
    const row = await server.json(`api/files/${first.fileId}`, {
      headers: TestSession.bearer(player.token),
    });
    expect(row.status).toBe(404);

    const served = await server.request(first.picture.slice(1));
    expect(served.status).toBe(404);
    expect(await sessionImage(player.token)).toBe(second.picture);
  });

  test('choosing a URL discards the uploaded one as well', async () => {
    const uploaded = await setUploadedAvatar(player.token);
    const { status } = await choose(player.token, {
      url: 'https://cdn.betterttv.net/emote/5ada077451d4120ea3918426/3x',
    });
    expect(status).toBe(200);

    const row = await server.json(`api/files/${uploaded.fileId}`, {
      headers: TestSession.bearer(player.token),
    });
    expect(row.status).toBe(404);
  });
});

// Registered last, so it runs after the server has closed - see `files.spec.ts`.
afterAll(async () => {
  await dropTestNamespaces();
});
