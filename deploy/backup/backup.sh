#!/usr/bin/env bash
# Nightly pg_dump loop. Runs forever in the backup container.
# Env: PGHOST, PGUSER, PGDATABASE, PGPASSWORD (libpq), BACKUP_HOUR (HH:MM, container time, default 02:30),
# BACKUP_KEEP (default 14), BACKUP_DIR (default /backups), TZ.
set -euo pipefail

BACKUP_HOUR="${BACKUP_HOUR:-02:30}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"; }

run_backup() {
  local file tmp
  file="$BACKUP_DIR/spolu-$(date -u +%Y%m%dT%H%M%SZ).dump"
  tmp="$file.partial"
  if pg_dump -Fc -f "$tmp" && mv "$tmp" "$file"; then
    log "ok $file ($(du -h "$file" | cut -f1))"
    # Keep the newest BACKUP_KEEP dumps (names sort by timestamp).
    # shellcheck disable=SC2012
    ls -1 "$BACKUP_DIR"/spolu-*.dump 2>/dev/null | sort -r | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f --
  else
    rm -f "$tmp"
    log "FAILED pg_dump"
    return 1
  fi
}

seconds_until_next() {
  local now target
  now=$(date +%s)
  target=$(date -d "today $BACKUP_HOUR" +%s)
  if [ "$target" -le "$now" ]; then
    target=$(date -d "tomorrow $BACKUP_HOUR" +%s)
  fi
  echo $((target - now))
}

mkdir -p "$BACKUP_DIR"
log "started, daily at $BACKUP_HOUR ($(date +%Z)), keeping $BACKUP_KEEP"

# BACKUP_ONCE=1 takes one dump and exits (manual or test run).
if [ "${BACKUP_ONCE:-}" = "1" ]; then
  run_backup
  exit $?
fi

while true; do
  wait_s=$(seconds_until_next)
  log "next run in ${wait_s}s"
  sleep "$wait_s"
  run_backup || true
done
