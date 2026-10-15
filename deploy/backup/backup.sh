#!/usr/bin/env bash
# Nightly pg_dump + files archive loop. Runs forever in the backup container.
# Env: PGHOST, PGUSER, PGDATABASE, PGPASSWORD (libpq), BACKUP_HOUR (HH:MM, container time, default 03:30),
# BACKUP_KEEP (default 14), BACKUP_DIR (default /backups), FILES_DIR (default /data/files), TZ.
set -euo pipefail

BACKUP_HOUR="${BACKUP_HOUR:-03:30}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
FILES_DIR="${FILES_DIR:-/data/files}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"; }

# Keeps the newest BACKUP_KEEP files matching a glob prefix/suffix (names sort by timestamp).
prune() {
  # shellcheck disable=SC2012,SC2086 # $1 is a glob, left unquoted on purpose
  ls -1 "$BACKUP_DIR"/$1 2>/dev/null | sort -r | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f --
}

run_backup() {
  local stamp dump files
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  dump="$BACKUP_DIR/spolu-$stamp.dump"
  files="$BACKUP_DIR/files-$stamp.tar.gz"
  if pg_dump -Fc -f "$dump.partial" && mv "$dump.partial" "$dump"; then
    log "ok $dump ($(du -h "$dump" | cut -f1))"
    prune 'spolu-*.dump'
  else
    rm -f "$dump.partial"
    log "FAILED pg_dump"
    return 1
  fi
  if tar -czf "$files.partial" -C "$FILES_DIR" . && mv "$files.partial" "$files"; then
    log "ok $files ($(du -h "$files" | cut -f1))"
    prune 'files-*.tar.gz'
  else
    rm -f "$files.partial"
    log "FAILED files archive"
    return 1
  fi
}

# Seconds until the next BACKUP_HOUR. Never fails: if date cannot resolve the time (for example a
# local time skipped by a DST change), it logs and falls back to 24 hours so the loop keeps running.
seconds_until_next() {
  local now target
  now=$(date +%s)
  if ! target=$(date -d "today $BACKUP_HOUR" +%s 2>/dev/null) || [ "$target" -le "$now" ]; then
    if ! target=$(date -d "tomorrow $BACKUP_HOUR" +%s 2>/dev/null); then
      log "cannot resolve $BACKUP_HOUR in $(date +%Z) (DST gap?), retrying in 24h" >&2
      echo 86400
      return 0
    fi
  fi
  echo $((target - now))
}

if ! [[ "$BACKUP_HOUR" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  log "invalid BACKUP_HOUR '$BACKUP_HOUR', expected HH:MM (00:00-23:59)"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
if compgen -G "$BACKUP_DIR/*.partial" >/dev/null; then
  log "removing leftover partial dumps"
  rm -f "$BACKUP_DIR"/*.partial
fi
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
