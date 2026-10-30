#!/usr/bin/env bash
# Tests for proxy mode (BEHIND_PROXY=1, ADR 0068): proxy_mode and deploy_env in scripts/lib.sh,
# and scripts/deploy.sh with stubbed ssh, scp and curl: the proxy files go up, the server's .env
# switches compose to docker-compose.proxy.yml only in proxy mode, HEALTH_CHECK_LOCAL asks the
# server instead of the public URL, and the registry login is generic (REGISTRY, REGISTRY_PASSWORD).
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/lib.sh
source "$root/scripts/lib.sh"
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

# --- proxy_mode ---
for off in '' 0; do
  if (BEHIND_PROXY="$off" HTTP_PORT='' proxy_mode) 2>/dev/null; then
    echo "FAIL BEHIND_PROXY='$off' is not proxy mode"; fail=1
  fi
done
(BEHIND_PROXY=1 HTTP_PORT=8091 proxy_mode) || { echo "FAIL BEHIND_PROXY=1 HTTP_PORT=8091 is proxy mode"; fail=1; }
for bad in '' 80 1023 65536 99999 08091 '8091 ' abc; do
  out="$( (BEHIND_PROXY=1 HTTP_PORT="$bad" proxy_mode) 2>&1)" && { echo "FAIL HTTP_PORT='$bad' accepted"; fail=1; }
  [[ "$out" == *"needs HTTP_PORT"* ]] || { echo "FAIL HTTP_PORT='$bad': no clear message ($out)"; fail=1; }
done
for bad in yes true 2; do
  if (BEHIND_PROXY="$bad" HTTP_PORT=8091 proxy_mode) >/dev/null 2>&1; then
    echo "FAIL BEHIND_PROXY='$bad' accepted"; fail=1
  fi
done

# --- deploy_env ---
printf 'A=1\nBEHIND_PROXY=1\nHTTP_PORT=1111\nCOMPOSE_FILE=evil.yml\nB=2\n' > "$d/in.env"
out="$(unset BEHIND_PROXY HTTP_PORT REDIRECT_DOMAINS; DOMAIN=help.example.com deploy_env "$d/in.env")"
check "default mode: no proxy keys, not even the file's" \
  "$(printf 'A=1\nB=2\nDOMAIN=help.example.com\nPUBLIC_URL=https://help.example.com\nREDIRECT_DOMAINS=')" "$out"
out="$(unset REDIRECT_DOMAINS; BEHIND_PROXY=1 HTTP_PORT=8091 DOMAIN=help.example.com deploy_env "$d/in.env")"
check "proxy mode: BEHIND_PROXY, HTTP_PORT and COMPOSE_FILE from the variables" \
  "$(printf 'A=1\nB=2\nDOMAIN=help.example.com\nPUBLIC_URL=https://help.example.com\nREDIRECT_DOMAINS=\nBEHIND_PROXY=1\nHTTP_PORT=8091\nCOMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml')" "$out"

# --- DOCKER_SUBNET (ADR 0074) ---
out="$(unset REDIRECT_DOMAINS BEHIND_PROXY; DOCKER_SUBNET=172.30.42.0/24 DOMAIN=help.example.com deploy_env "$d/in.env")"
check "subnet alone: DOCKER_SUBNET and the subnet file" \
  "$(printf 'A=1\nB=2\nDOMAIN=help.example.com\nPUBLIC_URL=https://help.example.com\nREDIRECT_DOMAINS=\nDOCKER_SUBNET=172.30.42.0/24\nCOMPOSE_FILE=docker-compose.yml:docker-compose.subnet.yml')" "$out"
out="$(unset REDIRECT_DOMAINS; BEHIND_PROXY=1 HTTP_PORT=8091 DOCKER_SUBNET=172.30.42.0/24 DOMAIN=help.example.com deploy_env "$d/in.env" | grep '^COMPOSE_FILE=')"
check "proxy and subnet: both override files" "COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml:docker-compose.subnet.yml" "$out"
printf 'DOCKER_SUBNET=10.0.0.0/8\nA=1\n' > "$d/sub.env"
out="$(unset REDIRECT_DOMAINS BEHIND_PROXY DOCKER_SUBNET; DOMAIN=help.example.com deploy_env "$d/sub.env")"
check "no DOCKER_SUBNET: the file's is dropped, no COMPOSE_FILE" \
  "$(printf 'A=1\nDOMAIN=help.example.com\nPUBLIC_URL=https://help.example.com\nREDIRECT_DOMAINS=')" "$out"
for ok in '' 172.30.42.0/24 10.20.0.0/16 192.168.5.0/28; do
  (DOCKER_SUBNET="$ok" docker_subnet) || { echo "FAIL DOCKER_SUBNET='$ok' refused"; fail=1; }
done
for bad in 172.30.42.0 172.30.42.0/8 172.30.42.0/30 8.8.8.0/24 '172.30.42.0/24;rm' 300.1.1.0/24 abc; do
  out="$( (DOCKER_SUBNET="$bad" docker_subnet) 2>&1)" && { echo "FAIL DOCKER_SUBNET='$bad' accepted"; fail=1; }
  [[ "$out" == *"DOCKER_SUBNET must be"* ]] || { echo "FAIL DOCKER_SUBNET='$bad': no clear message ($out)"; fail=1; }
done

# --- deploy.sh with stubs ---
mkdir "$d/bin"
cat > "$d/bin/ssh" <<'STUB'
#!/usr/bin/env bash
while [[ $# -gt 0 && "$1" == -* ]]; do shift 2; done # -i/-o/-p each take a value
shift # user@host
cmd="$*"
echo "ssh-cmd $cmd" >> "$STUB_DIR/calls"
case "$cmd" in
  "bash -s") cat > "$STUB_DIR/remote.sh" ;;
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
echo "curl $*" >> "$STUB_DIR/calls"
printf '{"status":"ok","version":"%s"}' "$STUB_VERSION"
STUB
chmod +x "$d/bin/"*
touch "$d/key"
printf 'POSTGRES_PASSWORD=x\n' > "$d/server.env"
tag=0123456789abcdef

deploy() { # extra env assignments...; runs deploy.sh prod <tag>
  rm -f "$d/calls" "$d/remote.sh" "$d/uploaded.env"
  env -u BEHIND_PROXY -u HTTP_PORT -u HEALTH_CHECK_LOCAL -u REGISTRY -u REGISTRY_TOKEN \
    -u REGISTRY_PASSWORD -u REGISTRY_USER -u REDIRECT_DOMAINS -u IMAGE_PRELOADED -u DEPLOY_ROOT -u DOCKER_SUBNET \
    PATH="$d/bin:$PATH" STUB_DIR="$d" STUB_VERSION="$tag" \
    DEPLOY_HOST=srv.example.com DEPLOY_USER=deploy DEPLOY_SSH_KEY="$d/key" \
    DEPLOY_ENV_FILE="$d/server.env" DEPLOY_KNOWN_HOSTS='srv.example.com ssh-ed25519 AAAA' \
    IMAGE=registry.example.com:5000/egrant/spolu DOMAIN=help.example.com "$@" \
    bash "$root/scripts/deploy.sh" prod "$tag" > "$d/out" 2>&1
}

deploy || { echo "FAIL default deploy"; cat "$d/out"; fail=1; }
hasnt "default mode: no COMPOSE_FILE on the server" "COMPOSE_FILE=" "$d/uploaded.env"
hasnt "default mode: no BEHIND_PROXY on the server" "BEHIND_PROXY=" "$d/uploaded.env"
has "default mode: public health check" "curl -sS --fail-with-body --max-time 10 https://help.example.com/api/health" "$d/calls"
has "default mode: registry from IMAGE" "REGISTRY=registry.example.com:5000 " "$d/remote.sh"
has "proxy and subnet files are uploaded" "deploy/docker-compose.proxy.yml deploy/docker-compose.subnet.yml deploy/Caddyfile deploy/Caddyfile.proxy" "$d/calls"
has "files go to /opt/spolu/prod" "deploy@srv.example.com:/opt/spolu/prod/" "$d/calls"
has "the server's .env goes to /opt/spolu/prod" "ssh-cmd mkdir -p '/opt/spolu/prod'" "$d/calls"

# DEPLOY_ROOT: the company server keeps its environments elsewhere (owner, 2026-10-28).
deploy DEPLOY_ROOT=/home/knbform/spolu/ || { echo "FAIL DEPLOY_ROOT deploy"; cat "$d/out"; fail=1; }
has "DEPLOY_ROOT: files go to <root>/prod" "deploy@srv.example.com:/home/knbform/spolu/prod/" "$d/calls"
has "DEPLOY_ROOT: the .env goes to <root>/prod" "ssh-cmd mkdir -p '/home/knbform/spolu/prod'" "$d/calls"
has "DEPLOY_ROOT: the remote script runs in <root>/prod" "DEPLOY_DIR=/home/knbform/spolu/prod " "$d/remote.sh"
hasnt "DEPLOY_ROOT: nothing in /opt/spolu" "/opt/spolu" "$d/calls"
# shellcheck disable=SC2016 # a literal $HOME, as a config file could hold it
for bad in relative/path '/a b' '/x;rm' '/a/../b' '/$HOME'; do
  if deploy DEPLOY_ROOT="$bad"; then echo "FAIL DEPLOY_ROOT='$bad' accepted"; fail=1; fi
  has "DEPLOY_ROOT='$bad': clear message" "DEPLOY_ROOT must be" "$d/out"
  [[ ! -s "$d/calls" ]] || { echo "FAIL DEPLOY_ROOT='$bad': reached the server"; fail=1; }
done

deploy BEHIND_PROXY=1 HTTP_PORT=8091 REGISTRY=registry.example.com REGISTRY_USER=jenkins REGISTRY_PASSWORD=s3cret-pass \
  || { echo "FAIL proxy deploy"; cat "$d/out"; fail=1; }
has "proxy mode: COMPOSE_FILE on the server" "COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml" "$d/uploaded.env"
has "proxy mode: HTTP_PORT on the server" "HTTP_PORT=8091" "$d/uploaded.env"
has "proxy mode: public health check through the proxy" "https://help.example.com/api/health" "$d/calls"
has "REGISTRY overrides the host from IMAGE" "REGISTRY=registry.example.com " "$d/remote.sh"
has "REGISTRY_PASSWORD is the registry token" "REGISTRY_TOKEN=s3cret-pass" "$d/remote.sh"
hasnt "the registry password is never printed" "s3cret-pass" "$d/out"

deploy BEHIND_PROXY=1 HTTP_PORT=8091 DOCKER_SUBNET=172.30.42.0/24 || { echo "FAIL subnet deploy"; cat "$d/out"; fail=1; }
has "subnet: DOCKER_SUBNET on the server" "DOCKER_SUBNET=172.30.42.0/24" "$d/uploaded.env"
has "subnet: compose adds the subnet file" "COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml:docker-compose.subnet.yml" "$d/uploaded.env"

deploy BEHIND_PROXY=1 HTTP_PORT=8091 HEALTH_CHECK_LOCAL=1 || { echo "FAIL local health deploy"; cat "$d/out"; fail=1; }
has "HEALTH_CHECK_LOCAL asks the server" "ssh-cmd curl -sS --fail-with-body --max-time 10 'http://127.0.0.1:8091/api/health'" "$d/calls"
hasnt "HEALTH_CHECK_LOCAL skips the public URL" "curl -sS --fail-with-body --max-time 10 https://" "$d/calls"

if deploy HEALTH_CHECK_LOCAL=1; then echo "FAIL HEALTH_CHECK_LOCAL without proxy mode accepted"; fail=1; fi
if deploy BEHIND_PROXY=1; then echo "FAIL proxy mode without HTTP_PORT accepted"; fail=1; fi
if deploy DOCKER_SUBNET=8.8.8.0/24; then echo "FAIL a public DOCKER_SUBNET accepted"; fail=1; fi
[[ ! -e "$d/calls" ]] || { echo "FAIL a bad proxy setting must stop before the server is contacted"; fail=1; }

deploy BEHIND_PROXY=1 HTTP_PORT=8091 REDIRECT_DOMAINS=spolu.example.com || { echo "FAIL proxy deploy with redirects"; fail=1; }
has "proxy mode: redirects left to the host's web server" "must be redirected by the host's web server" "$d/out"

# --- Compose: the override publishes only 127.0.0.1:$HTTP_PORT (Docker Compose needed) ---
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  mkdir "$d/srv"
  cp "$root/deploy/docker-compose.yml" "$root/deploy/docker-compose.proxy.yml" "$d/srv/"
  printf 'IMAGE=x\nTAG=y\nDOMAIN=help.example.com\nPOSTGRES_PASSWORD=p\n' > "$d/srv/.env"
  (cd "$d/srv" && docker compose config --format json) > "$d/default.json" 2>"$d/compose.err" \
    || { echo "FAIL compose config (default)"; cat "$d/compose.err"; fail=1; }
  has "default mode: Caddy publishes 443" '"published": "443"' "$d/default.json"
  printf 'HTTP_PORT=8091\nCOMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml\n' >> "$d/srv/.env"
  (cd "$d/srv" && docker compose config --format json) > "$d/proxy.json" 2>"$d/compose.err" \
    || { echo "FAIL compose config (proxy)"; cat "$d/compose.err"; fail=1; }
  has "proxy mode: Caddy on 127.0.0.1" '"host_ip": "127.0.0.1"' "$d/proxy.json"
  has "proxy mode: on HTTP_PORT" '"published": "8091"' "$d/proxy.json"
  hasnt "proxy mode: no 443" '"published": "443"' "$d/proxy.json"
  hasnt "proxy mode: no public 80" '"published": "80"' "$d/proxy.json"
  has "proxy mode: Caddyfile.proxy mounted" 'Caddyfile.proxy' "$d/proxy.json"
  cp "$root/deploy/docker-compose.subnet.yml" "$d/srv/"
  printf 'DOCKER_SUBNET=172.30.42.0/24\nCOMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml:docker-compose.subnet.yml\n' >> "$d/srv/.env"
  (cd "$d/srv" && docker compose config --format json) > "$d/subnet.json" 2>"$d/compose.err" \
    || { echo "FAIL compose config (subnet)"; cat "$d/compose.err"; fail=1; }
  has "subnet: the default network gets it" '"subnet": "172.30.42.0/24"' "$d/subnet.json"
  has "subnet: proxy mode still on" '"published": "8091"' "$d/subnet.json"
else
  echo "deploy-proxy.test.sh: Docker Compose not available, skipped the compose checks"
fi

[[ $fail -eq 0 ]] && echo "deploy-proxy.test.sh: all passed"
exit $fail
