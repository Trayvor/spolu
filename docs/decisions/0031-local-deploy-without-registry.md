# 0031 Local deploy from the orchestrator's Mac, without a registry

Date: 2026-10-18
Status: accepted

## Context
The GitHub Actions minutes are exhausted (2026-10-18). Until now every push to `main` ran `deploy-test.yml`: `scripts/ci.sh`, a two-platform image build pushed to GHCR, and `scripts/deploy.sh`, which made the server pull from GHCR. GHCR is part of GitHub too and has its own limits. Jenkins is planned but not there yet. Every change is already checked by a local `scripts/ci.sh` on the orchestrator's Mac (Apple M3, Docker Desktop) before it is merged.

## Decision
- The test environment is deployed by hand from that Mac with `scripts/deploy-local.sh [<env> [<sha>]]`, after a green local `scripts/ci.sh`. It refuses a dirty tree and a commit not on `origin/main` (unless `--force-ref`).
- No registry: `scripts/build-image.sh --load` builds only the server's platform (`DEPLOY_PLATFORM`, default `linux/arm64`: the test server is aarch64, which the M3 builds natively; `auto` asks the server's `uname -m`) into the local Docker, and the image is streamed over SSH with `docker save | gzip | ssh 'gunzip | docker load'`. `scripts/deploy.sh` with `IMAGE_PRELOADED=1` then skips the registry login and the app image pull. The registry path (`--push`, `docker compose pull`) stays for GitHub or Jenkins.
- The settings the GitHub environment `test` held live in a private file outside the repository, `~/.config/spolu/<env>.deploy` (mode 600, checked), together with paths to the SSH key, the server env file (both mode 600) and the known hosts. The file is parsed as `KEY=value` lines with a fixed key list, never sourced, so it cannot run code and values with spaces need no quotes.
- `ci.yml` and `deploy-test.yml` stay in the repository but run only by hand (`workflow_dispatch`).

## Consequences
- Nothing deploys on merge any more: whoever merges runs `scripts/deploy-local.sh`. Pull requests are not checked by GitHub; the local `scripts/ci.sh` is the gate.
- The image (about 135 MB compressed) is uploaded on every deploy; an image already on the server (redeploy, rollback within the 7 days the server keeps images) is not built or sent again.
- An amd64 server built from the M3 would go through QEMU and be slow; the arm64 test server builds natively.
- Jenkins can call `scripts/deploy-local.sh` with its own config file (`SPOLU_DEPLOY_CONFIG`), or keep the registry path.
