#!/usr/bin/env bash
# Usage: build-image.sh [--load] <tag>
# Builds the production image for linux/amd64 and linux/arm64 and pushes it as $IMAGE:<tag>.
# <tag> is the full git SHA; it is also baked in as APP_VERSION, so /api/health reports it.
#
# --load: build only one platform (BUILD_PLATFORM) and load the image into the local Docker
#   instead of pushing it: no registry and no login. scripts/deploy-local.sh uses it and then
#   streams the image to the server.
#
# Env:
#   IMAGE           required, image repository, lowercase, e.g. ghcr.io/trayvor/spolu
#   EXTRA_TAG       optional, also tag $IMAGE:$EXTRA_TAG (e.g. "test" = what the test env runs)
#   BUILDX_CACHE    optional, "gha" uses the GitHub Actions cache for layers (only inside GitHub Actions)
#   BUILD_PLATFORM  with --load: the one platform to build (default linux/amd64)
#   BUILD_PLATFORMS without --load: the platforms to build and push, comma-separated (default
#                   linux/amd64,linux/arm64). A CI agent without QEMU/binfmt sets the server's
#                   one only, e.g. linux/amd64.
#   BUILD_CONTEXT   optional, the directory to build (default the repository root)
#
# Without --load the caller logs in to the registry first and has a buildx builder that can build
# both platforms (on amd64 that needs QEMU, e.g. docker/setup-qemu-action), or sets BUILD_PLATFORMS.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

load=0
if [[ "${1:-}" == "--load" ]]; then
  load=1
  shift
fi
[[ $# -eq 1 && -n "$1" ]] || usage "IMAGE=ghcr.io/<owner>/spolu build-image.sh [--load] <tag>"
tag="$1"
require_env IMAGE
require_cmd docker
# [[:upper:]], not [A-Z]: in some locales (macOS bash) [A-Z] also matches lowercase letters.
[[ "$IMAGE" != *[[:upper:]]* ]] || die "IMAGE must be lowercase (registries reject uppercase): $IMAGE"
context="${BUILD_CONTEXT:-.}"

if (( load )); then
  args=(--platform "${BUILD_PLATFORM:-linux/amd64}" --load)
else
  platforms="${BUILD_PLATFORMS:-linux/amd64,linux/arm64}"
  [[ "$platforms" =~ ^linux/(amd64|arm64)(,linux/(amd64|arm64))?$ ]] \
    || die "BUILD_PLATFORMS must be linux/amd64, linux/arm64 or both, comma-separated: $platforms"
  args=(--platform "$platforms" --push)
fi
args+=(
  --build-arg "APP_VERSION=$tag"
  --tag "$IMAGE:$tag"
)
if [[ -n "${EXTRA_TAG:-}" ]]; then
  args+=(--tag "$IMAGE:$EXTRA_TAG")
fi
if [[ "${BUILDX_CACHE:-}" == "gha" ]]; then
  # mode=max also caches the build-stage layers (install, build), which is what saves time,
  # especially for the slow QEMU arm64 build. They hold no secrets: .env is in .dockerignore.
  args+=(--cache-from type=gha --cache-to "type=gha,mode=max")
fi

if (( load )); then
  log "Building $IMAGE:$tag${EXTRA_TAG:+ and $IMAGE:$EXTRA_TAG} for ${BUILD_PLATFORM:-linux/amd64} into the local Docker"
else
  log "Building and pushing $IMAGE:$tag${EXTRA_TAG:+ and $IMAGE:$EXTRA_TAG}"
fi
docker buildx build "${args[@]}" "$context"
if (( load )); then log "Loaded $IMAGE:$tag"; else log "Pushed $IMAGE:$tag"; fi
