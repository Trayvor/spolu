#!/usr/bin/env bash
# Tests for ci_run_id and isolate_local_run in scripts/lib.sh: per-run names for parallel ci.sh runs.
# shellcheck disable=SC2030,SC2031 # each case runs in its own subshell on purpose
set -u
# shellcheck source=scripts/lib.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib.sh"
fail=0

check() { # name, expected, actual
  if [[ "$2" == "$3" ]]; then echo "ok $1"; else echo "FAIL $1: expected '$2', got '$3'"; fail=1; fi
}
# shellcheck disable=SC2329 # called by isolate_local_run
free_port() { echo 4567; }

a="$(ci_run_id "agent-A0b7 ad" "/x/agent-A0b7 ad")"
check "id is lowercase, safe characters only" "yes" "$([[ "$a" =~ ^[a-z0-9_]+_[0-9]{6}$ ]] && echo yes)"
check "id is stable" "$a" "$(ci_run_id "agent-A0b7 ad" "/x/agent-A0b7 ad")"
check "same name, other path: other id" "no" "$([[ "$(ci_run_id wt /a/wt)" == "$(ci_run_id wt /b/wt)" ]] && echo yes || echo no)"
long="$(ci_run_id "a-very-very-long-worktree-directory-name" /x)"
check "long names are cut (database names stop at 63 characters)" "yes" "$([[ ${#long} -le 23 ]] && echo yes)"

out="$(unset CI CI_RUN_ID TEST_DATABASE_URL E2E_DATABASE_URL E2E_PORT E2E_SUPERADMIN_EMAIL
  isolate_local_run
  echo "$TEST_DATABASE_URL $E2E_DATABASE_URL $E2E_PORT $E2E_SUPERADMIN_EMAIL")"
id="$(ci_run_id "$(basename "$PWD")" "$PWD")"
check "local: per-run databases, port and superadmin" \
  "postgres://spolu:spolu@localhost:5432/spolu_test_ci_$id postgres://spolu:spolu@localhost:5432/spolu_e2e_$id 4567 admin-$id@example.com" "$out"

out="$(unset CI E2E_PORT; TEST_DATABASE_URL=postgres://x/mine; E2E_DATABASE_URL=postgres://x/mine_e2e
  isolate_local_run
  echo "$TEST_DATABASE_URL $E2E_DATABASE_URL")"
check "values set by the caller win" "postgres://x/mine postgres://x/mine_e2e" "$out"

out="$(unset TEST_DATABASE_URL E2E_DATABASE_URL E2E_PORT E2E_SUPERADMIN_EMAIL; CI=true
  isolate_local_run
  echo "[${TEST_DATABASE_URL:-}][${E2E_DATABASE_URL:-}][${E2E_PORT:-}][${E2E_SUPERADMIN_EMAIL:-}]")"
check "under CI nothing is set" "[][][][]" "$out"

exit "$fail"
