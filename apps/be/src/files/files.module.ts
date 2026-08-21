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
 * **`global: true`.** An avatar is an uploaded object, so `ProfileModule` writes
 * one through `FilesService` rather than reaching past it to `Storage`. Global
 * rather than imported there because `forRoot()` returns a new object per call and
 * this one is already called twice - once per graph - so a third call would be a
 * second scope with a second `FilesController` on the same paths.
 *
 * **The exports are `FilesService` and what it is built from**, which is not
 * belt-and-braces: dunx resolves a provider's constructor arguments in the scope
 * that *asked* for it, not in the one that declared it. Export the service alone
 * and whichever module happens to be constructed first decides whether it works -
 * `ProfileModule` is ordered ahead of this one in `AppModule`, and it fails at boot
 * naming `FilesRepository`. Everything else `FilesService` takes - `Storage`,
 * `Images`, `JobPublisher`, config and the logger - is already global.
 *
 * `MediaJobs` is here rather than in a worker-only module, because the worker
 * imports this same module and that is where its handler is discovered. It is not
 * exported: a handler is reached by the queue, never by a caller.
 */
export class FilesFeatureModule {
  static forRoot(options: FilesModuleOptions = {}): DynamicModule {
    return {
      module: FilesFeatureModule,
      global: true,
      providers: [FilesService, FilesRepository, ThumbnailsService, MediaJobs],
      exports: [FilesService, FilesRepository, ThumbnailsService],
      ...(options.controllers === false
        ? {}
        : { controllers: [FilesController] }),
    };
  }
}
