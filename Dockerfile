# syntax=docker/dockerfile:1

# --- dev: all dependencies, source bind-mounted by docker-compose.dev.yml, hot reload on.
FROM oven/bun:1.3-alpine AS dev
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["bun", "--hot", "serve.ts"]

# --- deps: runtime dependencies only, so the production image carries no toolchain.
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json serve.ts index.ts ./
COPY src ./src
COPY scripts ./scripts

# The base image ships a non-root `bun` user; nothing here needs to write to the filesystem.
USER bun
EXPOSE 3000

CMD ["bun", "serve.ts"]
