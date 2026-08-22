import { Auth } from '@dunx/auth';
import { Logger } from '@dunx/core';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type { AvatarUpdated } from '@firecracker/contracts';
import { AppConfigService } from '../../config/app.config.service.js';
import { FilesService } from '../../files/services/files.service.js';
import { UsersRepository } from '../../users/repos/users.repository.js';
import type { AvatarSource } from '../dto/profile.dto.js';
import { CurrentUser } from './current-user.service.js';

/**
 * How long a browser may hold an avatar. Not `immutable`, even though the file id
 * in the URL never points at different bytes twice over: the thumbnail lands a
 * moment *after* the upload, from another process, and until it does this route
 * answers with the original. Five minutes is how long a client may keep the larger
 * of the two.
 */
const CACHE_SECONDS = 300;

/** The `media` job encodes WebP and nothing else - see `ThumbnailsService.render`. */
const THUMBNAIL_TYPE = 'image/webp';

/**
 * The caller's profile picture: choosing one, and serving one.
 *
 * `users.image` is the field the rest of the app already reads - the socket sends
 * it as `picture` on `connected` and on every chat line - so an uploaded avatar has
 * to end up in that column rather than beside it. What goes in is a URL back to
 * this service, and the object itself stays in `Storage`.
 *
 * The write goes through **better-auth's own `updateUser`** rather than
 * `UsersRepository.update`, and the `set-cookie` it answers with is forwarded.
 * `cookieCache` is enabled with a five-minute window, so a column written behind
 * better-auth's back leaves the browser holding a session that still names the old
 * picture - and the socket rewrites the client's store from that session on every
 * connect, which would put the old avatar back a moment after the new one was
 * chosen.
 */
export class ProfilePictureService {
  readonly #base: string;

  constructor(
    private readonly auth: Auth,
    private readonly caller: CurrentUser,
    private readonly files: FilesService,
    private readonly users: UsersRepository,
    private readonly logger: Logger,
    config: AppConfigService,
  ) {
    this.#base = `/${config.get('app').prefix}/profile/avatar/`;
  }

  /**
   * Sets the caller's avatar, and returns the response - a `Response` rather than
   * an object because better-auth's refreshed session cookie has to ride back with
   * it.
   */
  async set(headers: Headers, source: AvatarSource): Promise<Response> {
    const caller = this.caller.require();
    const picture =
      'fileId' in source
        ? this.#ownedImage(caller.id, source.fileId)
        : source.url;
    const previous = this.users.findById(caller.id)?.image ?? null;

    const updated = await this.auth.api.updateUser({
      body: { image: picture },
      headers,
      asResponse: true,
    });
    if (!updated.ok) {
      throw new HttpError(
        HttpStatusCode.BAD_GATEWAY,
        `The avatar could not be saved: ${await updated.text()}`,
      );
    }

    // Only once the new one is in the column. The other order loses the picture
    // the caller still has if the write fails.
    await this.#discard(previous, caller.id);

    this.logger.debug('avatar changed', { userId: caller.id });
    // Typed as the client's own interface, because nothing validates a `Response`
    // on the way out - see `setAvatar`'s `response` schema.
    const body: AvatarUpdated = { picture };
    return ProfilePictureService.#answer(body, updated.headers);
  }

  /**
   * The bytes, for anybody - the lobby's chat carries a sender's avatar, and a
   * spectator reads the chat.
   *
   * Public, but not a public read of arbitrary storage: an object is served here
   * **exactly while its owner has it set as their avatar**, which is the moment
   * they made it public and the only thing this route may infer from an id. That
   * is why it reads the owner's row rather than trusting the `avatars` prefix in
   * the key, which is grouping and has never been a permission.
   */
  async bytes(fileId: string): Promise<Response> {
    const row = this.files.find(fileId);
    const owner =
      row === undefined ? undefined : this.users.findById(row.userId);
    if (row === undefined || owner?.image !== this.#url(fileId)) {
      throw new HttpError(
        HttpStatusCode.NOT_FOUND,
        `No avatar with id ${fileId}`,
      );
    }

    const thumbnail = row.thumbnailKey;
    return new Response(await this.files.stream(thumbnail ?? row.key), {
      headers: {
        'content-type': thumbnail === null ? row.mimeType : THUMBNAIL_TYPE,
        'cache-control': `public, max-age=${CACHE_SECONDS}`,
      },
    });
  }

  /** JSON, plus whatever better-auth wants set on the caller's cookie jar. */
  static #answer(body: object, from: Headers): Response {
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const cookie of from.getSetCookie())
      headers.append('set-cookie', cookie);
    return new Response(JSON.stringify(body), { headers });
  }

  #url(fileId: string): string {
    return `${this.#base}${fileId}`;
  }

  /** The file id in one of this service's own URLs, if that is what it is. */
  #idIn(image: string | null): string | undefined {
    if (image === null || !image.startsWith(this.#base)) return undefined;
    const id = image.slice(this.#base.length);
    return id.length === 0 ? undefined : id;
  }

  #ownedImage(userId: string, fileId: string): string {
    const row = this.files.row(fileId);
    // The id came from the client, so this is the whole of the ownership check:
    // a file is only an avatar for the account that uploaded it.
    if (row.userId !== userId) {
      throw new HttpError(
        HttpStatusCode.FORBIDDEN,
        'That file belongs to somebody else',
      );
    }
    // `width` is written on upload, and only when `Bun.Image` could decode the
    // bytes - so a PDF is refused here without decoding anything a second time.
    if (row.width === null) {
      throw new HttpError(
        HttpStatusCode.UNSUPPORTED_MEDIA_TYPE,
        'An avatar has to be an image this service can decode',
      );
    }
    return this.#url(row.id);
  }

  /**
   * A replaced avatar takes its object with it: the row, the bytes and the
   * thumbnail are deleted, and `FilesService.remove` is what records it. Keeping
   * them would grow storage by one image per change with nothing that ever reads
   * them again - the URL is gone from the only column that named it.
   *
   * A URL this service did not mint - a BetterTTV emote, or the custom-URL field -
   * owns no object, so there is nothing to delete.
   */
  async #discard(previous: string | null, userId: string): Promise<void> {
    const fileId = this.#idIn(previous);
    if (fileId === undefined) return;

    const row = this.files.find(fileId);
    if (row === undefined || row.userId !== userId) return;

    try {
      await this.files.remove(fileId);
    } catch (error) {
      // The avatar has already changed. A store that will not delete is a leaked
      // object, not a failed request.
      this.logger.warn('the replaced avatar could not be deleted', {
        userId,
        fileId,
        reason: (error as Error).message,
      });
    }
  }
}
