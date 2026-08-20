import type { DynamicModule } from '@dunx/core';
import { FilesController } from './files.controller.js';
import { MediaJobs } from './handlers/media.jobs.js';
import { FilesRepository } from './repos/files.repository.js';
import { FilesService } from './services/files.service.js';
import { ThumbnailsService } from './services/thumbnails.service.js';

export interface FilesModuleOptions {
  /**
   * `false` in the worker. A controller is a provider like any other, so it would
   * be constructed there too - and `FilesController` injects `CurrentUser`, whose
   * `AuthContext` only exists in a process that mounted `AuthModule`.
   */
  readonly controllers?: boolean;
}

/**
 * `Storage`, `Images` and `JobPublisher` come from `StorageModule`,
 * `ImagesConfigModule` and `QueuesModule`, which are `global: true` - one of each
 * per process, built by `foundation()`, so there is nothing to import.
 *
 * `CurrentUser` comes from the `global: true` `AccountsModule`, which is in the
 * serving graph and deliberately not in a job child's - so the `controllers: false`
 * branch is still what keeps better-auth out of the worker: `FilesController` is the
 * only thing here that reads a caller, and it is not built there.
 *
 * Nothing is exported. Uploads are reached over HTTP or through the queue, never
 * by another module calling `FilesService`.
 *
 * `MediaJobs` is here rather than in a worker-only module, because the worker
 * imports this same module and that is where its handler is discovered.
 */
export class FilesFeatureModule {
  static forRoot(options: FilesModuleOptions = {}): DynamicModule {
    return {
      module: FilesFeatureModule,
      providers: [FilesService, FilesRepository, ThumbnailsService, MediaJobs],
      ...(options.controllers === false
        ? {}
        : { controllers: [FilesController] }),
    };
  }
}
