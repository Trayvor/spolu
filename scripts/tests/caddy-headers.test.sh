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
# shellcheck disable=SC2016 # a Caddy placeholder, not a shell one
domain='{$DOMAIN}'
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  caddy_image="$(sed -n 's/^ *image: \(caddy:.*\)$/\1/p' "$root/deploy/docker-compose.yml")"
  cp "$caddyfile" "$d/Caddyfile"
  echo '# no old domains' > "$d/redirects.caddy"
  if docker run --rm -v "$d:/etc/caddy:ro" -e DOMAIN=help.example.com "$caddy_image" \
    caddy adapt --config /etc/caddy/Caddyfile > "$d/adapted.json" 2> "$d/adapt.log"; then
    checked="$d/adapted.json"
    domain='help.example.com'
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
expect "enforced framing CSP" "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" "$checked"
expect "report-only CSP" 'Content-Security-Policy-Report-Only' "$checked"
expect "CSP script-src" "script-src 'self';" "$checked"
expect "CSP Socket.IO" "connect-src 'self' wss://$domain;" "$checked"
expect "Permissions-Policy microphone" 'microphone=(self)' "$checked"
expect "Server header removed" 'Server' "$checked"

# The CSP must not allow inline or eval'd scripts.
if grep -E "script-src[^;]*'unsafe-(inline|eval)'" "$caddyfile" >/dev/null; then
  echo "FAIL script-src allows unsafe-inline or unsafe-eval"; fail=1
fi

[[ $fail -eq 0 ]] && echo "caddy-headers.test.sh: all passed"
exit $fail
