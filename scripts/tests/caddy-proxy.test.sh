#!/usr/bin/env bash
# Tests for deploy/Caddyfile.proxy (proxy mode, ADR 0068). Needs Docker (skipped without it):
#   1. caddy validate of the real file, with the default and a custom TRUSTED_PROXIES;
#   2. the client IP the app gets: a fake "app" (Caddy answering with the X-Forwarded-* headers it
#      received) behind Caddyfile.proxy, called from a "proxy" container like Apache would be.
#      From a trusted proxy the app must see the right-most X-Forwarded-For entry (the one the
#      proxy appended) as the only one, and X-Forwarded-Proto https; from an untrusted address it
#      must see that address and http, whatever the client wrote in the headers.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0
d="$(mktemp -d)"
net="spolu-caddy-proxy-test-$$"
cleanup() {
  docker rm -f "$net-app" "$net-caddy" >/dev/null 2>&1
  docker network rm "$net" >/dev/null 2>&1
  rm -rf "$d"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "caddy-proxy.test.sh: Docker not available, skipped"
  exit 0
fi
caddy_image="$(sed -n 's/^ *image: \(caddy:.*\)$/\1/p' "$root/deploy/docker-compose.yml")"
default_trusted="$(sed -n "s/^ *TRUSTED_PROXIES: \${TRUSTED_PROXIES:-\(.*\)}$/\1/p" "$root/deploy/docker-compose.proxy.yml")"
[[ -n "$default_trusted" ]] || { echo "FAIL no TRUSTED_PROXIES default in docker-compose.proxy.yml"; exit 1; }
mkdir "$d/proxy" "$d/app"
cp "$root/deploy/Caddyfile.proxy" "$d/proxy/Caddyfile"

validate() { # name, TRUSTED_PROXIES
  if ! docker run --rm -v "$d/proxy:/etc/caddy:ro" -e "TRUSTED_PROXIES=$2" "$caddy_image" \
    caddy validate --config /etc/caddy/Caddyfile > "$d/validate.log" 2>&1; then
    echo "FAIL caddy validate ($1)"; cat "$d/validate.log"; fail=1
  fi
}
validate "default trusted proxies" "$default_trusted"
validate "custom trusted proxies" "127.0.0.1/32 10.20.0.0/16"

# The fake app: answers "<X-Forwarded-For>|<X-Forwarded-Proto>" on port 3000.
cat > "$d/app/Caddyfile" <<'CADDY'
:3000 {
	respond "{header.X-Forwarded-For}|{header.X-Forwarded-Proto}"
}
CADDY
docker network create "$net" >/dev/null
docker run -d --name "$net-app" --network "$net" --network-alias app \
  -v "$d/app:/etc/caddy:ro" "$caddy_image" >/dev/null

ask() { # TRUSTED_PROXIES; prints what the app received for a request carrying spoofed headers
  docker rm -f "$net-caddy" >/dev/null 2>&1
  docker run -d --name "$net-caddy" --network "$net" -e "TRUSTED_PROXIES=$1" \
    -v "$d/proxy:/etc/caddy:ro" "$caddy_image" >/dev/null
  local i out=""
  for i in $(seq 1 30); do
    # Apache appends the address it saw (203.0.113.9) to what the client sent (198.51.100.1).
    out="$(docker run --rm --network "$net" "$caddy_image" wget -qO- \
      --header 'X-Forwarded-For: 198.51.100.1, 203.0.113.9' --header 'X-Forwarded-Proto: https' \
      "http://$net-caddy/" 2>/dev/null)" && break
    sleep 1
  done
  printf '%s' "$out"
}
check() { # name, expected, actual
  if [[ "$2" != "$3" ]]; then echo "FAIL $1"; echo " expected: $2"; echo " actual:   $3"; fail=1; fi
}

subnet="$(docker network inspect "$net" --format '{{(index .IPAM.Config 0).Subnet}}')"
check "from a trusted proxy the app sees only the client the proxy appended, over https" \
  "203.0.113.9|https" "$(ask "$subnet")"

out="$(ask "127.0.0.1/32")"
caller="${out%%|*}"
if [[ "$caller" == *198.51.100.1* || "$caller" == *203.0.113.9* || "$caller" == *,* ]]; then
  echo "FAIL from an untrusted address the X-Forwarded-For header must be ignored: $out"; fail=1
fi
check "from an untrusted address X-Forwarded-Proto is Caddy's own" "http" "${out#*|}"
[[ -n "$caller" ]] || { echo "FAIL from an untrusted address the app must still get the caller's IP: $out"; fail=1; }

[[ $fail -eq 0 ]] && echo "caddy-proxy.test.sh: all passed"
exit $fail
