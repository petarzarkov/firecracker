import { Logger } from '@dunx/core';
import { Storage } from '@dunx/infra/files';
import { JobHandler } from '@dunx/infra/queue';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  JOBS,
  QUEUES,
  type FileThumbnailJob,
} from '../../notifications/events/events.js';
import { FilesRepository } from '../repos/files.repository.js';
import { ThumbnailsService } from '../services/thumbnails.service.js';

export interface ThumbnailResult {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /** `false` when the file was deleted while this rendered - see {@link MediaJobs}. */
  readonly recorded: boolean;
}

/**
 * Decode the original, resize, re-encode as WebP, write it back beside the source.
 * It injects the same `ThumbnailsService` and `Storage` the HTTP routes use, which
 * is the point of a job handler being an ordinary provider.
 */
export class MediaJobs {
  constructor(
    private readonly storage: Storage,
    private readonly thumbnails: ThumbnailsService,
    private readonly repo: FilesRepository,
    private readonly logger: Logger,
  ) {}

  @JobHandler({
    queue: QUEUES.MEDIA,
    background: true,
    name: JOBS.FILE_THUMBNAIL,
  })
  async thumbnail(job: Job<FileThumbnailJob>): Promise<ThumbnailResult> {
    const { fileId, key, width } = job.data;

    const source = await this.#read(key, fileId);
    const encoded = await this.thumbnails.render(source, width);
    const thumbnailKey = `${key}.thumb.webp`;

    await this.storage.write(thumbnailKey, encoded.bytes);
    // The row can be **gone by the time this lands** - a player replacing an avatar
    // a second after uploading it deletes the thumbnail the row knows about, and
    // this one is not on the row yet. `undefined` is no such row.
    const recorded = this.repo.update(fileId, { thumbnailKey }) !== undefined;
    if (!recorded) await this.storage.delete(thumbnailKey);

    const result: ThumbnailResult = {
      key: thumbnailKey,
      width: encoded.width,
      height: encoded.height,
      bytes: encoded.bytes.byteLength,
      recorded,
    };
    this.logger.debug(
      recorded ? 'thumbnail rendered' : 'thumbnail discarded, its file is gone',
      { fileId, ...result },
    );
    return result;
  }

  /**
   * A source that is not there is **permanent**, so `UnrecoverableError` fails it
   * once. The default `attempts` is for a slow disk or a bucket that blinked, not a
   * deleted key - and a sandboxed handler reports in the child and again in the
   * parent, so retrying logged the same conclusion six times.
   */
  async #read(key: string, fileId: string): Promise<Uint8Array> {
    try {
      return await this.storage.readBytes(key);
    } catch (error) {
      if (!MediaJobs.#isMissing(error)) throw error;
      this.logger.warn('thumbnail source is gone, not retrying', {
        fileId,
        key,
      });
      throw new UnrecoverableError(`thumbnail source missing: ${key}`);
    }
  }

  /**
   * By `name`, **not `instanceof`**: each `@dunx/infra` subpath is its own bundle,
   * so the `FileNotFoundError` thrown inside the backend is a different class object
   * than the exported one and `instanceof` is false against a genuine match.
   */
  static #isMissing(error: unknown): boolean {
    return error instanceof Error && error.name === 'FileNotFoundError';
  }
}
