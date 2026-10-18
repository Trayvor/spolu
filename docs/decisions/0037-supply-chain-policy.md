# 0037 Supply-chain policy: pnpm release age and trust, images by digest

Date: 2026-10-18
Status: accepted

## Context
The security review of 2026-10-18 (findings H2 and M5) found the supply chain was the real risk, not the app code:
- pnpm's guards were implicit: only `allowBuilds: esbuild` was set, and the release-age guard was pnpm 12's built-in default of one day. Runtime packages in the lockfile (nodemailer, pg-boss, fastify, zod) were 4 to 8 days old, and past npm worms were caught within hours to a few days.
- Every image was pulled by a mutable tag: `node:24-bookworm-slim`, `debian:bookworm-slim`, the third-party `mwader/static-ffmpeg:7.1.1` (a personal Docker Hub account; its binary runs inside the app container with the app's environment), and `postgres:17` and `caddy:2`, which `docker compose pull` fetched again on every deploy.

## Decision
- **pnpm** (`pnpm-workspace.yaml`, the keys of pnpm 12, our `packageManager`; none goes in `.npmrc`, which pnpm reads only for auth and registry):
  - `minimumReleaseAge: 10080`: a version must be 7 days old. pnpm checks frozen installs too, so the lockfile must comply. Urgent security patches go into `minimumReleaseAgeExclude` as `name@version`, each with a comment. When the policy came in, 104 lockfile entries were younger than 7 days; they are listed there as exact versions (grandfathered, reviewed that day, `pnpm audit --prod` clean), to be deleted on or after 2026-10-22. Re-resolving the whole lockfile to older versions was rejected: a large, untested change that every parallel branch would conflict with.
  - `trustPolicy: no-downgrade`: refuse a version published with weaker trust evidence than an earlier one (the pattern of a stolen token). Three existing entries are flagged by it (`semver@6.3.1`, `chokidar@4.0.3`, `@trickfilm400/rollup-plugin-off-main-thread@3.0.0-pre1`, the last a build-time dependency of workbox-build). Each was published by its usual maintainer without provenance after an earlier version had it, so they are in `trustPolicyExclude` as exact versions.
  - `blockExoticSubdeps: true` and `strictDepBuilds: true` (both pnpm 12 defaults, now explicit, so a pnpm upgrade cannot quietly turn them off).
  - The `Dockerfile` installs pnpm with `npm install -g --ignore-scripts`, builds with `pnpm install --frozen-lockfile` (scripts only for `allowBuilds`), and makes the production `node_modules` with `pnpm deploy --prod --frozen-lockfile --ignore-scripts`.
- **Images by digest**: every `FROM` (through the `NODE_IMAGE`, `RUNTIME_IMAGE` and `FFMPEG_IMAGE` arguments) and the `postgres` and `caddy` images in `deploy/docker-compose.yml` are written as `<image>:<exact version>@sha256:<index digest>`. The version is for people; Docker uses the digest. Bumping is a deliberate change on a branch (`docker buildx imagetools inspect`, see [deploy.md](../runbooks/deploy.md#image-digests)); an automated bot (Renovate) can do it later.
- **ffmpeg stays `mwader/static-ffmpeg`** ([ADR 0023](0023-ffmpeg-static-build-for-meeting-audio.md)), now pinned by digest at 7.1.1. It is a public, widely used build from source (github.com/wader/static-ffmpeg). Debian's package would add about 400 MB, and building ffmpeg ourselves is a project of its own. With the digest, a re-pushed or hijacked tag can no longer change our binary. Upgrading to 8.x (newer demuxer fixes) is a separate change that needs a real-ffmpeg run.

## Consequences
- A dependency published less than 7 days ago cannot be added without an explicit, commented exception; a branch that bumps a package may wait a few days.
- Builds and deploys are reproducible: the same commit gets the same base images and the same PostgreSQL and Caddy. Security fixes in those images arrive only when we bump the digests, so they are reviewed about monthly, together with the Node base.
- The grandfather list in `minimumReleaseAgeExclude` must be deleted after 2026-10-22, or it slowly becomes a list of exceptions nobody remembers.
- Not covered here: the CI machine also holds the deploy secrets (finding H1). That needs CI isolated from `~/.config/spolu` and the SSH key, and is still open.
