#!/usr/bin/env bash
# Usage: ci.sh
# Runs every check a change must pass: install, shellcheck, script tests, lint, typecheck,
# unit/integration tests, e2e tests and the docs check. Works the same in any CI and on a laptop.
#
# Env:
#   CI_BASE_REF  git ref the docs check diffs against (default origin/main)
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
  # Stop only what this script started. Volumes are kept: locally they may hold dev data.
  trap '"${compose[@]}" down' EXIT
fi
"${compose[@]}" up -d --wait

log "Lint"
pnpm lint

log "Typecheck"
pnpm typecheck

log "Unit and integration tests"
pnpm test

log "End-to-end tests"
pnpm exec playwright install --with-deps chromium
pnpm test:e2e

log "Docs check against $base_ref"
bash scripts/check-docs.sh "$base_ref"

log "All checks passed"
