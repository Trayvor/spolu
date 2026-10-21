#!/usr/bin/env bash
# Tests for the security headers of deploy/Caddyfile and deploy/Caddyfile.proxy (proxy mode,
# ADR 0068): both must set the same ones. With Docker available it adapts each real Caddyfile
# with the Caddy image of deploy/docker-compose.yml and checks the headers in Caddy's own JSON
# config (so {$DOMAIN} is really substituted); without Docker it checks the file text.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0
d="$(mktemp -d)"
trap 'rm -rf "$d"' EXIT

expect() { # name, needle, haystack file
  if ! grep -qF -- "$2" "$3"; then echo "FAIL $1: missing $2"; fail=1; fi
}

docker_ok=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker_ok=1
  caddy_image="$(sed -n 's/^ *image: \(caddy:.*\)$/\1/p' "$root/deploy/docker-compose.yml")"
else
  echo "caddy-headers.test.sh: Docker not available, checking the Caddyfile text only"
fi

for name in Caddyfile Caddyfile.proxy; do
  caddyfile="$root/deploy/$name"
  checked="$caddyfile"
  if (( docker_ok )); then
    rm -rf "$d/etc" && mkdir "$d/etc"
    cp "$caddyfile" "$d/etc/Caddyfile"
    echo '# no old domains' > "$d/etc/redirects.caddy"
    if docker run --rm -v "$d/etc:/etc/caddy:ro" -e DOMAIN=help.example.com \
      -e 'TRUSTED_PROXIES=127.0.0.1/8 172.16.0.0/12' "$caddy_image" \
      caddy adapt --config /etc/caddy/Caddyfile > "$d/adapted.json" 2> "$d/adapt.log"; then
      checked="$d/adapted.json"
    else
      echo "FAIL caddy adapt ($name)"; cat "$d/adapt.log"; fail=1
    fi
  fi

  expect "$name HSTS" 'max-age=31536000; includeSubDomains' "$checked"
  expect "$name nosniff" 'nosniff' "$checked"
  expect "$name Referrer-Policy" 'strict-origin-when-cross-origin' "$checked"
  expect "$name X-Frame-Options" 'DENY' "$checked"
  expect "$name fallback CSP" "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" "$checked"
  expect "$name Permissions-Policy microphone" 'microphone=(self)' "$checked"
  expect "$name Server header removed" 'Server' "$checked"
  expect "$name compression" 'zstd' "$checked"

  # The enforced CSP comes from the app (apps/server/src/infra/http/security-headers.ts, ADR 0044):
  # Caddy sets its short one only as a default ("?"), never over the app's, and no report-only one.
  if ! grep -qE '^[[:space:]]*\?Content-Security-Policy ' "$caddyfile"; then
    echo "FAIL $name: Caddy's Content-Security-Policy must be a default (?), not overwrite the app's"; fail=1
  fi
  if grep -qE '^[[:space:]]*Content-Security-Policy' "$caddyfile"; then
    echo "FAIL $name: Caddy overwrites the app's Content-Security-Policy"; fail=1
  fi
  if grep -qF 'Content-Security-Policy-Report-Only' "$checked"; then
    echo "FAIL $name: a Content-Security-Policy-Report-Only header is still set"; fail=1
  fi
  if grep -E "script-src[^;]*'unsafe-(inline|eval)'" "$caddyfile" >/dev/null; then
    echo "FAIL $name: script-src allows unsafe-inline or unsafe-eval"; fail=1
  fi
done

# Both files set exactly the same header lines (comments aside).
headers() { sed -n '/^	header {/,/^	}/p' "$1" | grep -vE '^[[:space:]]*#'; }
if [[ "$(headers "$root/deploy/Caddyfile")" != "$(headers "$root/deploy/Caddyfile.proxy")" ]]; then
  echo "FAIL deploy/Caddyfile and deploy/Caddyfile.proxy set different headers"
  diff <(headers "$root/deploy/Caddyfile") <(headers "$root/deploy/Caddyfile.proxy")
  fail=1
fi
[[ -n "$(headers "$root/deploy/Caddyfile")" ]] || { echo "FAIL no header block found in deploy/Caddyfile"; fail=1; }

[[ $fail -eq 0 ]] && echo "caddy-headers.test.sh: all passed"
exit $fail
