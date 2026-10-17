#!/usr/bin/env bash
# Tests for limit_local_parallelism in scripts/lib.sh: the caps ci.sh sets on a laptop only.
# shellcheck disable=SC2030,SC2031 # each case runs in its own subshell on purpose
set -u
# shellcheck source=scripts/lib.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib.sh"
fail=0

check() { # name, expected, actual
  if [[ "$2" == "$3" ]]; then echo "ok $1"; else echo "FAIL $1: expected '$2', got '$3'"; fail=1; fi
}
# shellcheck disable=SC2329 # called by limit_local_parallelism
cpu_count() { echo 8; }

out="$(unset CI VITEST_MAX_WORKERS E2E_WORKERS npm_config_workspace_concurrency
  limit_local_parallelism
  echo "$VITEST_MAX_WORKERS $E2E_WORKERS $npm_config_workspace_concurrency")"
check "local, 8 cores: half for Vitest, a quarter for e2e, packages one by one" "4 2 1" "$out"

out="$(unset CI VITEST_MAX_WORKERS E2E_WORKERS npm_config_workspace_concurrency
  # shellcheck disable=SC2329
  cpu_count() { echo 1; }
  limit_local_parallelism
  echo "$VITEST_MAX_WORKERS $E2E_WORKERS")"
check "local, 1 core: never below 1" "1 1" "$out"

out="$(unset CI E2E_WORKERS npm_config_workspace_concurrency
  VITEST_MAX_WORKERS=3
  limit_local_parallelism
  echo "$VITEST_MAX_WORKERS")"
check "a value set by the caller wins" "3" "$out"

out="$(unset VITEST_MAX_WORKERS E2E_WORKERS npm_config_workspace_concurrency
  CI=true
  limit_local_parallelism
  echo "[${VITEST_MAX_WORKERS:-}][${E2E_WORKERS:-}][${npm_config_workspace_concurrency:-}]")"
check "under CI nothing is set" "[][][]" "$out"

exit "$fail"
