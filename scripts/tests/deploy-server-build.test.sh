#!/usr/bin/env bash
# Tests for the company Jenkins deploy (ADR 0074): scripts/deploy.sh with stubbed ssh, scp and curl.
#   - no DEPLOY_ENV_FILE: the server's own .env is read, the non-secret overlay applied, uploaded
#     back; a missing server .env stops the deploy before anything changes on the server
#   - no DEPLOY_SSH_KEY: ssh and scp use the runner's default identity (no -i, no IdentitiesOnly)
#   - BUILD_ON_SERVER=1: git archive of the commit is piped over ssh into docker build on the
#     server (APP_VERSION=<commit>), skipped when the image is there; no registry login or pull of
#     the app image; old build cache pruned; a tag that is not a commit is refused before ssh
#   - default mode (key, env file, no build) keeps today's ssh options and remote script
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0
d="$(mktemp -d)"
trap 'rm -rf "$d"' EXIT

has() { # name, needle, file
  grep -qF -- "$2" "$3" 2>/dev/null || { echo "FAIL $1: '$2' not in $(basename "$3")"; fail=1; }
}
hasnt() { # name, needle, file
  ! grep -qF -- "$2" "$3" 2>/dev/null || { echo "FAIL $1: '$2' found in $(basename "$3")"; fail=1; }
}

mkdir "$d/bin"
cat > "$d/bin/ssh" <<'STUB'
#!/usr/bin/env bash
echo "ssh-args $*" >> "$STUB_DIR/calls"
while [[ $# -gt 0 && "$1" == -* ]]; do shift 2; done # -i/-o/-p each take a value
shift # user@host
cmd="$*"
echo "ssh-cmd $cmd" >> "$STUB_DIR/calls"
case "$cmd" in
  "bash -s") cat > "$STUB_DIR/remote.sh" ;;
  "mkdir -p "*) cat > "$STUB_DIR/uploaded.env" ;;
  "if [ -f "*) if [[ -f "$STUB_DIR/remote.env" ]]; then cat "$STUB_DIR/remote.env"; else exit 3; fi ;;
  "docker image inspect "*) [[ "${STUB_IMAGE_EXISTS:-}" == 1 ]] || exit 1 ;;
  *"docker build "*) cat > "$STUB_DIR/build.tar" ;;
  "curl "*) printf '{"status":"ok","version":"%s"}' "$STUB_VERSION" ;;
  *) ;;
esac
STUB
cat > "$d/bin/scp" <<'STUB'
#!/usr/bin/env bash
echo "scp $*" >> "$STUB_DIR/calls"
STUB
cat > "$d/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_DIR/calls"
printf '{"status":"ok","version":"%s"}' "$STUB_VERSION"
STUB
chmod +x "$d/bin/"*
touch "$d/key"
printf 'POSTGRES_PASSWORD=local-secret\n' > "$d/server.env"
commit="$(git -C "$root" rev-parse HEAD)"

deploy() { # tag, extra env assignments...; runs deploy.sh prod <tag> (key and env file unset)
  local tag="$1"
  shift
  rm -f "$d/calls" "$d/remote.sh" "$d/uploaded.env" "$d/build.tar"
  env -u BEHIND_PROXY -u HTTP_PORT -u HEALTH_CHECK_LOCAL -u REGISTRY -u REGISTRY_TOKEN \
    -u REGISTRY_PASSWORD -u REGISTRY_USER -u REDIRECT_DOMAINS -u IMAGE_PRELOADED -u DEPLOY_ROOT \
    -u DEPLOY_SSH_KEY -u DEPLOY_ENV_FILE -u BUILD_ON_SERVER -u TICKETS_API_KEY -u MAIL_FROM_NAME \
    PATH="$d/bin:$PATH" STUB_DIR="$d" STUB_VERSION="$tag" \
    DEPLOY_HOST=srv.example.com DEPLOY_USER=caddy \
    DEPLOY_KNOWN_HOSTS='srv.example.com ssh-ed25519 AAAA' \
    IMAGE=spolu DOMAIN=help.example.com "$@" \
    bash "$root/scripts/deploy.sh" prod "$tag" > "$d/out" 2>&1
}

# --- default mode: SSH key and env file given, image from the registry ---
rm -f "$d/remote.env"
deploy 0123456789abcdef DEPLOY_SSH_KEY="$d/key" DEPLOY_ENV_FILE="$d/server.env" \
  || { echo "FAIL default deploy"; cat "$d/out"; fail=1; }
has "default: the key is used" "-i $d/key -o IdentitiesOnly=yes -o BatchMode=yes" "$d/calls"
has "default: the env file is uploaded" "POSTGRES_PASSWORD=local-secret" "$d/uploaded.env"
hasnt "default: the server's .env is not read" "ssh-cmd if [ -f" "$d/calls"
hasnt "default: no build" "docker build" "$d/calls"
hasnt "default: no build cache prune" "builder prune" "$d/remote.sh"
has "default: every unused old image is pruned (own server)" 'docker image prune -af --filter "until=168h" > /dev/null' "$d/remote.sh"
has "default: the app image is pulled" "docker compose pull --quiet < /dev/null" "$d/remote.sh"
has "default: IMAGE_PRELOADED empty" "IMAGE_PRELOADED=''" "$d/remote.sh"

# --- no DEPLOY_SSH_KEY: the runner's default identity ---
deploy 0123456789abcdef DEPLOY_ENV_FILE="$d/server.env" || { echo "FAIL deploy without key"; cat "$d/out"; fail=1; }
hasnt "no key: no -i" " -i " "$d/calls"
hasnt "no key: no IdentitiesOnly" "IdentitiesOnly" "$d/calls"
has "no key: host key still pinned" "-o StrictHostKeyChecking=yes" "$d/calls"
has "no key: BatchMode stays" "-o BatchMode=yes -o ConnectTimeout=20" "$d/calls"
has "no key: scp too" "scp -o BatchMode=yes" "$d/calls"
if deploy 0123456789abcdef DEPLOY_SSH_KEY="$d/missing.key" DEPLOY_ENV_FILE="$d/server.env"; then
  echo "FAIL a DEPLOY_SSH_KEY that does not exist accepted"; fail=1
fi
[[ ! -e "$d/calls" ]] || { echo "FAIL a missing key file must stop before ssh"; fail=1; }

# --- no DEPLOY_ENV_FILE: the env stays on the server ---
printf 'POSTGRES_PASSWORD=server-secret\nDOMAIN=old.example.com\nPUBLIC_URL=https://old.example.com\nIMAGE=spolu\nTAG=oldtag\nMAIL_FROM=Old <help@example.com>\n' > "$d/remote.env"
deploy 0123456789abcdef BEHIND_PROXY=1 HTTP_PORT=9003 MAIL_FROM_NAME='Help by eGrant' \
  || { echo "FAIL deploy with the env on the server"; cat "$d/out"; fail=1; }
has "server env: read from <root>/prod/.env" "ssh-cmd if [ -f '/opt/spolu/prod/.env' ]" "$d/calls"
has "server env: secrets kept" "POSTGRES_PASSWORD=server-secret" "$d/uploaded.env"
has "server env: DOMAIN overlaid" "DOMAIN=help.example.com" "$d/uploaded.env"
has "server env: PUBLIC_URL overlaid" "PUBLIC_URL=https://help.example.com" "$d/uploaded.env"
hasnt "server env: the old domain is gone" "old.example.com" "$d/uploaded.env"
has "server env: proxy keys" "COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml" "$d/uploaded.env"
has "server env: senders renamed" "MAIL_FROM=Help by eGrant <help@example.com>" "$d/uploaded.env"
hasnt "server env: secrets never printed" "server-secret" "$d/out"
rm -f "$d/remote.env"
if deploy 0123456789abcdef; then echo "FAIL a missing server .env accepted"; fail=1; fi
has "missing server .env: clear message" "put the env file there first" "$d/out"
hasnt "missing server .env: nothing uploaded" "ssh-cmd mkdir -p" "$d/calls"
hasnt "missing server .env: nothing copied" "scp " "$d/calls"
hasnt "missing server .env: nothing started" "ssh-cmd bash -s" "$d/calls"

# --- BUILD_ON_SERVER=1 ---
printf 'POSTGRES_PASSWORD=server-secret\n' > "$d/remote.env"
deploy "$commit" BUILD_ON_SERVER=1 REGISTRY_USER=u REGISTRY_PASSWORD=p \
  || { echo "FAIL build-on-server deploy"; cat "$d/out"; fail=1; }
has "build: checks for the image first" "ssh-cmd docker image inspect 'spolu:$commit'" "$d/calls"
has "build: docker build on the server" "docker build --build-arg APP_VERSION=$commit --label org.spolu.app=spolu --tag spolu:$commit -" "$d/calls"
has "build: with BuildKit" "DOCKER_BUILDKIT=1 docker build" "$d/calls"
tar -tf "$d/build.tar" 2>/dev/null | grep -qx Dockerfile || { echo "FAIL build: the context is git archive of the commit"; fail=1; }
has "build: then like a preloaded image" "IMAGE_PRELOADED=1" "$d/remote.sh"
has "build: the image carries the app label" "--label org.spolu.app=spolu" "$d/calls"
has "build: old build cache pruned, above 20 GB only" 'docker builder prune -f --filter "until=168h" --keep-storage 20GB' "$d/remote.sh"
has "build: only this app's images are pruned" 'docker image prune -af --filter "until=168h" --filter label=org.spolu.app=spolu' "$d/remote.sh"
hasnt "build: never a prune of every image" 'docker image prune -af --filter "until=168h" >' "$d/remote.sh"
has "build: no registry token sent" "REGISTRY_TOKEN=''" "$d/remote.sh"
deploy "$commit" BUILD_ON_SERVER=1 STUB_IMAGE_EXISTS=1 || { echo "FAIL rerun with the image there"; cat "$d/out"; fail=1; }
hasnt "build: skipped when the image is there" "docker build" "$d/calls"
has "build: says so" "already on srv.example.com" "$d/out"
has "build: rerun still starts it" "ssh-cmd bash -s" "$d/calls"
for bad in 0000000000000000000000000000000000000000 nosuchref; do
  if deploy "$bad" BUILD_ON_SERVER=1; then echo "FAIL BUILD_ON_SERVER with tag '$bad' accepted"; fail=1; fi
  has "build: tag '$bad' refused with a clear message" "not a commit" "$d/out"
  [[ ! -e "$d/calls" ]] || { echo "FAIL build: tag '$bad' reached the server"; fail=1; }
done
if deploy "$commit" BUILD_ON_SERVER=yes; then echo "FAIL BUILD_ON_SERVER=yes accepted"; fail=1; fi
[[ ! -e "$d/calls" ]] || { echo "FAIL a bad BUILD_ON_SERVER must stop before ssh"; fail=1; }
if deploy "$commit" BUILD_ON_SERVER=1 IMAGE=Registry/Spolu; then echo "FAIL an uppercase IMAGE accepted for the build"; fail=1; fi
[[ ! -e "$d/calls" ]] || { echo "FAIL a bad IMAGE must stop before ssh"; fail=1; }

[[ $fail -eq 0 ]] && echo "deploy-server-build.test.sh: all passed"
exit $fail
