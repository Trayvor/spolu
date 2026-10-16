#!/usr/bin/env bash
# Tests for deploy_env in scripts/lib.sh: the env file the server gets.
set -u
# shellcheck source=scripts/lib.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib.sh"
fail=0
d="$(mktemp -d)"
printf 'A=1\nDOMAIN=old.example.com\nPUBLIC_URL=https://old.example.com\nTICKETS_API_KEY=old-key-0000000000\nB=2\n' > "$d/in.env"

check() { # name, expected, actual
  if [[ "$2" != "$3" ]]; then echo "FAIL $1"; echo " expected: $2"; echo " actual:   $3"; fail=1; fi
}

out="$(DOMAIN=new.example.com deploy_env "$d/in.env")"
check "domain and public url follow DOMAIN, the rest stays" \
  "$(printf 'A=1\nTICKETS_API_KEY=old-key-0000000000\nB=2\nDOMAIN=new.example.com\nPUBLIC_URL=https://new.example.com')" "$out"

out="$(DOMAIN=new.example.com TICKETS_API_KEY=new-key-1111111111 deploy_env "$d/in.env")"
check "a TICKETS_API_KEY replaces the file's" \
  "$(printf 'A=1\nB=2\nDOMAIN=new.example.com\nPUBLIC_URL=https://new.example.com\nTICKETS_API_KEY=new-key-1111111111')" "$out"

out="$(DOMAIN=new.example.com TICKETS_API_KEY='' deploy_env "$d/in.env")"
check "an empty TICKETS_API_KEY keeps the file's" \
  "$(printf 'A=1\nTICKETS_API_KEY=old-key-0000000000\nB=2\nDOMAIN=new.example.com\nPUBLIC_URL=https://new.example.com')" "$out"

rm -rf "$d"
[[ $fail -eq 0 ]] && echo "deploy-env.test.sh: all passed"
exit $fail
