#!/usr/bin/env bash
# Usage: ci.sh
# Runs every check a change must pass: install, shellcheck, script tests, lint, typecheck,
# unit/integration tests, e2e tests and the docs check. Works the same in any CI and on a laptop.
#
# Env:
#   CI_BASE_REF  git ref the docs check diffs against (default origin/main)
#   CI           when set (GitHub sets it) no worker caps are applied; otherwise Vitest gets half
#                the cores, Playwright a quarter and packages test one after the other.
#                VITEST_MAX_WORKERS, E2E_WORKERS and npm_config_workspace_concurrency override.
#
# Parallel runs: when CI is unset every run gets its own test and e2e databases, e2e port and e2e
# superadmin address (isolate_local_run in lib.sh), so ci.sh can run from several worktrees at once.
# TEST_DATABASE_URL, E2E_DATABASE_URL, E2E_PORT and E2E_SUPERADMIN_EMAIL override. The run drops
# its own databases when it starts and when it ends.
#
# Needs Docker (PostgreSQL and Mailpit from docker-compose.dev.yml), Node 24+ and pnpm.
# No .env file is needed: tests and e2e use their built-in defaults.
# If the dev services are already running, they are reused and left running; otherwise
# this script starts them and stops them again on exit.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

[[ $# -eq 0 ]] || usage "ci.sh   (no arguments; set CI_BASE_REF to change the docs check base, default origin/main)"
require_cmd docker pnpm git

base_ref="${CI_BASE_REF:-origin/main}"
compose=(docker compose -f docker-compose.dev.yml)

# On a laptop, cap the workers so the checks do not overload the machine (see lib.sh).
limit_local_parallelism
isolate_local_run

# drop_run_databases: drops this run's databases (a no-op under CI, where they are the defaults).
drop_run_databases() {
  [[ -n "${CI_RUN_ID:-}" ]] || return 0
  local url name
  for url in "$TEST_DATABASE_URL" "${TEST_DATABASE_URL}_explain" "$E2E_DATABASE_URL"; do
    name="${url##*/}"
    "${compose[@]}" exec -T postgres psql -U spolu -d postgres -q \
      -c "drop database if exists \"$name\" with (force)" >/dev/null 2>&1 || true
  done
}

log "Installing dependencies"
pnpm install --frozen-lockfile

log "Checking shell scripts"
shell_files=(scripts/*.sh deploy/backup/backup.sh)
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "${shell_files[@]}"
else
  docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable "${shell_files[@]}"
fi

log "Testing scripts"
for test_script in scripts/tests/*.test.sh; do
  bash "$test_script"
done

if [[ -n "$("${compose[@]}" ps --status running --quiet)" ]]; then
  log "Dev services already running; reusing them and leaving them running"
else
  log "Starting dev services (PostgreSQL, Mailpit)"
  stop_services=1
fi
"${compose[@]}" up -d --wait

# On exit: drop this run's databases, then stop the services, but only when this script started them
# and no other ci.sh is still running (it would lose its database). Volumes are kept: locally they
# may hold dev data.
cleanup() {
  drop_run_databases
  if [[ -n "${stop_services:-}" ]] && ! pgrep -f '^(/[^ ]*/)?bash( -[a-z]+)* ([^ ]*/)?ci\.sh$' | grep -qvx "$$"; then
    "${compose[@]}" down
  fi
}
trap cleanup EXIT
drop_run_databases

# Independent static checks run at the same time; each one's output is printed whole, in order.
log "Lint, format check and typecheck (in parallel)"
run_parallel \
  "Lint" "pnpm lint" \
  "Format check" "pnpm exec prettier --check ." \
  "Typecheck" "pnpm typecheck"

log "Unit and integration tests"
pnpm test

log "End-to-end tests"
pnpm exec playwright install --with-deps chromium
if [[ -n "${CI_RUN_ID:-}" ]]; then
  # Playwright and the e2e server read DATABASE_URL; keep it out of the unit tests above.
  DATABASE_URL="$E2E_DATABASE_URL" pnpm test:e2e
else
  pnpm test:e2e
fi

log "Docs check against $base_ref"
bash scripts/check-docs.sh "$base_ref"

log "All checks passed"
