import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Module } from '@dunx/core';
import {
  FilesModule,
  LocalStorageOptions,
  S3StorageOptions,
  type StorageOptions,
} from '@dunx/infra/files';
import { AppConfigService } from '../../config/app.config.service.js';
import { StorageDriver } from '../../config/dto/storage-vars.dto.js';

/** Hoisted, so the decorator below can both import and re-export one reference. */
const files = FilesModule.forRootAsync({
  useFactory: async (config: AppConfigService): Promise<StorageOptions> => {
    const storage = config.get('storage');

    if (storage.driver === StorageDriver.S3) {
      return new S3StorageOptions(
        {
          ...(storage.bucket === undefined ? {} : { bucket: storage.bucket }),
          ...(storage.region === undefined ? {} : { region: storage.region }),
          ...(storage.endpoint === undefined
            ? {}
            : { endpoint: storage.endpoint }),
          ...(storage.accessKeyId === undefined
            ? {}
            : { accessKeyId: storage.accessKeyId }),
          ...(storage.secretAccessKey === undefined
            ? {}
            : { secretAccessKey: storage.secretAccessKey }),
        },
        storage.prefix,
      );
    }

    const root = resolve(storage.localRoot);
    await mkdir(root, { recursive: true });
    return new LocalStorageOptions(root);
  },
  inject: [AppConfigService] as const,
});

/**
 * Backend selection is one `StorageOptions` subclass, not a branch in the app:
 * `FilesModule` binds `Storage` by asking the options object to `create()` it, so
 * every consumer injects the abstract `Storage` and swapping a directory for a
 * bucket is this factory and nothing else.
 *
 * `forRootAsync` because the local root has to exist before `LocalStorageOptions`
 * names it, and creating it is async - which is why the inner module is configured
 * while this one, which had nothing left to vary, is decorated.
 *
 * S3 credentials are deliberately incomplete here: anything omitted falls through
 * to Bun's own resolution (`S3_BUCKET`/`AWS_BUCKET`, `AWS_ACCESS_KEY_ID`, ...),
 * because `Bun.S3Client` already does that and restating it would be a second,
 * staler copy.
 *
 * `global: true` and a re-export, as every infra module here is: `Storage` is read
 * by the files feature, and there is one of it.
 */
@Module({ global: true, imports: [files], exports: [files] })
export class StorageModule {}
