# Deploy

How a new version of Spolu gets to an environment. The only environment now is `test`.

> Task 18 finalizes this runbook after the first real deploy.

## How it works

All logic lives in `scripts/` ([ADR 0004](../decisions/0004-scripts-first-ci.md)); any CI system only prepares a runner, passes settings in as environment variables and calls:

1. `scripts/ci.sh` — every check: `pnpm install --frozen-lockfile`, shellcheck of `scripts/*.sh` and `deploy/backup/backup.sh`, `scripts/tests/*.test.sh`, the dev services from `docker-compose.dev.yml`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, Playwright Chromium + `pnpm test:e2e`, and `scripts/check-docs.sh "$CI_BASE_REF"` (default `origin/main`). No `.env` is needed. If the dev services were already running (your laptop) they are reused and left running; otherwise the script starts them and removes them on exit. `playwright install --with-deps` installs system packages, so the CI agent needs root or passwordless sudo (GitHub runners have it; a future Jenkins agent must too).
2. `scripts/build-image.sh <sha>` — `docker buildx build` for `linux/amd64,linux/arm64` with `APP_VERSION=<sha>`, pushed as `$IMAGE:<sha>`. The caller logs in to the registry first and provides a buildx builder with QEMU. Optional env: `EXTRA_TAG` also pushes `$IMAGE:$EXTRA_TAG` (the test deploy pushes `test`, so that tag always means "what test runs"); `BUILDX_CACHE=gha` uses the GitHub Actions layer cache (`mode=max`: build-stage layers are cached too, which speeds up the QEMU arm64 build; they hold no secrets since `.env` is in `.dockerignore`).
3. `scripts/deploy.sh <env> <sha>` — over SSH:
   - uploads `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/backup/` and the env file to `/opt/spolu/<env>/` (the env file becomes `.env`, mode 600, written with umask 077);
   - sets `IMAGE=` and `TAG=` in that `.env` to the deployed image, so a manual `docker compose up -d` on the server runs the same version;
   - logs in to the registry if `REGISTRY_TOKEN` is set (and logs out after the pull), then `docker compose pull`, `docker compose up -d --remove-orphans`, `docker image prune -af --filter until=168h` (removes unused images older than 7 days, old releases included, so the small disk does not fill; last week's images stay for a quick rollback);
   - polls `https://$DOMAIN/api/health` every 5 s for up to 120 s until `version` equals `<sha>`. On timeout it prints the last response, `docker compose ps` and the last 50 app log lines (the health body is shown even for a 503), the rollback command `scripts/deploy.sh <env> <previous tag>` (read from the server's `.env` before the deploy), and exits 1.

| deploy.sh variable | required | meaning |
|---|---|---|
| `DEPLOY_HOST` | yes | server hostname or IP |
| `DEPLOY_USER` | yes | SSH user, `deploy` (created by [server-setup.md](server-setup.md)) |
| `DEPLOY_SSH_KEY` | yes | path to that user's private key |
| `DEPLOY_ENV_FILE` | yes | path to the env file (template `deploy/test.env.example`) |
| `IMAGE` | yes | image repository, lowercase, e.g. `ghcr.io/trayvor/spolu` |
| `DOMAIN` | yes | public domain, for the health check |
| `DEPLOY_PORT` | no | SSH port, default 22 |
| `DEPLOY_KNOWN_HOSTS` | no | `known_hosts` line(s) of the server (`ssh-keyscan <host>`); pins its host key. Recommended: without it there is no host verification (a warning is printed) |
| `REGISTRY_USER`, `REGISTRY_TOKEN` | no | registry login on the server for a private image |

Secrets are never printed. The SSH settings use a per-run `known_hosts` file, never the runner's `~/.ssh`.

## Superadmin settings

The env file sets `SUPERADMIN_EMAIL` and optionally `SUPERADMIN_NAME` (default: the part of the email before `@`). On every start the app makes sure that user exists, is a superadmin and is active. Changing `SUPERADMIN_EMAIL` **adds** a second superadmin and keeps the old one; the old superadmin is not demoted. To retire the old account, remove it by hand in the database (`update "user" set role = 'admin'` first, then remove it on the Admins page). Both accounts log in by email code, so `MAIL_FROM` must be verified in Elastic Email before the first login on a server.

## GitHub Actions

The workflows in `.github/workflows/` only check out, set up tools, pass settings and call the scripts. Actions are pinned to major versions, except `crazy-max/ghaction-github-runtime` (third party, exposes the cache token to `docker buildx`), which is pinned to a commit SHA.

- `ci.yml` — on every pull request: Node 24, pnpm (version from `packageManager`), then `scripts/ci.sh` with `CI_BASE_REF=origin/<base branch>`.
- `deploy-test.yml` — on every push to `main`, or by hand (**Actions → Deploy test → Run workflow**, optional `ref` = branch, tag or SHA, so a branch can be tried on test before merge). Job `ci` runs `scripts/ci.sh` on that ref; job `deploy` (needs `ci`, GitHub environment `test`) sets up QEMU and buildx, logs in to `ghcr.io` with `GITHUB_TOKEN`, runs `scripts/build-image.sh <sha>` (`EXTRA_TAG=test`, `BUILDX_CACHE=gha`), writes the secrets to files with umask 077 and runs `scripts/deploy.sh test <sha>`. `<sha>` is `git rev-parse HEAD` of the `ci` job's checkout, passed as a job output; `deploy` checks out exactly that SHA, so the deployed commit is the tested one, also for a manual run with a `ref`. Concurrency group `deploy-test`: deploys queue, never cancel each other.

Settings of the GitHub environment `test` (**Settings → Environments → test**):

| kind | name | value |
|---|---|---|
| secret | `TEST_SSH_KEY` | private key of the `deploy` user (from [server-setup.md](server-setup.md)) |
| secret | `TEST_ENV_FILE` | full content of the server env file, filled from `deploy/test.env.example` |
| variable | `DEPLOY_HOST` | server hostname or IP |
| variable | `DEPLOY_USER` | `deploy` |
| variable | `DOMAIN` | test domain, same as `DOMAIN` in the env file |
| variable | `IMAGE` | `ghcr.io/trayvor/spolu` (lowercase) |
| variable | `DEPLOY_KNOWN_HOSTS` | recommended, output of `ssh-keyscan <host>`; without it the host key is not verified |

The image is private (private repository), so the server logs in to GHCR with the job's `GITHUB_TOKEN` for the pull and logs out right after. Moving to another CI (GitLab + Jenkins) means writing these few steps again with the same variables; the scripts stay.

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

To walk the phase "Done when" locally (login codes included) catch the email in Mailpit (`docker compose -f docker-compose.dev.yml up -d --wait` from the repo root; UI on http://localhost:8025). For that set `EMAIL_DRIVER=smtp`, `SMTP_HOST=host.docker.internal` and `SMTP_PORT=1025` in `deploy/.env` before `up`.
