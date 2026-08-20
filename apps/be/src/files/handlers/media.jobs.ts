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
}

/**
 * The one job in this app that does real work: decode the original, resize it,
 * re-encode it as WebP and write it back beside the source.
 *
 * It injects the very same `ThumbnailsService` and `Storage` the HTTP routes use -
 * one wiring, two entrypoints - which is the point of a job handler being an
 * ordinary provider. The NestJS template's equivalent ran in a forked
 * `job.processor.ts` that bootstrapped a second `JobModule` by hand, because a Nest
 * worker has no container of its own.
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
    this.repo.update(fileId, { thumbnailKey });

    const result: ThumbnailResult = {
      key: thumbnailKey,
      width: encoded.width,
      height: encoded.height,
      bytes: encoded.bytes.byteLength,
    };
    this.logger.debug('thumbnail rendered', { fileId, ...result });
    return result;
  }

  /**
   * A source that is not there is **permanent**, so it fails once instead of three
   * times with exponential backoff between.
   *
   * `UnrecoverableError` is bullmq's way to say "do not retry this". The default
   * `attempts` is for a slow disk or a bucket that blinked, and neither describes a
   * key that was deleted - so retrying logged the same failure three times, twice
   * each because a sandboxed handler reports in the child and again in the parent, to
   * reach the conclusion the first attempt already had.
   *
   * The usual cause is an upload rolled back, or a file deleted between the enqueue
   * and the fork.
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
   * By `name`, **not `instanceof`**, and that is not a shortcut.
   *
   * Each `@dunx/infra` subpath is its own bundle, so the `FileNotFoundError` thrown
   * inside the storage backend is a different class object than the one
   * `@dunx/infra/files` exports - `instanceof` is false against a genuine match. The
   * package's own `StorageError` sets `name` from `new.target.name`, which survives
   * the boundary. `@dunx/infra`'s queue options file documents the same trap for
   * `RedisError`.
   */
  static #isMissing(error: unknown): boolean {
    return error instanceof Error && error.name === 'FileNotFoundError';
  }
}
