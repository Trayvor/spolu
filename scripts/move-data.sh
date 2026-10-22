#!/usr/bin/env bash
# Usage: move-data.sh export [--live] <env> <dir>
#        move-data.sh import --replace <env> <dir>
# Moves all of Spolu's data (the database and the files volume) from one server to another,
# through this machine (docs/runbooks/server-move.md). Both servers run the deploy/ compose stack
# in /opt/spolu/<env>; each is reached with the SSH settings of its deploy config,
# $SPOLU_DEPLOY_CONFIG or ~/.config/spolu/<env>.deploy (the file of scripts/deploy-local.sh; only
# DEPLOY_HOST, DEPLOY_USER, DEPLOY_PORT, DEPLOY_SSH_KEY and the known hosts are used here).
#
# export: writes into <dir> (new or empty, made private):
#   spolu.dump    pg_dump -Fc of the database (portable across CPU architectures, unlike pgdata)
#   files.tar     the files volume, numeric owners kept, without the app's *.tmp files
#   counts.txt    exact row count of every table ("schema.table|count")
#   files.sha256  sha256 of every file in the volume
#   source.txt    host, image TAG, time and whether the app was running (--live)
#   SHA256SUMS    checksums of the files above
#   The app and media services must be stopped (cut-over), unless --live (a rehearsal: the
#   counts and file list are then taken a moment apart from the dump and may differ slightly).
# import: checks <dir>, then on the target REPLACES the database (drop, create, pg_restore in one
#   transaction) and the whole files volume, then compares the counts and file checksums with the
#   export. The target must run the same image TAG, with app and media stopped and postgres up.
#   It never starts the app.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

usage_text="move-data.sh export [--live] <env> <dir> | move-data.sh import --replace <env> <dir>"
(( $# >= 1 )) || usage "$usage_text"
mode="$1"
shift
live=0 replace=0
positional=()
for arg in "$@"; do
  case "$arg" in
    --live) [[ "$mode" == export ]] || usage "$usage_text"; live=1 ;;
    --replace) [[ "$mode" == import ]] || usage "$usage_text"; replace=1 ;;
    -*) usage "$usage_text" ;;
    *) positional+=("$arg") ;;
  esac
done
[[ "$mode" == export || "$mode" == import ]] || usage "$usage_text"
(( ${#positional[@]} == 2 )) || usage "$usage_text"
env_name="${positional[0]}"
dir="${positional[1]}"
[[ "$env_name" =~ ^[a-z0-9-]+$ ]] || die "env must be lowercase letters, digits or dashes: $env_name"
if [[ "$mode" == import ]] && (( ! replace )); then
  die "import replaces the target's database and files; pass --replace to confirm"
fi
require_cmd ssh diff

sha256() {
  if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

# --- Settings (the deploy config of <env>) ---
config="${SPOLU_DEPLOY_CONFIG:-$HOME/.config/spolu/$env_name.deploy}"
require_private_file "deploy config" "$config"
keys=(DEPLOY_HOST DEPLOY_USER DEPLOY_PORT DEPLOY_KNOWN_HOSTS DEPLOY_KNOWN_HOSTS_FILE DEPLOY_SSH_KEY
  ENV_FILE DOMAIN IMAGE REDIRECT_DOMAINS MAIL_FROM_NAME TICKETS_API_KEY DEPLOY_PLATFORM
  BEHIND_PROXY HTTP_PORT)
unset "${keys[@]}"
load_deploy_config "$config" "${keys[@]}"
if [[ -n "${DEPLOY_KNOWN_HOSTS_FILE:-}" ]]; then
  [[ -f "$DEPLOY_KNOWN_HOSTS_FILE" ]] || die "DEPLOY_KNOWN_HOSTS_FILE not found: $DEPLOY_KNOWN_HOSTS_FILE"
  DEPLOY_KNOWN_HOSTS="$(cat "$DEPLOY_KNOWN_HOSTS_FILE")${DEPLOY_KNOWN_HOSTS:+$'\n'$DEPLOY_KNOWN_HOSTS}"
fi
for key in DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY; do
  [[ -n "${!key:-}" ]] || die "$key is missing in $config"
done
require_private_file "DEPLOY_SSH_KEY" "$DEPLOY_SSH_KEY"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
deploy_ssh "$work_dir" # sets ssh_cmd (scripts/lib.sh)
remote_dir="/opt/spolu/$env_name"
# Runs one command in the environment's folder on the server; stdin is passed through.
remote() { "${ssh_cmd[@]}" "cd $remote_dir && $1"; }

# The compose project is always "spolu" (deploy/docker-compose.yml), so its files volume is
# spolu_files. Files are read and written by a throwaway container of the postgres image (already
# on the server, has GNU tar, find and sha256sum), never through the app.
files_volume=spolu_files
count_sql="select table_schema || '.' || table_name || '|' ||
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables
where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
order by 1;"
list_files_script="cd /data/files && find . -type f ! -name '*.tmp' -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum"

# Checks the stack on the server: postgres running, app and media stopped (unless allowed), the
# files volume present. Sets tag and pg_image.
preflight() {
  local allow_running="$1" running
  running="$(remote "docker compose ps --status running --services" < /dev/null)" \
    || die "cannot reach $DEPLOY_HOST or run docker compose in $remote_dir"
  grep -qx postgres <<< "$running" || die "postgres is not running on $DEPLOY_HOST (docker compose up -d postgres)"
  if (( ! allow_running )) && grep -qxE 'app|media' <<< "$running"; then
    die "app or media is running on $DEPLOY_HOST; stop them first: docker compose stop app media"
  fi
  remote "docker volume inspect $files_volume > /dev/null" < /dev/null \
    || die "volume $files_volume not found on $DEPLOY_HOST (deploy the stack there once first)"
  tag="$(remote "sed -n 's/^TAG=//p' .env" < /dev/null)"
  [[ -n "$tag" ]] || die "no TAG in $remote_dir/.env on $DEPLOY_HOST"
  pg_image="$(remote "docker inspect --format '{{.Config.Image}}' \"\$(docker compose ps -q postgres)\"" < /dev/null)"
  [[ "$pg_image" =~ ^[a-z0-9][a-z0-9._/:@-]*$ ]] || die "unexpected postgres image name on $DEPLOY_HOST: $pg_image"
}

table_counts() {
  remote "docker compose exec -T postgres psql -U spolu -d spolu -v ON_ERROR_STOP=1 -At -f -" <<< "$count_sql"
}

file_list() {
  remote "docker run --rm -i --network none --cap-drop ALL --cap-add DAC_READ_SEARCH -v $files_volume:/data/files:ro --entrypoint bash $pg_image -s" \
    <<< "$list_files_script"
}

if [[ "$mode" == export ]]; then
  if [[ -e "$dir" ]]; then
    [[ -d "$dir" && -z "$(ls -A "$dir")" ]] || die "$dir must be a new or empty folder"
  fi
  mkdir -p "$dir"
  chmod 700 "$dir" # it holds every message, file and personal record of the app
  preflight "$live"
  (( live )) && log "WARNING: --live; the app is running, so this is a rehearsal copy, not a cut-over one"

  log "Dumping the database from $DEPLOY_HOST"
  remote "docker compose exec -T postgres pg_dump -U spolu -d spolu -Fc" < /dev/null > "$dir/spolu.dump"
  [[ -s "$dir/spolu.dump" ]] || die "the dump is empty"
  log "Counting rows"
  table_counts > "$dir/counts.txt"
  log "Archiving the files volume"
  remote "docker run --rm --network none --cap-drop ALL --cap-add DAC_READ_SEARCH -v $files_volume:/data/files:ro --entrypoint tar $pg_image --numeric-owner '--exclude=*.tmp' -C /data/files -cf - ." \
    < /dev/null > "$dir/files.tar"
  [[ -s "$dir/files.tar" ]] || die "the files archive is empty"
  log "Checksumming the files"
  file_list > "$dir/files.sha256"
  printf 'host=%s\ntag=%s\nlive=%s\ntime=%s\n' "$DEPLOY_HOST" "$tag" "$live" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/source.txt"
  (cd "$dir" && sha256 spolu.dump files.tar counts.txt files.sha256 source.txt > SHA256SUMS)
  log "Done: $dir ($(du -sh "$dir" | cut -f1); $(wc -l < "$dir/counts.txt" | tr -d ' ') tables, $(wc -l < "$dir/files.sha256" | tr -d ' ') files, tag $tag)"
  exit 0
fi

# --- import ---
for f in spolu.dump files.tar counts.txt files.sha256 source.txt SHA256SUMS; do
  [[ -f "$dir/$f" ]] || die "$dir/$f is missing; is it an export folder?"
done
(cd "$dir" && sha256 -c --quiet SHA256SUMS > /dev/null) || die "checksums in $dir/SHA256SUMS do not match: the export is damaged"
source_tag="$(sed -n 's/^tag=//p' "$dir/source.txt")"
source_live="$(sed -n 's/^live=//p' "$dir/source.txt")"
preflight 0
[[ "$tag" == "$source_tag" ]] \
  || die "$DEPLOY_HOST runs TAG $tag, the export was taken with $source_tag; deploy $source_tag there first so the migrations match"

log "Replacing the database on $DEPLOY_HOST"
remote "docker compose exec -T postgres psql -U spolu -d postgres -v ON_ERROR_STOP=1 -f -" <<< \
  "drop database if exists spolu with (force);
create database spolu owner spolu;"
remote "docker compose exec -T postgres pg_restore -U spolu -d spolu --no-owner --exit-on-error --single-transaction" \
  < "$dir/spolu.dump" || die "pg_restore failed; the database on $DEPLOY_HOST is empty, do not start the app"
log "Replacing the files volume"
remote "docker run --rm -i --network none --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER -v $files_volume:/data/files --entrypoint bash $pg_image -c 'find /data/files -mindepth 1 -delete && tar --numeric-owner -xpf - -C /data/files'" \
  < "$dir/files.tar" || die "extracting the files failed on $DEPLOY_HOST; do not start the app"

log "Comparing with the export"
table_counts > "$work_dir/counts.txt"
file_list > "$work_dir/files.sha256"
mismatch=0
diff -u "$dir/counts.txt" "$work_dir/counts.txt" > "$work_dir/counts.diff" || mismatch=1
diff -u "$dir/files.sha256" "$work_dir/files.sha256" > "$work_dir/files.diff" || mismatch=1
if (( mismatch )); then
  cat "$work_dir/counts.diff" "$work_dir/files.diff" >&2
  if [[ "$source_live" == 1 ]]; then
    log "WARNING: differences above; expected with a --live export (rehearsal), not at the cut-over"
  else
    die "the target differs from the export (above); do not start the app"
  fi
fi
log "Done: $(wc -l < "$dir/counts.txt" | tr -d ' ') tables and $(wc -l < "$dir/files.sha256" | tr -d ' ') files on $DEPLOY_HOST match the export."
log "Next: docker compose up -d in $remote_dir (docs/runbooks/server-move.md)"
