import { HttpFactory } from '@dunx/http';
import { AppModule } from './app.module.js';
import { DocsModule } from './http/docs.module.js';
import { BootBanner } from './infra/boot/boot.service.js';
import { AppConfigService } from './config/app.config.service.js';

/**
 * Create, listen, wait. Everything else is a module: the prefix, CORS, the
 * middleware chain and `trust proxy` are `AppHttpOptions`', the documentation is
 * `DocsModule`'s, and the boot warnings are a provider's `onInit`.
 *
 * `enableShutdownHooks` stays here rather than moving into the graph, because it
 * installs process signal handlers and a spec resolving the same providers must
 * not get them.
 */
const main = async (): Promise<void> => {
  const app = await HttpFactory.create(DocsModule.around(AppModule.forRoot()));

  // Readiness fails and keeps failing for `HEALTH_DRAIN_DELAY_MS`, then the
  // server stops accepting, then providers tear down in reverse - queue workers
  // before the connections they use.
  app.enableShutdownHooks();

  const url = await app.listen(app.get(AppConfigService).get('app').port);
  app.get(BootBanner).announce(app, url);

  await app.closed;
};

// `.catch` rather than a top-level `await`, for the exit code: a boot that throws
// must be a failed process, or an orchestrator sees a container that exited 0 and
// stops restarting it. `console.error` because there may be no logger yet.
main().catch((error: unknown) => {
  console.error('[firecracker] boot failed', error);
  process.exit(1);
});
