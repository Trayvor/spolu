# syntax=docker/dockerfile:1
# Production image: build the server and web, then ship only server production dependencies.
ARG NODE_IMAGE=node:24-bookworm-slim

# Stage 1: download dependencies. Only the lockfile and manifests are copied, so this layer is cached until they change.
FROM ${NODE_IMAGE} AS deps
RUN npm install -g pnpm@12.11.2
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm fetch

# Stage 2: install, build, and extract the server with production dependencies only.
FROM deps AS build
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm -r build
RUN pnpm --filter @spolu/server deploy --prod /out

# Stage 3: runtime.
FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    FILES_DIR=/data/files
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./server
COPY --from=build /repo/apps/web/dist ./web
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/main.js"]
