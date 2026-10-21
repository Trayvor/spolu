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
    -u REGISTRY_PASSWORD -u REGISTRY_USER -u REDIRECT_DOMAINS -u IMAGE_PRELOADED \
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
has "proxy files are uploaded" "deploy/docker-compose.proxy.yml deploy/Caddyfile deploy/Caddyfile.proxy" "$d/calls"
has "files go to /opt/spolu/prod" "deploy@srv.example.com:/opt/spolu/prod/" "$d/calls"

deploy BEHIND_PROXY=1 HTTP_PORT=8091 REGISTRY=registry.example.com REGISTRY_USER=jenkins REGISTRY_PASSWORD=s3cret-pass \
  || { echo "FAIL proxy deploy"; cat "$d/out"; fail=1; }
has "proxy mode: COMPOSE_FILE on the server" "COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml" "$d/uploaded.env"
has "proxy mode: HTTP_PORT on the server" "HTTP_PORT=8091" "$d/uploaded.env"
has "proxy mode: public health check through the proxy" "https://help.example.com/api/health" "$d/calls"
has "REGISTRY overrides the host from IMAGE" "REGISTRY=registry.example.com " "$d/remote.sh"
has "REGISTRY_PASSWORD is the registry token" "REGISTRY_TOKEN=s3cret-pass" "$d/remote.sh"
hasnt "the registry password is never printed" "s3cret-pass" "$d/out"

deploy BEHIND_PROXY=1 HTTP_PORT=8091 HEALTH_CHECK_LOCAL=1 || { echo "FAIL local health deploy"; cat "$d/out"; fail=1; }
has "HEALTH_CHECK_LOCAL asks the server" "ssh-cmd curl -sS --fail-with-body --max-time 10 'http://127.0.0.1:8091/api/health'" "$d/calls"
hasnt "HEALTH_CHECK_LOCAL skips the public URL" "curl -sS --fail-with-body --max-time 10 https://" "$d/calls"

if deploy HEALTH_CHECK_LOCAL=1; then echo "FAIL HEALTH_CHECK_LOCAL without proxy mode accepted"; fail=1; fi
if deploy BEHIND_PROXY=1; then echo "FAIL proxy mode without HTTP_PORT accepted"; fail=1; fi
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
else
  echo "deploy-proxy.test.sh: Docker Compose not available, skipped the compose checks"
fi

[[ $fail -eq 0 ]] && echo "deploy-proxy.test.sh: all passed"
exit $fail
