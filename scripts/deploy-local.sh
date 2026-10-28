#!/usr/bin/env bash
# Usage: deploy-local.sh [--force-ref] [<env> [<sha>]]
# Deploys commit <sha> (default HEAD) to environment <env> (default "test") from this machine,
# without GitHub Actions and without a registry (owner decision 2026-10-18: Actions minutes are
# exhausted). Run it after a green scripts/ci.sh. Any CI (Jenkins later) can call it the same way.
#
#   1. Refuses a working tree with uncommitted changes, and a <sha> that is not on origin/main
#      (after a fetch). --force-ref lifts both checks (e.g. to try a branch on test).
#   2. Reads the settings from a local config file outside the repository:
#      $SPOLU_DEPLOY_CONFIG, default ~/.config/spolu/<env>.deploy (shell KEY=value lines, mode 600).
#   3. Builds the image of <sha> (from "git archive", so the tree on disk does not matter) for the
#      server's platform only (scripts/build-image.sh --load), tagged $IMAGE:<sha> and $IMAGE:<env>.
#      Skipped when the server already has $IMAGE:<sha> (a redeploy or a rollback).
#   4. Streams it to the server: docker save | gzip | ssh 'gunzip | docker load'.
#   5. Runs scripts/deploy.sh <env> <sha> with IMAGE_PRELOADED=1 (no pull of the app image).
#
# Config keys (see docs/runbooks/deploy.md, "Local deploy"); the file is parsed, never run
# (load_deploy_config in scripts/lib.sh: KEY=value, spaces need no quotes, ~/ is expanded):
#   required: DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY (path) ENV_FILE (path) DOMAIN IMAGE, and
#             DEPLOY_KNOWN_HOSTS_FILE (path to ssh-keyscan lines) or DEPLOY_KNOWN_HOSTS (one line)
#   optional: DEPLOY_PORT REDIRECT_DOMAINS MAIL_FROM_NAME TICKETS_API_KEY
#             BEHIND_PROXY HTTP_PORT (proxy mode behind the host's web server, see deploy.sh)
#             HEALTH_CHECK_LOCAL (proxy mode: check the server's local port, e.g. while DNS still
#             points to the old server, docs/runbooks/server-move.md)
#             DEPLOY_ROOT (the server's folder for <env>/, default /opt/spolu)
#             DEPLOY_PLATFORM (default linux/arm64, the test server's; linux/amd64; or "auto" =
#             ask the server with uname -m)
# The config file, the SSH key and the env file must be private (chmod 600). Secrets are never
# printed.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

force_ref=0
positional=()
for arg in "$@"; do
  case "$arg" in
    --force-ref) force_ref=1 ;;
    -*) usage "deploy-local.sh [--force-ref] [<env> [<sha>]]" ;;
    *) positional+=("$arg") ;;
  esac
done
(( ${#positional[@]} <= 2 )) || usage "deploy-local.sh [--force-ref] [<env> [<sha>]]"
env_name="${positional[0]:-test}"
ref="${positional[1]:-HEAD}"
[[ "$env_name" =~ ^[a-z0-9-]+$ ]] || die "env must be lowercase letters, digits or dashes: $env_name"
require_cmd git docker ssh scp curl gzip tar

# --- Which commit ---
if [[ -n "$(git status --porcelain)" ]]; then
  (( force_ref )) || die "the working tree has uncommitted changes; commit them first (or --force-ref)"
  log "WARNING: uncommitted changes (--force-ref); the image is built from the commit, not the tree"
fi
sha="$(git rev-parse --verify --quiet "$ref^{commit}")" || die "not a commit: $ref"
if (( force_ref )); then
  log "WARNING: --force-ref; not checking that $sha is on origin/main"
else
  git fetch --quiet origin main || die "cannot fetch origin main"
  git merge-base --is-ancestor "$sha" origin/main \
    || die "$sha is not on origin/main; merge it first (or --force-ref)"
fi

# --- Settings ---
config="${SPOLU_DEPLOY_CONFIG:-$HOME/.config/spolu/$env_name.deploy}"
require_private_file "deploy config" "$config"
keys=(DEPLOY_HOST DEPLOY_USER DEPLOY_PORT DEPLOY_KNOWN_HOSTS DEPLOY_KNOWN_HOSTS_FILE DEPLOY_SSH_KEY
  ENV_FILE DOMAIN IMAGE REDIRECT_DOMAINS MAIL_FROM_NAME TICKETS_API_KEY DEPLOY_PLATFORM
  BEHIND_PROXY HTTP_PORT HEALTH_CHECK_LOCAL DEPLOY_ROOT)
# Only the file counts: values left in this shell (e.g. a registry token) must not leak in.
unset "${keys[@]}" DEPLOY_ENV_FILE REGISTRY REGISTRY_USER REGISTRY_TOKEN REGISTRY_PASSWORD \
  IMAGE_PRELOADED
load_deploy_config "$config" "${keys[@]}"
if [[ -n "${DEPLOY_KNOWN_HOSTS_FILE:-}" ]]; then
  [[ -f "$DEPLOY_KNOWN_HOSTS_FILE" ]] || die "DEPLOY_KNOWN_HOSTS_FILE not found: $DEPLOY_KNOWN_HOSTS_FILE"
  DEPLOY_KNOWN_HOSTS="$(cat "$DEPLOY_KNOWN_HOSTS_FILE")${DEPLOY_KNOWN_HOSTS:+$'\n'$DEPLOY_KNOWN_HOSTS}"
fi
[[ -n "${DEPLOY_KNOWN_HOSTS:-}" ]] \
  || die "DEPLOY_KNOWN_HOSTS_FILE or DEPLOY_KNOWN_HOSTS is missing in $config (ssh-keyscan, see docs/runbooks/deploy.md)"
for key in DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY ENV_FILE DOMAIN IMAGE; do
  [[ -n "${!key:-}" ]] || die "$key is missing in $config"
done
require_private_file "DEPLOY_SSH_KEY" "$DEPLOY_SSH_KEY"
require_private_file "ENV_FILE" "$ENV_FILE"
[[ "$IMAGE" =~ ^[a-z0-9][a-z0-9._/:-]*$ ]] || die "IMAGE must be a lowercase image name: $IMAGE"
export DEPLOY_HOST DEPLOY_USER DEPLOY_KNOWN_HOSTS DEPLOY_SSH_KEY DOMAIN IMAGE
export DEPLOY_PORT="${DEPLOY_PORT:-22}" REDIRECT_DOMAINS="${REDIRECT_DOMAINS:-}"
export MAIL_FROM_NAME="${MAIL_FROM_NAME:-}" TICKETS_API_KEY="${TICKETS_API_KEY:-}"
export BEHIND_PROXY="${BEHIND_PROXY:-}" HTTP_PORT="${HTTP_PORT:-}"
export HEALTH_CHECK_LOCAL="${HEALTH_CHECK_LOCAL:-}" DEPLOY_ROOT="${DEPLOY_ROOT:-}"
export DEPLOY_ENV_FILE="$ENV_FILE" IMAGE_PRELOADED=1

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
deploy_ssh "$work_dir" # sets ssh_cmd (scripts/lib.sh)

# --- Image ---
if "${ssh_cmd[@]}" "docker image inspect $(printf '%q' "$IMAGE:$sha") >/dev/null 2>&1" < /dev/null; then
  log "$IMAGE:$sha is already on $DEPLOY_HOST; not building it again"
else
  # The test server is aarch64, and the M3 builds arm64 natively (amd64 would go through QEMU).
  platform="${DEPLOY_PLATFORM:-linux/arm64}"
  if [[ "$platform" == auto ]]; then
    arch="$("${ssh_cmd[@]}" uname -m < /dev/null)" || die "cannot ask $DEPLOY_HOST for its architecture"
    case "$arch" in
      x86_64 | amd64) platform=linux/amd64 ;;
      aarch64 | arm64) platform=linux/arm64 ;;
      *) die "unknown server architecture '$arch'; set DEPLOY_PLATFORM in $config" ;;
    esac
  fi
  [[ "$platform" =~ ^linux/(amd64|arm64)$ ]] || die "DEPLOY_PLATFORM must be linux/amd64 or linux/arm64: $platform"

  log "Exporting $sha to a clean build context"
  mkdir "$work_dir/src"
  git archive "$sha" | tar -x -C "$work_dir/src"
  BUILD_CONTEXT="$work_dir/src" BUILD_PLATFORM="$platform" EXTRA_TAG="$env_name" \
    scripts/build-image.sh --load "$sha"

  log "Streaming $IMAGE:$sha to $DEPLOY_HOST (docker save | gzip | ssh docker load)"
  docker save "$IMAGE:$sha" "$IMAGE:$env_name" | gzip -c | "${ssh_cmd[@]}" 'gunzip | docker load'
fi

scripts/deploy.sh "$env_name" "$sha"
