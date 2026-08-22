# syntax=docker/dockerfile:1

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

# The base image ships a non-root `bun` user; nothing here needs to write to the filesystem.
USER bun
EXPOSE 3000

CMD ["bun", "serve.ts"]
