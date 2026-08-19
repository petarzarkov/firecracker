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
FROM oven/bun:1.3.14-slim AS client
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/fe/package.json ./apps/fe/
RUN bun install --frozen-lockfile --filter 'firecracker-fe'
COPY apps/fe ./apps/fe
RUN bun run --filter 'firecracker-fe' build

# ── Server dependencies ──────────────────────────────────────────────────────
FROM oven/bun:1.3.14-slim AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/be/package.json ./apps/be/
RUN bun install --frozen-lockfile --production --filter 'firecracker-be'

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM oven/bun:1.3.14-slim AS runtime
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
COPY apps/be/package.json ./apps/be/
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
