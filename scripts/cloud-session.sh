#!/usr/bin/env bash
# Usage: cloud-session.sh
# Prepares a Claude Code cloud session (claude.ai/code) for work on Spolu: a root .env,
# dependencies, and the dev services (PostgreSQL 17 and Mailpit from docker-compose.dev.yml)
# that server tests and e2e need. Run by the SessionStart hook in .claude/settings.json.
#
# Does nothing outside a cloud session (CLAUDE_CODE_REMOTE is "true" only there), so local
# sessions are never touched. Never fails the session start: problems are logged and the
# script exits 0, so Claude still starts and can fix the environment by hand.
#
# Services do not survive the environment snapshot, so this runs on every session start.
# See docs/runbooks/cloud-sessions.md.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0
source scripts/lib.sh

[[ $# -eq 0 ]] || usage "cloud-session.sh   (no arguments)"
[[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]] || exit 0

[[ -f .env ]] || cp .env.example .env

if [[ ! -d node_modules ]]; then
  log "Installing dependencies"
  pnpm install --frozen-lockfile >&2 || log "pnpm install failed; run it by hand"
fi

if ! command -v docker >/dev/null 2>&1; then
  log "docker is not installed; server tests and e2e need PostgreSQL 17 and Mailpit"
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  log "Starting the Docker daemon"
  (dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi
if docker info >/dev/null 2>&1; then
  log "Starting PostgreSQL and Mailpit"
  docker compose -f docker-compose.dev.yml up -d --wait >&2 ||
    log "docker compose failed; see docs/runbooks/cloud-sessions.md"
else
  log "the Docker daemon did not start (see /tmp/dockerd.log)"
fi
exit 0
