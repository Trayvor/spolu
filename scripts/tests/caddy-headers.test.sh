#!/usr/bin/env bash
# Tests for the security headers of deploy/Caddyfile. With Docker available it adapts the real
# Caddyfile with the Caddy image of deploy/docker-compose.yml and checks the headers in Caddy's
# own JSON config (so {$DOMAIN} is really substituted); without Docker it checks the file text.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0
d="$(mktemp -d)"
trap 'rm -rf "$d"' EXIT

expect() { # name, needle, haystack file
  if ! grep -qF -- "$2" "$3"; then echo "FAIL $1: missing $2"; fail=1; fi
}

caddyfile="$root/deploy/Caddyfile"
checked="$caddyfile"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  caddy_image="$(sed -n 's/^ *image: \(caddy:.*\)$/\1/p' "$root/deploy/docker-compose.yml")"
  cp "$caddyfile" "$d/Caddyfile"
  echo '# no old domains' > "$d/redirects.caddy"
  if docker run --rm -v "$d:/etc/caddy:ro" -e DOMAIN=help.example.com "$caddy_image" \
    caddy adapt --config /etc/caddy/Caddyfile > "$d/adapted.json" 2> "$d/adapt.log"; then
    checked="$d/adapted.json"
  else
    echo "FAIL caddy adapt"; cat "$d/adapt.log"; fail=1
  fi
else
  echo "caddy-headers.test.sh: Docker not available, checking the Caddyfile text only"
fi

expect "HSTS" 'max-age=31536000; includeSubDomains' "$checked"
expect "nosniff" 'nosniff' "$checked"
expect "Referrer-Policy" 'strict-origin-when-cross-origin' "$checked"
expect "X-Frame-Options" 'DENY' "$checked"
expect "fallback CSP" "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" "$checked"
expect "Permissions-Policy microphone" 'microphone=(self)' "$checked"
expect "Server header removed" 'Server' "$checked"

# The enforced CSP comes from the app (apps/server/src/infra/http/security-headers.ts, ADR 0044):
# Caddy sets its short one only as a default ("?"), never over the app's, and no report-only one.
if ! grep -qE '^[[:space:]]*\?Content-Security-Policy ' "$caddyfile"; then
  echo "FAIL Caddy's Content-Security-Policy must be a default (?), not overwrite the app's"; fail=1
fi
if grep -qE '^[[:space:]]*Content-Security-Policy' "$caddyfile"; then
  echo "FAIL Caddy overwrites the app's Content-Security-Policy"; fail=1
fi
if grep -qF 'Content-Security-Policy-Report-Only' "$checked"; then
  echo "FAIL a Content-Security-Policy-Report-Only header is still set"; fail=1
fi
if grep -E "script-src[^;]*'unsafe-(inline|eval)'" "$caddyfile" >/dev/null; then
  echo "FAIL script-src allows unsafe-inline or unsafe-eval"; fail=1
fi

[[ $fail -eq 0 ]] && echo "caddy-headers.test.sh: all passed"
exit $fail
