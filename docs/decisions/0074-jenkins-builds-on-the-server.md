# 0074: Jenkins deploys over SSH only, the server builds the image, the .env stays on the server

- Status: accepted
- Date: 2026-10-30

## Context

[ADR 0068](0068-company-gitlab-jenkins-behind-apache.md) planned a Jenkins agent that runs `scripts/ci.sh`, builds and pushes the image to a company registry and deploys with secrets from Jenkins credentials. The company's real setup (sysadmin, 2026-10-30) does not allow that:

- Jenkins (`jenkins.ui42.sk`) has a single Built-In Node, no labels, Ubuntu 24.04, user `jenkins` not in the `docker` group, Node 18, no corepack, no sudo. No Docker and no `ci.sh` there, and nothing may be installed on it.
- The company's eGrant LIVE job is one shell step, `dep7 deploy live`: it SSHes to its server with the `jenkins` user's own default key and known_hosts. No Jenkins credentials, no registry.
- The sysadmin added that same public key to the user `caddy` on the new server `knb.ui42.sk` (x86_64, Docker Compose 2.27.1, buildx 0.14.1, so BuildKit). Help lives in `/home/caddy/help/prod`; Apache proxies `testhelp.egrant.sk` to `127.0.0.1:9003` (proxy mode of ADR 0068). No TLS certificate yet.

## Decision

- **The `Jenkinsfile` only deploys**, the way the eGrant LIVE job does: `agent any`, one stage on `main`, `DEPLOY_KNOWN_HOSTS="$(cat deploy/known_hosts)" bash scripts/deploy.sh prod <commit>`. The settings (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_ROOT`, `DOMAIN`, `IMAGE=spolu`, `BEHIND_PROXY`, `HTTP_PORT`, `BUILD_ON_SERVER=1`, `HEALTH_CHECK_LOCAL=1`) are not secret and live in its `environment {}` block. No credentials, no lock or timestamps plugin, no trigger yet (started by hand until the data move).
- **The server's host key is pinned in the repository** (`deploy/known_hosts`, three public lines), so `StrictHostKeyChecking=yes` stays and Jenkins' own known_hosts is not involved.
- **`DEPLOY_SSH_KEY` is optional** in `deploy.sh` (`deploy_ssh` in `scripts/lib.sh`): unset, ssh and scp use the runner's default identity (no `-i`, no `IdentitiesOnly`).
- **`DEPLOY_ENV_FILE` is optional**: unset, the env stays on the server. `deploy.sh` reads `<root>/<env>/.env` over SSH into a private temporary file, applies the same non-secret overlay as before (`deploy_env`: `DOMAIN`, `PUBLIC_URL`, `REDIRECT_DOMAINS`, proxy keys, `rename_senders`, then `IMAGE`/`TAG`) and writes it back. Without that file it stops before changing anything on the server. The owner places and edits the `.env` there by hand.
- **`BUILD_ON_SERVER=1` replaces the registry**: `git archive <commit>` is piped over SSH, unpacked into a temporary folder under the environment's folder and built there with `DOCKER_BUILDKIT=1 docker build --network host --build-arg APP_VERSION=<commit> --label org.spolu.app=spolu --tag $IMAGE:<commit> <folder>` (not `docker build -`: a tar on stdin fails under buildx over SSH, "no http response from session", seen on the first Jenkins run) (the same build argument as `scripts/build-image.sh`, for the server's own platform). The build is skipped when that image is already there (a rerun or a rollback). The deploy then goes on as with `IMAGE_PRELOADED=1` (no registry login, no pull of the app image). The server also runs eGrant's containers, so the cleanup after the start touches only this app: unused images with the label `org.spolu.app=spolu` older than 7 days (never another project's images, unlike the plain `docker image prune -af` on our own servers), and build cache unused for 7 days only once all of it exceeds 20 GB. The tag must be a commit git can archive; it is checked before the server is contacted.
- Without the new variables `deploy.sh` behaves exactly as before (same SSH options, remote script and uploaded env), so `deploy-local.sh`, the GitHub workflow and the test server do not change.
- **Outbound traffic from Docker networks is blocked on the company server** (seen on the first run: a container on a bridge network cannot reach any DNS server, one on the host network can; eGrant's containers all run with `network_mode: host`). The build therefore runs with `--network host` (it only downloads). The running app needs SMTP, HTTPS and DNS, so `DOCKER_SUBNET=172.30.42.0/24` (Jenkinsfile) pins the app network's subnet through `deploy/docker-compose.subnet.yml`, and the sysadmin allows only that subnet out. Host networking for the whole stack was rejected: Caddy would need port 80 (Apache's), Postgres would listen on the host, and the services would lose their private network and names.

## Consequences

- Jenkins no longer runs `ci.sh`: the local `scripts/ci.sh` before every merge to `main` is the only gate. A merge that skips it deploys unchecked code.
- Each deploy builds on the production server for a few minutes, next to eGrant's own services (CPU, memory, disk for the build cache). BuildKit's cache keeps unchanged layers; the label-scoped prunes keep the disk in check without touching eGrant.
- No registry: a rollback is a rerun with an older commit ("Build with Parameters", `DEPLOY_COMMIT`). While its image is still on the server (this app's unused images are pruned after 7 days) it starts at once; otherwise it is rebuilt from the commit. The Jenkins clone must keep the history.
- Secrets never pass through Jenkins; the owner edits `/home/caddy/help/prod/.env` on the server (mode 600). A changed `.env` takes effect at the next deploy (or `docker compose up -d` there).
- At the cut-over: `DOMAIN=help.egrant.sk`, remove `HEALTH_CHECK_LOCAL`, add the GitLab push trigger (the `Jenkinsfile` header says how).
