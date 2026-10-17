#!/usr/bin/env bash
# Tests for run_parallel in scripts/lib.sh: the concurrent lint, format and typecheck step of ci.sh.
set -u
# shellcheck source=scripts/lib.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib.sh"
fail=0
d="$(mktemp -d)"

check() { # name, pass (true/false), detail
  if [[ "$2" == true ]]; then echo "ok $1"; else echo "FAIL $1: $3"; fail=1; fi
}
is() { if "$@"; then echo true; else echo false; fi; }
# shellcheck disable=SC2329 # called through is()
has() { # output, then texts that must appear in it in this order
  local rest="$1" part
  shift
  for part in "$@"; do
    [[ "$rest" == *"$part"* ]] || return 1
    rest="${rest#*"$part"}"
  done
}

out="$(run_parallel "First" "echo one" "Second" "echo two >&2" 2>&1)"; rc=$?
check "all pass: exit 0" "$(is test "$rc" -eq 0)" "exit $rc"
check "all pass: each output under its name, in the given order" \
  "$(is has "$out" First one "First: ok" Second two "Second: ok")" "$out"

out="$(run_parallel "Good" "true" "Bad" "echo broken; exit 3" "Late" "sleep 0.2; echo late" 2>&1)"; rc=$?
check "one fails: exit 1" "$(is test "$rc" -eq 1)" "exit $rc"
check "one fails: its output and exit code are shown" "$(is has "$out" broken "Bad: FAILED with exit 3")" "$out"
check "one fails: the others still run to the end" "$(is has "$out" late "Late: ok")" "$out"

# Concurrency: each step waits until both have started, so a sequential run would never finish.
out="$(run_parallel \
  "A" "touch '$d/a'; for _ in \$(seq 50); do [[ -f '$d/b' ]] && exit 0; sleep 0.1; done; exit 1" \
  "B" "touch '$d/b'; for _ in \$(seq 50); do [[ -f '$d/a' ]] && exit 0; sleep 0.1; done; exit 1" 2>&1)"; rc=$?
check "steps run at the same time" "$(is test "$rc" -eq 0)" "$out"

out="$(run_parallel "Odd" 2>&1)"; rc=$?
check "an odd argument count is a usage error" "$(is test "$rc" -eq 2)" "exit $rc"

rm -rf "$d"
exit $fail
