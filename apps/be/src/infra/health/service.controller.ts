import { Controller, Get, Public } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { AppConfigService } from '../../config/app.config.service.js';
import { SERVICE_ROUTES } from '../../constants.js';

/**
 * Which build is this - the commit an incident is being debugged against.
 *
 * All that is left of a controller that served three routes. `/service/health` and
 * `/service/up` are `@dunx/http`'s `/health/ready` and `/health/live` now; this one
 * stayed because no framework can know a commit sha.
 */
@ApiDoc({
  tags: ['service'],
  description: 'Build and runtime information.',
})
@Controller(SERVICE_ROUTES.BASE)
export class ServiceController {
  constructor(private readonly config: AppConfigService) {}

  @ApiDoc({ tags: ['service'], summary: 'Build and runtime information' })
  @Public()
  @Get(`/${SERVICE_ROUTES.CONFIG}`)
  version(): Record<string, unknown> {
    const app = this.config.get('app');
    const service = this.config.get('service');
    return {
      name: app.name,
      version: app.version,
      env: app.env,
      commitSha: service.commitSha ?? null,
      commitMessage: service.commitMessage ?? null,
      tz: app.timezone,
      uptimeSeconds: process.uptime(),
      versions: { bun: Bun.version, node: process.versions.node },
    };
  }
}
