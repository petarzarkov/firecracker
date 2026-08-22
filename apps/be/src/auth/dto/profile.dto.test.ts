import { describe, expect, test } from 'bun:test';
import type {
  AvatarSource as AvatarSourceView,
  AvatarUpdated as AvatarUpdatedView,
  UploadedFile,
} from '@firecracker/contracts';
import type { FileMetadata } from '../../files/dto/file.dto.js';
import { AvatarSource, AvatarUpdated } from './profile.dto.js';

/**
 * The three shapes the avatar flow puts on the wire, each declared twice - as a
 * zod schema here, because that is what validates and what the OpenAPI document is
 * built from, and as an interface in `@firecracker/contracts`, because a browser
 * cannot import zod's. `game.dto.test.ts` explains why that is two declarations and
 * not one; this is the same guard over the second pair of them.
 *
 * `UploadedFile` is in the lib even though the client reads one field of it. The
 * client hands `id` straight back to `POST /api/profile/avatar`, and a partial copy
 * of a response is how a field comes to mean two things.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

type Mutual<A, B> =
  SameKeys<A, B> extends true
    ? A extends B
      ? B extends A
        ? true
        : false
      : false
    : false;

const uploadShapesAgree: Mutual<FileMetadata, UploadedFile> = true;
const updatedShapesAgree: Mutual<AvatarUpdated, AvatarUpdatedView> = true;

/**
 * A union has no common keys, so `Mutual` would pass on the key check alone -
 * assignability in both directions is what carries this one. A third member added
 * on either side fails it.
 */
const sourceShapesAgree: Mutual<AvatarSource, AvatarSourceView> = true;

describe('the avatar wire', () => {
  test('the schemas and the shared interfaces describe the same bodies', () => {
    expect([uploadShapesAgree, updatedShapesAgree, sourceShapesAgree]).toEqual([
      true,
      true,
      true,
    ]);
  });

  test('either source parses, on its own', () => {
    const fileId = '7f5f5c4c-7b0e-4a1a-9b0a-2b6c0f8e1d11';
    expect(AvatarSource.parse({ fileId })).toEqual({ fileId });

    const url = 'https://cdn.betterttv.net/emote/abc/3x';
    expect(AvatarSource.parse({ url })).toEqual({ url });
  });

  /**
   * `new URL()` - and so `z.url()` on its own - accepts `javascript:`, and this
   * string is handed to other players' browsers as an image source.
   */
  test('a non-http URL is refused', () => {
    expect(AvatarSource.safeParse({ url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });

  test('a body naming neither is refused', () => {
    expect(AvatarSource.safeParse({}).success).toBe(false);
  });
});
