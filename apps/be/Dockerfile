# Monorepo-aware: the build context is the **workspace root**, not this directory,
# because the lockfile and the workspace declaration live there.
#
# Runs from source. `bun src/main.ts` is the shape dunx documents for deployment:
# Bun transpiles on the fly and `@dunx/transform/preload` records constructor
# parameter types at load time.
#
# That makes `@dunx/transform` a **runtime** dependency, not a build-time one, and
# makes the root `bunfig.toml` load-bearing in the image. Both are easy to lose to
# a `--production` install or an allowlist-shaped .dockerignore.
#
# It is also why the queue uses `isolation: 'process'`: a fork is a fresh Bun process
# that reads this `bunfig.toml`, where a worker thread enters through bullmq's prebuilt
# `main-worker.js` and the preload never matches a `.ts` file.

# ── The client, built once and served by the API ─────────────────────────────
FROM oven/bun:1.4.0-slim AS client
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
# Every workspace tsconfig extends this one, and vite reads the chain to configure
# esbuild - so without it the bundle fails on a tsconfig it cannot resolve, not on
# anything in the code.
COPY tsconfig.json ./
COPY apps/fe/package.json ./apps/fe/
# Both libs the client depends on, manifests first. `--filter` prunes the *install*,
# never the workspace graph: bun reads every workspace named in bun.lock and refuses
# a checkout where one a survivor depends on is missing on disk. Copying only
# apps/fe/package.json failed here with exactly that, so the image never built.
COPY libs/contracts/package.json ./libs/contracts/
COPY libs/stage/package.json ./libs/stage/
RUN bun install --frozen-lockfile --filter 'firecracker-fe'
# Sources after the install, so a code edit does not re-resolve the lockfile. Both
# libs export `./src/index.ts` with no build step, so vite compiles them from here.
COPY libs ./libs
COPY apps/fe ./apps/fe
# `build:dist`, not `build`: the latter is `tsc --noEmit && vite build`, and a
# typecheck has no business gating an image. `--filter` prunes the install, so the
# dev-only @types this workspace resolves locally are absent here and tsc failed on
# its own broken type graph - react-icons' JSX namespace, vite's ImportMeta - while
# `bun run typecheck` passes on all four workspaces. Types are CI's gate, not the
# deploy's; vite strips them without checking, so the bundle is identical.
RUN bun run --filter 'firecracker-fe' build:dist

# ── Server dependencies ──────────────────────────────────────────────────────
FROM oven/bun:1.4.0-slim AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/be/package.json ./apps/be/
# Same rule as the client stage. The server depends on contracts and not on stage,
# and bun only demands the workspaces its surviving filter actually reaches.
COPY libs/contracts/package.json ./libs/contracts/
RUN bun install --frozen-lockfile --production --filter 'firecracker-be'

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM oven/bun:1.4.0-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# `APP_ENV=prod` makes `BETTER_AUTH_SECRET` mandatory, so this image refuses to
# boot without one - the development fallback is a constant in the repository and
# anyone holding it can mint a session. Pass it with `-e BETTER_AUTH_SECRET=...`.
#
# `SQLITE_DB_PATH` points into /app/data, a volume in the compose file. A sandboxed job
# child opens the same file, so the WAL and busy-timeout pragmas in
# `database.module.ts` are still what make that safe.
ENV NODE_ENV=production \
    APP_ENV=prod \
    TZ=UTC \
    API_PORT=3001 \
    SQLITE_DB_PATH=/app/data/firecracker.db \
    CLIENT_DIST=/app/apps/fe/dist

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/be/node_modules ./apps/be/node_modules
COPY package.json bunfig.toml ./
# Bun transpiles from source at run time, so the tsconfig is a runtime input too:
# `apps/be/tsconfig.json` is what sets `jsx: react-jsx` for the four `.tsx` email
# templates. Leaving it out means depending on Bun's default matching it forever.
COPY tsconfig.json ./
COPY apps/be/package.json apps/be/tsconfig.json ./apps/be/
# `node_modules/@firecracker/contracts` is a symlink into here, so without this the
# server resolves the wire to a dangling link and dies on its first import - after a
# green build. It is source-only (`exports: ./src/index.ts`), so there is nothing
# to compile and nothing to copy from a build stage.
COPY libs/contracts ./libs/contracts
COPY apps/be/src ./apps/be/src
COPY apps/be/scripts ./apps/be/scripts
COPY --from=client /app/apps/fe/dist ./apps/fe/dist

RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun

ARG COMMIT_SHA
ARG COMMIT_MESSAGE
ENV SERVICE_COMMIT_SHA=$COMMIT_SHA \
    SERVICE_COMMIT_MESSAGE=$COMMIT_MESSAGE

EXPOSE 3001

# Readiness, not liveness: it probes the database, and a liveness probe that checks a
# dependency restarts the process when that dependency blinks. Only the database can
# fail this - Redis and the broker report `down` without gating it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT}/api/health/ready" || exit 1

WORKDIR /app/apps/be
CMD ["bun", "src/main.ts"]
