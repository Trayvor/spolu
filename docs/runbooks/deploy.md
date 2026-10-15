# Deploy

How a new version of Spolu gets to an environment. The only environment now is `test`.

> Task 18 finalizes this runbook after the first real deploy.

## How it works

All logic lives in `scripts/` ([ADR 0004](../decisions/0004-scripts-first-ci.md)); any CI system only prepares a runner, passes settings in as environment variables and calls:

1. `scripts/ci.sh` — every check: `pnpm install --frozen-lockfile`, shellcheck of `scripts/*.sh` and `deploy/backup/backup.sh`, `scripts/tests/*.test.sh`, the dev services from `docker-compose.dev.yml`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, Playwright Chromium + `pnpm test:e2e`, and `scripts/check-docs.sh "$CI_BASE_REF"` (default `origin/main`). No `.env` is needed. If the dev services were already running (your laptop) they are reused and left running; otherwise the script starts them and removes them on exit.
2. `scripts/build-image.sh <sha>` — `docker buildx build` for `linux/amd64,linux/arm64` with `APP_VERSION=<sha>`, pushed as `$IMAGE:<sha>`. The caller logs in to the registry first and provides a buildx builder with QEMU. Optional env: `EXTRA_TAG` also pushes `$IMAGE:$EXTRA_TAG` (the test deploy pushes `test`, so that tag always means "what test runs"); `BUILDX_CACHE=gha` uses the GitHub Actions layer cache (`mode=min`).
3. `scripts/deploy.sh <env> <sha>` — over SSH:
   - uploads `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/backup/` and the env file to `/opt/spolu/<env>/` (the env file becomes `.env`, mode 600, written with umask 077);
   - sets `IMAGE=` and `TAG=` in that `.env` to the deployed image, so a manual `docker compose up -d` on the server runs the same version;
   - logs in to the registry if `REGISTRY_TOKEN` is set (and logs out after the pull), then `docker compose pull`, `docker compose up -d --remove-orphans`, `docker image prune -f` (small disk);
   - polls `https://$DOMAIN/api/health` every 5 s for up to 120 s until `version` equals `<sha>`. On timeout it prints the last response, `docker compose ps` and the last 50 app log lines, and exits 1.

| deploy.sh variable | required | meaning |
|---|---|---|
| `DEPLOY_HOST` | yes | server hostname or IP |
| `DEPLOY_USER` | yes | SSH user, `deploy` (created by [server-setup.md](server-setup.md)) |
| `DEPLOY_SSH_KEY` | yes | path to that user's private key |
| `DEPLOY_ENV_FILE` | yes | path to the env file (template `deploy/test.env.example`) |
| `IMAGE` | yes | image repository, lowercase, e.g. `ghcr.io/trayvor/spolu` |
| `DOMAIN` | yes | public domain, for the health check |
| `DEPLOY_PORT` | no | SSH port, default 22 |
| `DEPLOY_KNOWN_HOSTS` | no | `known_hosts` line(s) of the server (`ssh-keyscan <host>`); pins its host key. Without it the key is trusted on first contact |
| `REGISTRY_USER`, `REGISTRY_TOKEN` | no | registry login on the server for a private image |

Secrets are never printed. The SSH settings use a per-run `known_hosts` file, never the runner's `~/.ssh`.

## Manual deploy from a laptop

Use it when CI is down, or to redeploy an older SHA (see [rollback.md](rollback.md)).

```bash
sha=$(git rev-parse HEAD)                     # must be pushed and built, or build it:
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
IMAGE=ghcr.io/trayvor/spolu scripts/build-image.sh "$sha"

DEPLOY_HOST=<host> DEPLOY_USER=deploy DEPLOY_SSH_KEY=~/.ssh/spolu_test \
DEPLOY_ENV_FILE=~/secrets/spolu-test.env DOMAIN=<test-domain> IMAGE=ghcr.io/trayvor/spolu \
REGISTRY_USER=<github-user> REGISTRY_TOKEN="$GHCR_TOKEN" \
scripts/deploy.sh test "$sha"
```

`GHCR_TOKEN` is a GitHub token with `write:packages` (build) or `read:packages` (deploy only).

## Prod-like run on your machine

```bash
docker build -t spolu:local --build-arg APP_VERSION=local .
cp deploy/test.env.example deploy/.env   # then set IMAGE=spolu, TAG=local, DOMAIN=localhost, PUBLIC_URL=https://localhost and real-looking secrets
cd deploy && docker compose --project-name spolutest up -d --wait
curl -k https://localhost/api/health      # {"status":"ok","db":"ok","version":"local"}
docker compose --project-name spolutest down -v   # separate project = separate volumes; removes them
```
