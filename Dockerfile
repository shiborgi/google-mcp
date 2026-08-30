FROM oven/bun:1.4.0-alpine AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.0-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json ./
COPY --chown=bun:bun src ./src

ARG SOURCE_REVISION=
ARG SOURCE_VERSION=
ARG SOURCE_REPOSITORY=

LABEL org.opencontainers.image.title=google-mcp
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
LABEL org.opencontainers.image.version=$SOURCE_VERSION
LABEL org.opencontainers.image.source=$SOURCE_REPOSITORY

USER bun
EXPOSE 8090
CMD ["bun", "run", "src/index.ts"]
