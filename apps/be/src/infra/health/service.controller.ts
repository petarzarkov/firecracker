import { Controller, Get, Public } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { AppConfigService } from '../../config/app.config.service.js';
import { SERVICE_ROUTES } from '../../constants.js';

/**
 * Which build is this - the commit an incident is being debugged against - and
 * which sign-in providers it can actually complete.
 *
 * The probes are `@dunx/http`'s `/health/ready` and `/health/live`. This route exists
 * because no framework can know a commit sha.
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
    const auth = this.config.get('auth');
    return {
      name: app.name,
      version: app.version,
      env: app.env,
      commitSha: service.commitSha ?? null,
      commitMessage: service.commitMessage ?? null,
      tz: app.timezone,
      /**
       * The social providers this deployment can actually complete, so the client
       * renders the buttons that work rather than a fixed list.
       *
       * It shipped hardcoded to GitHub and LinkedIn, which was wrong in both
       * directions: Google is supported here and had no button, and an operator who
       * configures only Google still got two buttons that fail at the callback. A
       * provider is absent unless both halves of its credentials are set - see
       * `EnvConfig`.
       */
      authProviders: (['google', 'github', 'linkedin'] as const).filter(
        (name) => auth[name] !== undefined,
      ),
      uptimeSeconds: process.uptime(),
      versions: { bun: Bun.version, node: process.versions.node },
    };
  }
}
