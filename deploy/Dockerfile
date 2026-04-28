# Multi-stage Dockerfile for t-server (SPEC.md §7).
#
# Stage 1 ("deps"): full bun image, install production dependencies.
# Stage 2 ("runtime"): oven/bun:1-alpine, copy source + production
# node_modules, run as non-root, expose 8080.
#
# Bundling is intentionally avoided: pino's worker threads, native
# tty/sonic-boom shims, and bun:sqlite resolution all play poorly with
# `bun build --target=bun`. Bun runs TypeScript directly, so shipping
# source + production deps is simpler and equally fast.

FROM oven/bun:1 AS deps
WORKDIR /src

COPY package.json bunfig.toml ./
COPY bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Non-root user; writable /data for the SQLite database.
RUN addgroup -S t && adduser -S -G t -h /app t \
 && mkdir -p /data \
 && chown -R t:t /app /data

COPY --from=deps --chown=t:t /src/node_modules /app/node_modules
COPY --from=deps --chown=t:t /src/package.json /app/package.json
COPY --chown=t:t tsconfig.json /app/tsconfig.json
COPY --chown=t:t src /app/src

USER t

ENV T_SERVER_PORT=8080
ENV T_SERVER_DB=/data/t.db
EXPOSE 8080
VOLUME ["/data"]

# T_SERVER_TOKEN must be supplied at runtime — the server refuses to
# start without it (see src/server/main.ts).
CMD ["bun", "run", "src/server/main.ts"]
