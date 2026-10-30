# 0068: Company GitLab + Jenkins, production behind the company's Apache

- Status: accepted; the Jenkins, credentials and registry parts superseded by [0074](0074-jenkins-builds-on-the-server.md) (proxy mode stays)
- Date: 2026-10-21

## Context

The owner hands the app to the company sysadmin: production runs on the company's own server,
with the company's GitLab, Jenkins and Docker-compatible registry. Ports 80, 443 and 8080 on that
server already belong to Apache, which terminates TLS for other sites. The sysadmin's concrete
answers (GitLab URL, registry address, server host, free port) are not known yet. The current
setup (GitHub, ghcr.io, the test server with Caddy on 80/443, `scripts/deploy-local.sh test`)
must keep working unchanged. [ADR 0004](0004-scripts-first-ci.md) planned this move: the logic
is in `scripts/`, a CI only calls it.

## Decision

- **A `Jenkinsfile` at the repository root**, declarative, that only calls the scripts. Only
  `main` is built (owner decision 2026-10-21: no CI on merge requests): `scripts/ci.sh`, then
  `scripts/build-image.sh` (push to `$IMAGE`), then `scripts/deploy.sh prod`. A plain Pipeline
  job on the GitLab push webhook (or a Multibranch job limited to `main`; any other branch is
  skipped). The whole run holds the lock `help-ci` (Lockable Resources) besides
  `disableConcurrentBuilds()`, so ci.sh runs never overlap on shared agents and deploys go out
  in push order. `main` stays protected in GitLab: changes come only through merge requests.
- **Secrets only in Jenkins credentials**: `help-prod-env` (secret file, the server's whole
  `.env`), `help-prod-ssh` (SSH key of `deploy`), `help-prod-known-hosts` (pinned host key),
  `help-registry` (registry user and password), `help-gitlab-token` (optional, commit status).
  Everything else (`DEPLOY_HOST`, `DOMAIN`, `IMAGE`, `BEHIND_PROXY`, `HTTP_PORT`, …) is a
  non-secret job variable, so the sysadmin's answers are configuration, never code.
- **The registry login is generic**: `REGISTRY` (default: `IMAGE` up to its first `/`),
  `REGISTRY_USER` and `REGISTRY_PASSWORD` (or `REGISTRY_TOKEN`). `GITHUB_TOKEN` stays only in
  the GitHub workflow. `BUILD_PLATFORMS` lets an agent without QEMU build only the server's
  platform; the default stays `linux/amd64,linux/arm64`.
- **Proxy mode**, switched by `BEHIND_PROXY=1` plus `HTTP_PORT=<free port>`. `deploy.sh` then
  writes `COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml` into the server's `.env`, so
  compose (and a manual `docker compose up -d` there) adds `deploy/docker-compose.proxy.yml`: it
  publishes only `127.0.0.1:${HTTP_PORT}:80` and mounts `deploy/Caddyfile.proxy` in place of the
  TLS one. That file serves plain HTTP on `:80` (`auto_https off`, no ACME), keeps the same
  security headers and compression (a test compares the two header blocks), and does not import
  `redirects.caddy`: old domains are redirected by Apache. An override file and a second
  Caddyfile were chosen over variables inside the default files so that the default (switch
  unset) is byte for byte today's setup.
- **The real client IP survives two proxies and cannot be forged.** The app keeps trusting one
  hop (`trustProxy: hop < 1`, the last `X-Forwarded-For` entry). Caddy would append Apache's
  address after the client's, so in proxy mode it works the client out itself:
  `trusted_proxies` (default loopback and Docker's `172.16.0.0/12`, `TRUSTED_PROXIES` overrides),
  `client_ip_headers X-Forwarded-For`, `trusted_proxies_strict` (the right-most untrusted entry,
  the one Apache appended), and sends `X-Forwarded-For: {client_ip}` alone. Entries a client
  writes are ignored; from an untrusted address the headers are not believed at all.
  `X-Forwarded-Proto: https` from Apache passes through the same way. A Docker test
  (`scripts/tests/caddy-proxy.test.sh`) checks both cases against a stand-in app.
- **Health check**: still `https://$DOMAIN/api/health`, now through Apache. On failure in proxy
  mode `deploy.sh` also asks `http://127.0.0.1:$HTTP_PORT/api/health` on the server (curl over
  SSH), so an app problem is told apart from a DNS or vhost one; `HEALTH_CHECK_LOCAL=1` uses the
  local check alone, for a first deploy before DNS and Apache are ready.
- Environment `prod`, folder `/opt/spolu/prod`, template `deploy/prod.env.example`.

## Consequences

- A deploy happens about 15 minutes or more after a merge (the full `ci.sh`, e2e included,
  then the image build). A red run on `main` deploys nothing and the previous version keeps
  running; the fix is a new merge request.
- Nothing changes for the test server and `deploy-local.sh`: with `BEHIND_PROXY` unset the
  server's `.env` has no `COMPOSE_FILE`, and the TLS Caddyfile and ports stay.
- The sysadmin owns the Apache vhost (TLS certificate, WebSocket upgrade for `/socket.io`,
  `LimitRequestBody 0` for the 2 GiB meeting recordings, timeouts, the redirect vhost) and DNS;
  [deploy.md](../runbooks/deploy.md#proxy-mode-behind-apache) lists what the vhost needs. A
  full guide for the sysadmin (data move, cut-over) is left for later (owner, 2026-10-21).
- Docker Compose 2.24.4 or newer is needed on the server (`!override` in the override file).
- If the company's LAN uses `172.16.0.0/12`, a LAN client could be a "trusted proxy": then
  `TRUSTED_PROXIES` must be narrowed to the compose network's gateway.
- After the switch: remove `.github/workflows/`, and change `gh`/pull request wording to
  `glab`/merge request in `CLAUDE.md` and the docs (not done yet).
