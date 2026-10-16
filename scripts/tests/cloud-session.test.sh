#!/usr/bin/env bash
# Tests for scripts/cloud-session.sh: outside a cloud session it changes nothing.
set -u
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/cloud-session.sh"
fail=0

# A copy of the repo layout the script needs, without a .env.
d="$(mktemp -d)"
mkdir -p "$d/scripts"
cp "$SCRIPT" "$(dirname "$SCRIPT")/lib.sh" "$d/scripts/"
echo "A=1" > "$d/.env.example"

out="$(env -u CLAUDE_CODE_REMOTE bash "$d/scripts/cloud-session.sh" 2>&1)"; rc=$?
if [[ $rc -ne 0 ]]; then echo "FAIL local: exit $rc"; fail=1; fi
if [[ -e "$d/.env" ]]; then echo "FAIL local: created .env"; fail=1; fi
if [[ -n "$out" ]]; then echo "FAIL local: printed output: $out"; fail=1; fi

out="$(CLAUDE_CODE_REMOTE=false bash "$d/scripts/cloud-session.sh" 2>&1)"; rc=$?
if [[ $rc -ne 0 || -e "$d/.env" ]]; then echo "FAIL remote=false: rc $rc"; fail=1; fi

rm -rf "$d"
[[ $fail -eq 0 ]] && echo "cloud-session.test.sh: all passed"
exit $fail
