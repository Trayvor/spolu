#!/usr/bin/env bash
# Usage: deploy.sh <env> <tag>
# Deploys image $IMAGE:<tag> to the server of environment <env> (e.g. "test") and waits until
# https://$DOMAIN/api/health reports version <tag>. Exits 1 if it does not within 120 seconds.
#
# Env (required):
#   DEPLOY_HOST      server hostname or IP
#   DEPLOY_USER      SSH user on the server (the "deploy" user from server-setup.sh)
#   DEPLOY_SSH_KEY   path to the private SSH key of that user
#   DEPLOY_ENV_FILE  path to the env file for the server (see deploy/test.env.example)
#   IMAGE            image repository, e.g. ghcr.io/trayvor/spolu
#   DOMAIN           public domain of the environment, used for the health check
# Env (optional):
#   DEPLOY_PORT         SSH port (default 22)
#   DEPLOY_KNOWN_HOSTS  known_hosts line(s) for the server; pins its host key. Without it the
#                       server's host key is NOT verified (a warning is printed). Set it.
#   REGISTRY_USER, REGISTRY_TOKEN  registry login on the server before pulling (private images);
#                       the server logs out again right after the pull.
#
# On the server everything lives in /opt/spolu/<env>/: docker-compose.yml, Caddyfile, backup/ and
# .env (mode 600). IMAGE= and TAG= in that .env are set to the deployed version, so a manual
# "docker compose up -d" in that folder runs the same version.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

[[ $# -eq 2 ]] || usage "deploy.sh <env> <tag>   (e.g. deploy.sh test \$(git rev-parse HEAD))"
env_name="$1"
tag="$2"
[[ "$env_name" =~ ^[a-z0-9-]+$ ]] || die "env must be lowercase letters, digits or dashes: $env_name"
[[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]] || die "tag must be letters, digits, dots, dashes or underscores: $tag"
require_env DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_ENV_FILE IMAGE DOMAIN
require_cmd ssh scp curl
[[ -f "$DEPLOY_SSH_KEY" ]] || die "DEPLOY_SSH_KEY file not found: $DEPLOY_SSH_KEY"
[[ -f "$DEPLOY_ENV_FILE" ]] || die "DEPLOY_ENV_FILE file not found: $DEPLOY_ENV_FILE"

remote_dir="/opt/spolu/$env_name"
target="$DEPLOY_USER@$DEPLOY_HOST"
port="${DEPLOY_PORT:-22}"
health_url="https://$DOMAIN/api/health"

# Per-run known_hosts file, so the runner's own ~/.ssh is never used or changed.
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
known_hosts="$work_dir/known_hosts"
if [[ -n "${DEPLOY_KNOWN_HOSTS:-}" ]]; then
  printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$known_hosts"
  host_key_check=yes
else
  : > "$known_hosts"
  host_key_check=accept-new
  log "WARNING: DEPLOY_KNOWN_HOSTS is not set; the server's host key is not verified"
fi
common_opts=(
  -i "$DEPLOY_SSH_KEY"
  -o IdentitiesOnly=yes
  -o BatchMode=yes
  -o ConnectTimeout=20
  -o "UserKnownHostsFile=$known_hosts"
  -o "StrictHostKeyChecking=$host_key_check"
)
ssh_cmd=(ssh "${common_opts[@]}" -p "$port" "$target")
scp_cmd=(scp "${common_opts[@]}" -P "$port")

# The tag running now, for the rollback hint if this deploy fails. Empty on the first deploy.
previous_tag="$("${ssh_cmd[@]}" "sed -n 's/^TAG=//p' '$remote_dir/.env' 2>/dev/null | tail -n 1" || true)"

log "Uploading files to $target:$remote_dir"
# The env file is written with umask 077 so it is never readable by other users, not even briefly.
"${ssh_cmd[@]}" "mkdir -p '$remote_dir' && umask 077 && cat > '$remote_dir/.env.upload'" < "$DEPLOY_ENV_FILE"
"${scp_cmd[@]}" -r deploy/docker-compose.yml deploy/Caddyfile deploy/backup "$target:$remote_dir/"

log "Starting $IMAGE:$tag on $DEPLOY_HOST"
# Values go in as shell assignments on stdin (not as ssh arguments), so the registry token
# never shows up in a process list.
{
  echo 'set -euo pipefail'
  printf 'DEPLOY_DIR=%q IMAGE=%q TAG=%q\n' "$remote_dir" "$IMAGE" "$tag"
  printf 'REGISTRY=%q REGISTRY_USER=%q REGISTRY_TOKEN=%q\n' \
    "${IMAGE%%/*}" "${REGISTRY_USER:-}" "${REGISTRY_TOKEN:-}"
  cat <<'REMOTE'
umask 077
cd "$DEPLOY_DIR"
mv .env.upload .env
# Pin the deployed version in .env, so a manual "docker compose up -d" here runs it too.
grep -v -e '^IMAGE=' -e '^TAG=' .env > .env.next || true
printf 'IMAGE=%s\nTAG=%s\n' "$IMAGE" "$TAG" >> .env.next
mv .env.next .env
chmod 600 .env
export IMAGE TAG

if [ -n "$REGISTRY_TOKEN" ]; then
  printf '%s' "$REGISTRY_TOKEN" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin >/dev/null
  trap 'docker logout "$REGISTRY" >/dev/null' EXIT
fi
# "< /dev/null": this script itself arrives on stdin, so commands must not read from it.
docker compose pull --quiet < /dev/null
docker compose up -d --remove-orphans < /dev/null
# Remove images no container uses that are older than 7 days (old releases included); the
# server disk is small. Recent ones stay, so a rollback to last week's tag needs no download.
docker image prune -af --filter "until=168h" > /dev/null < /dev/null
REMOTE
} | "${ssh_cmd[@]}" bash -s

log "Waiting for $health_url to report version $tag"
version_matches() {
  if command -v jq >/dev/null 2>&1; then
    jq -e --arg v "$tag" '.status == "ok" and .version == $v' >/dev/null 2>&1 <<< "$1"
  else
    grep -qF '"status":"ok"' <<< "$1" && grep -qF "\"version\":\"$tag\"" <<< "$1"
  fi
}
deadline=$((SECONDS + 120))
response=""
while true; do
  # --fail-with-body: a 503 still shows its JSON body in the timeout message.
  response="$(curl -sS --fail-with-body --max-time 10 "$health_url" 2>&1)" || true
  if version_matches "$response"; then
    log "Deployed $tag to $env_name: $response"
    exit 0
  fi
  if (( SECONDS >= deadline )); then
    break
  fi
  sleep 5
done

log "Health check did not report version $tag within 120s. Last response: $response"
log "Containers and the last 50 app log lines on $DEPLOY_HOST:"
"${ssh_cmd[@]}" "cd '$remote_dir' && docker compose ps && docker compose logs --no-color --tail 50 app" || true
if [[ -n "$previous_tag" && "$previous_tag" != "$tag" ]]; then
  log "To roll back: scripts/deploy.sh $env_name $previous_tag"
fi
die "deploy of $tag to $env_name failed"
