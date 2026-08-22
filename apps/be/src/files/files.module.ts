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
 * **`global: true`**, because `forRoot()` returns a new object per call and this one
 * is already called twice - once per graph - so importing it a third time would put
 * a second `FilesController` on the same paths.
 *
 * **The exports are `FilesService` and what it is built from**, not
 * belt-and-braces: dunx resolves a provider's constructor arguments in the scope
 * that *asked* for it, so exporting the service alone lets whichever module is
 * constructed first decide whether it works.
 *
 * `MediaJobs` is here because the worker imports this same module and that is where
 * its handler is discovered. It is not exported - a handler is reached by the queue.
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
