#!/usr/bin/env bash
# Tests for scripts/deploy-local.sh (and the IMAGE_PRELOADED path of scripts/deploy.sh): config
# loading, the permission checks, the dirty-tree and origin/main refusals, the
# docker save | gzip | ssh 'gunzip | docker load' pipeline, and that the server does not pull the
# app image. docker, ssh, scp and curl are stubs; git is real, in a throwaway repository.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0
d="$(mktemp -d)"
trap 'rm -rf "$d"' EXIT

check() { # name, expected, actual
  if [[ "$2" != "$3" ]]; then echo "FAIL $1"; echo " expected: $2"; echo " actual:   $3"; fail=1; fi
}
has() { # name, needle, file
  grep -qF -- "$2" "$3" 2>/dev/null || { echo "FAIL $1: '$2' not in $(basename "$3")"; fail=1; }
}
hasnt() { # name, needle, file
  ! grep -qF -- "$2" "$3" 2>/dev/null || { echo "FAIL $1: '$2' found in $(basename "$3")"; fail=1; }
}

# --- A throwaway repository with the deploy scripts, pushed to a bare "origin" ---
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
repo="$d/repo"
mkdir -p "$repo/scripts"
cp "$root"/scripts/{lib,deploy,build-image,deploy-local}.sh "$repo/scripts/"
cp -R "$root/deploy" "$repo/deploy"
echo 'FROM scratch' > "$repo/Dockerfile"
git init -q -b main "$repo"
git -C "$repo" add -A
git -C "$repo" commit -qm init
git init -q --bare "$d/origin.git"
git -C "$repo" remote add origin "$d/origin.git"
git -C "$repo" push -q origin main
sha="$(git -C "$repo" rev-parse HEAD)"

# --- Stubs: every call is logged to $d/calls ---
mkdir "$d/bin" "$d/srv"
cat > "$d/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_DIR/calls"
case "$1 ${2:-}" in
  "buildx build") ;;
  "save "*) echo "IMAGES ${*:2}" ;;
  "compose config") printf 'app\nmedia\npostgres\ncaddy\nbackup\n' ;;
  *) ;;
esac
STUB
cat > "$d/bin/ssh" <<'STUB'
#!/usr/bin/env bash
while [[ $# -gt 0 && "$1" == -* ]]; do # -i/-o/-p each take a value
  [[ "$2" == UserKnownHostsFile=* ]] && cp "${2#UserKnownHostsFile=}" "$STUB_DIR/known_hosts_seen"
  shift 2
done
echo "ssh $1" >> "$STUB_DIR/calls"
shift
cmd="$*"
echo "ssh-cmd $cmd" >> "$STUB_DIR/calls"
case "$cmd" in
  "docker image inspect "*) [[ "${STUB_HAS_IMAGE:-0}" == 1 ]] ;;
  "uname -m") echo "${STUB_ARCH:-aarch64}" ;;
  "gunzip | docker load") gunzip > "$STUB_DIR/loaded" ;;
  "bash -s") cat > "$STUB_DIR/remote.sh" ;;
  "sed -n "*) echo oldtag ;;
  "mkdir -p "*) cat > "$STUB_DIR/uploaded.env" ;;
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
printf '{"status":"ok","version":"%s"}' "$STUB_VERSION"
STUB
chmod +x "$d/bin/"*
export STUB_DIR="$d" STUB_VERSION="$sha" PATH="$d/bin:$PATH"

# --- Settings in ~/.config/spolu (HOME is a temp dir): the owner's format, unquoted, with ~/ ---
home="$d/home"
cfg="$home/.config/spolu"
mkdir -p "$cfg"
chmod 700 "$cfg"
printf 'fake-private-key\n' > "$cfg/test.key"
printf 'POSTGRES_PASSWORD=pg-secret-value\nSUPERADMIN_EMAIL=admin@example.com\nMAIL_FROM=Old <help@example.com>\n' > "$cfg/test.env"
printf '203.0.113.7 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake\n203.0.113.7 ecdsa-sha2-nistp256 AAAAFake2\n' > "$cfg/test.known_hosts"
cat > "$cfg/test.deploy" <<'CONF'
# test environment
DEPLOY_HOST=203.0.113.7
DEPLOY_USER=deploy
DEPLOY_PORT=22
DEPLOY_KNOWN_HOSTS_FILE=~/.config/spolu/test.known_hosts
DEPLOY_SSH_KEY=~/.config/spolu/test.key
ENV_FILE=~/.config/spolu/test.env

DOMAIN=help.example.com
IMAGE=ghcr.io/example/spolu
REDIRECT_DOMAINS=spolu.example.com
MAIL_FROM_NAME=Help by eGrant
TICKETS_API_KEY="tickets-secret-value"
CONF
chmod 600 "$cfg/test.key" "$cfg/test.env" "$cfg/test.known_hosts" "$cfg/test.deploy"

run() { # args...; output in $d/out, exit code in $rc. Uses the default config path.
  rm -f "$d/calls" "$d/loaded" "$d/remote.sh" "$d/uploaded.env" "$d/known_hosts_seen"
  HOME="$home" REGISTRY_TOKEN=leftover-token MAIL_FROM_NAME=leftover-name \
    "$repo/scripts/deploy-local.sh" "$@" > "$d/out" 2>&1
  rc=$?
}

# 1. Happy path: build for arm64 (the test server), stream, deploy without pulling the app image.
run
check "deploys" 0 "$rc"
hasnt "the default platform needs no question to the server" "ssh-cmd uname -m" "$d/calls"
has "builds only arm64, into the local docker" "--platform linux/arm64 --load" "$d/calls"
check "pins the host keys from DEPLOY_KNOWN_HOSTS_FILE" "$(cat "$cfg/test.known_hosts")" "$(cat "$d/known_hosts_seen" 2>/dev/null)"
has "uses the key from ~/" "ssh deploy@203.0.113.7" "$d/calls"
has "tags the sha" "--tag ghcr.io/example/spolu:$sha" "$d/calls"
has "tags the env" "--tag ghcr.io/example/spolu:test" "$d/calls"
has "bakes the version in" "--build-arg APP_VERSION=$sha" "$d/calls"
check "docker save | gzip | ssh gunzip | docker load carries both tags" \
  "IMAGES ghcr.io/example/spolu:$sha ghcr.io/example/spolu:test" "$(cat "$d/loaded" 2>/dev/null)"
has "deploy.sh runs with IMAGE_PRELOADED" "IMAGE_PRELOADED=1" "$d/remote.sh"
hasnt "a registry token left in the shell does not reach the server" "leftover-token" "$d/remote.sh"
has "env file: domain from the config" "DOMAIN=help.example.com" "$d/uploaded.env"
has "env file: sender name from the config" "MAIL_FROM=Help by eGrant <help@example.com>" "$d/uploaded.env"
has "env file: tickets key from the config" "TICKETS_API_KEY=tickets-secret-value" "$d/uploaded.env"
has "env file: SUPERADMIN_EMAIL kept" "SUPERADMIN_EMAIL=admin@example.com" "$d/uploaded.env"
for secret in pg-secret-value tickets-secret-value fake-private-key; do
  hasnt "never prints $secret" "$secret" "$d/out"
done

# 2. The remote script, run here with a stub docker: no app pull, no login.
if [[ -f "$d/remote.sh" ]]; then
  : > "$d/srv/.env.upload"
  rm -f "$d/calls"
  sed "s|DEPLOY_DIR=/opt/spolu/test|DEPLOY_DIR=$d/srv|" "$d/remote.sh" | bash > /dev/null 2>&1
  check "remote script succeeds" 0 "$?"
  has "checks the loaded image is there" "docker image inspect ghcr.io/example/spolu:$sha" "$d/calls"
  has "pulls only the other services" "docker compose pull --quiet postgres caddy backup" "$d/calls"
  hasnt "no registry login" "docker login" "$d/calls"
  has "starts it" "docker compose up -d --remove-orphans" "$d/calls"
  has "pins TAG in .env" "TAG=$sha" "$d/srv/.env"
  # The registry path (GitHub/Jenkins) still pulls everything.
  sed -e "s|DEPLOY_DIR=/opt/spolu/test|DEPLOY_DIR=$d/srv|" -e "s|IMAGE_PRELOADED=1|IMAGE_PRELOADED=''|" \
    "$d/remote.sh" > "$d/remote-registry.sh"
  : > "$d/srv/.env.upload"
  rm -f "$d/calls"
  bash "$d/remote-registry.sh" > /dev/null 2>&1
  has "without IMAGE_PRELOADED: pulls every image" "docker compose pull --quiet" "$d/calls"
  hasnt "without IMAGE_PRELOADED: no image check" "docker image inspect" "$d/calls"
fi

# 3. DEPLOY_PLATFORM: explicit, or "auto" = ask the server.
cp "$cfg/test.deploy" "$d/base.deploy"
echo 'DEPLOY_PLATFORM=linux/amd64' >> "$cfg/test.deploy"
run
check "deploys with DEPLOY_PLATFORM" 0 "$rc"
has "builds amd64" "--platform linux/amd64 --load" "$d/calls"
hasnt "does not ask uname" "uname -m" "$d/calls"
cp "$d/base.deploy" "$cfg/test.deploy"
echo 'DEPLOY_PLATFORM=auto' >> "$cfg/test.deploy"
STUB_ARCH=x86_64 run
check "deploys with DEPLOY_PLATFORM=auto" 0 "$rc"
has "asks the server" "ssh-cmd uname -m" "$d/calls"
has "x86_64 server: builds amd64" "--platform linux/amd64 --load" "$d/calls"
cp "$d/base.deploy" "$cfg/test.deploy"

# 3b. Inline DEPLOY_KNOWN_HOSTS (quoted) instead of the file.
grep -v '^DEPLOY_KNOWN_HOSTS_FILE=' "$d/base.deploy" > "$cfg/test.deploy"
echo "DEPLOY_KNOWN_HOSTS='203.0.113.7 ssh-ed25519 AAAAInline'" >> "$cfg/test.deploy"
run
check "deploys with inline DEPLOY_KNOWN_HOSTS" 0 "$rc"
check "pins the inline host key" "203.0.113.7 ssh-ed25519 AAAAInline" "$(cat "$d/known_hosts_seen" 2>/dev/null)"
grep -v '^DEPLOY_KNOWN_HOSTS_FILE=' "$d/base.deploy" > "$cfg/test.deploy"
run
check "a config without known hosts is refused" 1 "$rc"
has "says so" "DEPLOY_KNOWN_HOSTS" "$d/out"

# 3c. The config is parsed, never run as shell code.
cp "$d/base.deploy" "$cfg/test.deploy"
echo "\$(touch $d/pwned)" >> "$cfg/test.deploy"
run
check "a line that is not KEY=value is refused" 1 "$rc"
cp "$d/base.deploy" "$cfg/test.deploy"
echo "DOMAIN=\$(touch $d/pwned)" >> "$cfg/test.deploy"
run
[[ ! -e "$d/pwned" ]] || { echo "FAIL the config was executed"; fail=1; }
cp "$d/base.deploy" "$cfg/test.deploy"
echo "PATH=/nowhere" >> "$cfg/test.deploy"
run
check "an unknown key is refused" 1 "$rc"
has "names it" "unknown key PATH" "$d/out"
cp "$d/base.deploy" "$cfg/test.deploy"

# 3d. HEALTH_CHECK_LOCAL in the config (a first deploy to a new server, DNS still on the old one):
# deploy.sh asks the server's local port; one left in the shell is ignored.
printf 'BEHIND_PROXY=1\nHTTP_PORT=8091\nHEALTH_CHECK_LOCAL=1\n' >> "$cfg/test.deploy"
run
check "deploys with HEALTH_CHECK_LOCAL" 0 "$rc"
has "asks the local port on the server" "ssh-cmd curl -sS --max-time 10 'http://127.0.0.1:8091/api/health'" "$d/calls"
cp "$d/base.deploy" "$cfg/test.deploy"
HEALTH_CHECK_LOCAL=1 run
check "deploys with HEALTH_CHECK_LOCAL left in the shell" 0 "$rc"
hasnt "a shell HEALTH_CHECK_LOCAL does not reach deploy.sh" "127.0.0.1:" "$d/calls"

# 4. The server already has the image: no build, no transfer, still deploys.
STUB_HAS_IMAGE=1 run
check "redeploy of an image on the server" 0 "$rc"
hasnt "no build" "buildx build" "$d/calls"
hasnt "no docker save" "docker save" "$d/calls"
has "still deploys" "ssh-cmd bash -s" "$d/calls"

# 5. Config file checks.
chmod 644 "$cfg/test.deploy"
run
check "a config readable by others is refused" 1 "$rc"
has "says to chmod 600" "chmod 600" "$d/out"
chmod 600 "$cfg/test.deploy"
SPOLU_DEPLOY_CONFIG="$d/missing.deploy" run
check "a missing config is refused" 1 "$rc"
grep -v '^DOMAIN=' "$d/base.deploy" > "$d/nodomain.deploy"
chmod 600 "$d/nodomain.deploy"
SPOLU_DEPLOY_CONFIG="$d/nodomain.deploy" run
check "SPOLU_DEPLOY_CONFIG is read; a config without DOMAIN is refused" 1 "$rc"
has "names the missing key" "DOMAIN is missing" "$d/out"
chmod 644 "$cfg/test.key"
run
check "an SSH key readable by others is refused" 1 "$rc"
chmod 600 "$cfg/test.key"
chmod 640 "$cfg/test.env"
run
check "an env file readable by the group is refused" 1 "$rc"
chmod 600 "$cfg/test.env"
[[ -f "$d/calls" ]] && hasnt "nothing reached the server on refusals" "ssh " "$d/calls"

# 6. Dirty tree and commits not on origin/main.
echo change >> "$repo/Dockerfile"
run
check "a dirty tree is refused" 1 "$rc"
has "says why" "uncommitted changes" "$d/out"
[[ -f "$d/calls" ]] && hasnt "nothing reached the server for a dirty tree" "ssh " "$d/calls"
run --force-ref
check "--force-ref allows a dirty tree" 0 "$rc"
git -C "$repo" commit -qam local
local_sha="$(git -C "$repo" rev-parse HEAD)"
run
check "a commit not on origin/main is refused" 1 "$rc"
has "says why" "is not on origin/main" "$d/out"
STUB_VERSION="$local_sha" run --force-ref
check "--force-ref allows a commit not on origin/main" 0 "$rc"
has "deploys that commit" "--tag ghcr.io/example/spolu:$local_sha" "$d/calls"
run test "$sha"
check "an older sha on origin/main is allowed" 0 "$rc"
has "builds the given sha" "--tag ghcr.io/example/spolu:$sha" "$d/calls"
run test not-a-ref
check "an unknown ref is refused" 1 "$rc"
run Bad_Env
check "a bad env name is refused" 1 "$rc"

[[ $fail -eq 0 ]] && echo "deploy-local.test.sh: all passed"
exit $fail
