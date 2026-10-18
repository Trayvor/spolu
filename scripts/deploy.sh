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
#   DEPLOY_KNOWN_HOSTS  known_hosts line(s) for the server (ssh-keyscan <host>); pins its host
#                    key. The deploy refuses to start without it (no trust on first use).
#   IMAGE            image repository, e.g. ghcr.io/trayvor/spolu
#   DOMAIN           public domain of the environment: the health check, and DOMAIN= and
#                    PUBLIC_URL=https://<domain> in the server's .env (they override the file)
#   TICKETS_API_KEY  optional; when set it replaces TICKETS_API_KEY= of the env file
#   REDIRECT_DOMAINS optional; space-separated old domains (e.g. "spolu.egrant.sk"). Each one gets
#                    its own certificate and a permanent redirect to https://$DOMAIN (Caddy,
#                    redirects.caddy). Written to the server's .env as REDIRECT_DOMAINS=.
# Env (optional):
#   DEPLOY_PORT         SSH port (default 22)
#   REGISTRY_USER, REGISTRY_TOKEN  registry login on the server before pulling (private images);
#                       the server logs out again right after the pull.
#   IMAGE_PRELOADED     "1": $IMAGE:<tag> is already on the server (scripts/deploy-local.sh streams
#                       it there with docker save | docker load), so the app image is not pulled and
#                       there is no registry login; the server checks that the image is there.
#
# On the server everything lives in /opt/spolu/<env>/: docker-compose.yml, Caddyfile,
# redirects.caddy, backup/ and .env (mode 600). IMAGE= and TAG= in that .env are set to the deployed version, so a manual
# "docker compose up -d" in that folder runs the same version.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

[[ $# -eq 2 ]] || usage "deploy.sh <env> <tag>   (e.g. deploy.sh test \$(git rev-parse HEAD))"
env_name="$1"
tag="$2"
[[ "$env_name" =~ ^[a-z0-9-]+$ ]] || die "env must be lowercase letters, digits or dashes: $env_name"
[[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]] || die "tag must be letters, digits, dots, dashes or underscores: $tag"
require_env DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_ENV_FILE DEPLOY_KNOWN_HOSTS IMAGE DOMAIN
require_cmd ssh scp curl
[[ -f "$DEPLOY_SSH_KEY" ]] || die "DEPLOY_SSH_KEY file not found: $DEPLOY_SSH_KEY"
[[ -f "$DEPLOY_ENV_FILE" ]] || die "DEPLOY_ENV_FILE file not found: $DEPLOY_ENV_FILE"

remote_dir="/opt/spolu/$env_name"
target="$DEPLOY_USER@$DEPLOY_HOST"
health_url="https://$DOMAIN/api/health"
# Before anything reaches the server: a bad REDIRECT_DOMAINS stops the deploy here.
redirects_block="$(caddy_redirects)" || die "fix the REDIRECT_DOMAINS variable"

# Per-run known_hosts file, so the runner's own ~/.ssh is never used or changed.
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
printf '%s\n' "$redirects_block" > "$work_dir/redirects.caddy"
deploy_ssh "$work_dir" # sets ssh_cmd and scp_cmd (scripts/lib.sh)

# The tag running now, for the rollback hint if this deploy fails. Empty on the first deploy.
previous_tag="$("${ssh_cmd[@]}" "sed -n 's/^TAG=//p' '$remote_dir/.env' 2>/dev/null | tail -n 1" || true)"

log "Uploading files to $target:$remote_dir"
# The env file is written with umask 077 so it is never readable by other users, not even briefly.
# DOMAIN, PUBLIC_URL, REDIRECT_DOMAINS and (when set) TICKETS_API_KEY come from the workflow, not
# the file: see deploy_env.
deploy_env "$DEPLOY_ENV_FILE" | "${ssh_cmd[@]}" "mkdir -p '$remote_dir' && umask 077 && cat > '$remote_dir/.env.upload'"
"${scp_cmd[@]}" -r deploy/docker-compose.yml deploy/Caddyfile "$work_dir/redirects.caddy" deploy/backup \
  "$target:$remote_dir/"

log "Starting $IMAGE:$tag on $DEPLOY_HOST"
# Values go in as shell assignments on stdin (not as ssh arguments), so the registry token
# never shows up in a process list.
{
  echo 'set -euo pipefail'
  printf 'DEPLOY_DIR=%q IMAGE=%q TAG=%q IMAGE_PRELOADED=%q\n' \
    "$remote_dir" "$IMAGE" "$tag" "${IMAGE_PRELOADED:-}"
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

# "< /dev/null": this script itself arrives on stdin, so commands must not read from it.
if [ "$IMAGE_PRELOADED" = 1 ]; then
  # scripts/deploy-local.sh loaded the app image with "docker load"; there is no registry to pull
  # it from. The other services (postgres, caddy, backup) are pulled as usual.
  docker image inspect "$IMAGE:$TAG" > /dev/null < /dev/null \
    || { echo "image $IMAGE:$TAG is not on this server" >&2; exit 1; }
  # Unquoted on purpose: one word per service name (they never contain spaces).
  others="$(docker compose config --services < /dev/null | grep -vx app | tr '\n' ' ')"
  docker compose pull --quiet $others < /dev/null
else
  if [ -n "$REGISTRY_TOKEN" ]; then
    printf '%s' "$REGISTRY_TOKEN" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin >/dev/null
    trap 'docker logout "$REGISTRY" >/dev/null' EXIT
  fi
  docker compose pull --quiet < /dev/null
fi
docker compose up -d --remove-orphans < /dev/null
# "up" does not restart Caddy when only its mounted files changed (Caddyfile, redirects.caddy),
# so it reloads them; a running Caddy keeps its old config if the new one is invalid.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile < /dev/null
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
  if [[ "${IMAGE_PRELOADED:-}" == 1 ]]; then
    log "To roll back: scripts/deploy-local.sh $env_name $previous_tag"
  else
    log "To roll back: scripts/deploy.sh $env_name $previous_tag"
  fi
fi
die "deploy of $tag to $env_name failed"
