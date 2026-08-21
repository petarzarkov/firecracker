/**
 * Route segments are constants, not environment variables. A decorator argument
 * is evaluated at class-definition time, long before the container or the
 * validated config exists, so `@Controller(config.get(...))` is not expressible. An
 * environment variable for one would be a second source that the decorator ignores.
 */
export const SERVICE_ROUTES = Object.freeze({
  BASE: 'service',
  CONFIG: 'config',
} as const);

/**
 * Where `@dunx/http`'s `HealthController` mounts, relative to the global prefix.
 *
 * Restated rather than imported: its paths are literals in the package's own
 * decorators. The request log's ignore list and the boot banner read these.
 */
export const HEALTH_ROUTES = Object.freeze({
  BASE: 'health',
  LIVENESS: 'live',
  READINESS: 'ready',
} as const);

/**
 * Where `@dunx/auth`'s handler is mounted, relative to the global prefix, and the
 * websocket upgrade path. Both are route paths, so both are decided at
 * class-definition time and neither can come from the environment.
 */
export const WS_PATH = '/ws';
