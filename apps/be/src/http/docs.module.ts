import { Auth, AuthOptions, betterAuthDocument } from '@dunx/auth';
import type { ModuleRef } from '@dunx/core';
import { OpenApiModule } from '@dunx/openapi';
import { SwaggerRenderer } from '@dunx/openapi/swagger';
import { AppConfigService } from '../config/app.config.service.js';

/**
 * The OpenAPI document, its page, and the auth endpoints route discovery cannot
 * see.
 *
 * `around` rather than an entry in `imports`: `OpenApiModule` **wraps** the root
 * it documents, so it is what `HttpFactory.create` is handed. That is the one
 * reason this is a function and not a `@Module`.
 */
export class DocsModule {
  static around(root: ModuleRef): ModuleRef {
    return OpenApiModule.forRootAsync({
      root,
      // Beside `root`, not in the factory: the controller declares its routes
      // before there is a container to run one. No renderer serves the JSON and
      // no page, so `swagger-ui-dist` is this app's dependency to declare.
      renderer: new SwaggerRenderer(),
      useFactory: (
        config: AppConfigService,
        auth: Auth,
        mount: AuthOptions,
      ) => {
        const { app: meta, docs } = config.values;
        return {
          title: meta.name,
          version: meta.version,
          description: meta.description,
          path: `/${docs.path}`,
          jsonPath: `/${docs.jsonPath}`,
          // better-auth serves every endpoint from one wildcard route, so
          // discovery sees none of them. Both halves are injected - the running
          // instance and the base path it normalized - so the document describes
          // the API that is mounted rather than one rebuilt from config.
          contribute: [betterAuthDocument(auth, { basePath: mount.basePath })],
        };
      },
      inject: [AppConfigService, Auth, AuthOptions] as const,
    });
  }
}
