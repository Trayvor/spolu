# syntax=docker/dockerfile:1
# Production image: build the server and web, then ship only the node binary, the server's
# production dependencies (without type definitions, source maps and docs) and the built code.
#
# Every base image is pinned by digest (ADR 0037): a tag can be pushed again, a digest cannot.
# The tag in front of the digest is only for people; Docker uses the digest. To bump one, run
# `docker buildx imagetools inspect <image>:<tag>` and copy the "Digest:" line (the index digest,
# which covers both arm64 and amd64); see docs/runbooks/deploy.md, "Image digests".
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
# The runtime base: the Debian release NODE_IMAGE is built on, without npm, corepack and yarn.
ARG RUNTIME_IMAGE=debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8
# A static ffmpeg build for meeting recordings (Phase 30, ADR 0023): one binary, no shared libs,
# instead of Debian's ffmpeg package through RUNTIME_PACKAGES (+406 MB). A third-party image
# (github.com/wader/static-ffmpeg), so it is pinned by digest like the others (ADR 0037).
ARG FFMPEG_IMAGE=mwader/static-ffmpeg:8.1.2@sha256:33f770f812cbfc3de96c547157fc9faf8bd95a36481753439ffa761045167585

FROM ${FFMPEG_IMAGE} AS ffmpeg

# Stage 1: download dependencies. pnpm is installed before the lockfile is copied, so a lockfile
# change does not reinstall it; `pnpm fetch` is cached until the lockfile changes.
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json ./
# pnpm version comes from "packageManager" in the root package.json. No install scripts: the pnpm
# package needs none.
RUN npm install -g --ignore-scripts "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm fetch

# Stage 2: the server's production dependencies. They need only the lockfile and the package
# manifests, so this stage stays cached while only source code changes.
FROM deps AS prod-deps
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Not offline: the deploy checks the lockfile's packages against pnpm's supply-chain policy
# (pnpm-workspace.yaml, ADR 0037), which reads registry metadata (kept in the second cache).
# Exactly the lockfile, and no install scripts: the server's production dependencies need none
# (esbuild, the only allowed build, is a build-time tool).
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.cache/pnpm \
    pnpm --filter @spolu/server deploy --prod --frozen-lockfile --ignore-scripts /out
# Files node never loads at runtime (about 40 MB): type definitions, source maps, docs.
RUN find /out/node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \
      -o -name '*.map' -o -iname '*.md' -o -iname '*.markdown' \) -delete

# Stage 3: install everything and build the server and web.
FROM deps AS build
COPY . .
# Install scripts run only for allowBuilds (esbuild); strictDepBuilds fails on any other one.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm -r build

# Stage 4: runtime. A plain Debian slim with only the node binary copied in.
# The same image also runs the media sandbox (ADR 0048): `node server/media-sandbox.js` in its own
# container. /run/media (its socket) and /work (its runs) belong to node, so the named volumes
# compose mounts there start out writable by that user.
FROM ${RUNTIME_IMAGE} AS runtime
# System packages the app needs at runtime go into this list. Empty today (ffmpeg comes as a
# static binary from the ffmpeg stage, see ADR 0023).
ARG RUNTIME_PACKAGES=""
RUN if [ -n "$RUNTIME_PACKAGES" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends $RUNTIME_PACKAGES \
      && rm -rf /var/lib/apt/lists/*; \
    fi \
    && groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --shell /bin/bash --create-home node \
    && mkdir -p /data/files /run/media /work && chown -R node:node /data /run/media /work
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    FILES_DIR=/data/files
WORKDIR /app
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=prod-deps /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./server
COPY --from=build /repo/apps/web/dist ./web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/main.js"]
