#!/usr/bin/env bash
# Usage: build-image.sh <tag>
# Builds the production image for linux/amd64 and linux/arm64 and pushes it as $IMAGE:<tag>.
# <tag> is the full git SHA; it is also baked in as APP_VERSION, so /api/health reports it.
#
# Env:
#   IMAGE         required, image repository, lowercase, e.g. ghcr.io/trayvor/spolu
#   EXTRA_TAG     optional, also push $IMAGE:$EXTRA_TAG (e.g. "test" = what the test env runs)
#   BUILDX_CACHE  optional, "gha" uses the GitHub Actions cache for layers (only inside GitHub Actions)
#
# The caller logs in to the registry first and has a buildx builder that can build both
# platforms (on amd64 that needs QEMU, e.g. docker/setup-qemu-action).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

[[ $# -eq 1 && -n "$1" ]] || usage "IMAGE=ghcr.io/<owner>/spolu build-image.sh <tag>"
tag="$1"
require_env IMAGE
require_cmd docker
[[ "$IMAGE" != *[A-Z]* ]] || die "IMAGE must be lowercase (registries reject uppercase): $IMAGE"

args=(
  --platform "linux/amd64,linux/arm64"
  --build-arg "APP_VERSION=$tag"
  --tag "$IMAGE:$tag"
  --push
)
if [[ -n "${EXTRA_TAG:-}" ]]; then
  args+=(--tag "$IMAGE:$EXTRA_TAG")
fi
if [[ "${BUILDX_CACHE:-}" == "gha" ]]; then
  # mode=min exports only the final image layers, keeping the cache small.
  args+=(--cache-from type=gha --cache-to "type=gha,mode=min")
fi

log "Building and pushing $IMAGE:$tag${EXTRA_TAG:+ and $IMAGE:$EXTRA_TAG}"
docker buildx build "${args[@]}" .
log "Pushed $IMAGE:$tag"
