#!/usr/bin/env bash
# Tests for scripts/move-data.sh: argument and config checks, the stopped-app and TAG guards, what
# export writes (dump, files, counts, checksums), and that import verifies the export, replaces
# the database and files, and fails when the target differs. ssh is a stub that plays the server.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0
d="$(mktemp -d)"
trap 'rm -rf "$d"' EXIT

check() { # name, expected, actual
  if [[ "$2" != "$3" ]]; then echo "FAIL $1"; echo " expected: $2"; echo " actual:   $3"; fail=1; fi
}
has() { # name, needle, file
  grep -qF -- "$2" "$3" 2>/dev/null || { echo "FAIL $1: '$2' not in $(basename "$3")"; fail=1; }
}
hasnt() { # name, needle, file
  ! grep -qF -- "$2" "$3" 2>/dev/null || { echo "FAIL $1: '$2' found in $(basename "$3")"; fail=1; }
}

# --- The ssh stub: answers each remote command like a server, logs it to $STUB_DIR/calls ---
mkdir "$d/bin"
cat > "$d/bin/ssh" <<'STUB'
#!/usr/bin/env bash
while [[ $# -gt 0 && "$1" == -* ]]; do shift 2; done # -i/-o/-p each take a value
echo "ssh $1" >> "$STUB_DIR/calls"
shift
cmd="$*"
echo "cmd $cmd" >> "$STUB_DIR/calls"
case "$cmd" in
  *"ps --status running --services") printf '%s\n' ${STUB_RUNNING:-postgres backup caddy} ;;
  *"docker volume inspect spolu_files"*) exit "${STUB_NO_VOLUME:-0}" ;;
  *"s/^TAG=//p"*) echo "${STUB_TAG:-abc123}" ;;
  *"docker inspect --format"*) echo "postgres:17.11@sha256:00ff" ;;
  *pg_dump*) printf 'DUMP-%s' "${STUB_DB:-v1}" ;;
  *"-d spolu "*"-At -f -")
    cat > /dev/null
    printf 'public.messages|%s\npublic.user|2\n' "${STUB_MESSAGES:-84}" ;;
  *"-d postgres "*) cat > "$STUB_DIR/drop.sql" ;;
  *pg_restore*) cat > "$STUB_DIR/restored" ;;
  *"--entrypoint tar"*"-cf - .") printf 'TAR-%s' "${STUB_DB:-v1}" ;;
  *"--entrypoint bash"*" -s")
    cat > /dev/null
    echo "${STUB_FILE_SUM:-aa}  ./groups/logo.png" ;;
  *"-xpf -"*) cat > "$STUB_DIR/extracted" ;;
  *) echo "unexpected command: $cmd" >&2; exit 99 ;;
esac
STUB
chmod +x "$d/bin/ssh"
export STUB_DIR="$d" PATH="$d/bin:$PATH"

# --- A private deploy config like ~/.config/spolu/<env>.deploy ---
echo 'KEY' > "$d/key" && chmod 600 "$d/key"
echo 'host ssh-ed25519 AAAA' > "$d/known_hosts"
cat > "$d/config" <<EOF
DEPLOY_HOST=203.0.113.5
DEPLOY_USER=deploy
DEPLOY_SSH_KEY=$d/key
DEPLOY_KNOWN_HOSTS_FILE=$d/known_hosts
ENV_FILE=$d/unused.env
DOMAIN=help.example.com
IMAGE=registry.example.com/spolu
EOF
chmod 600 "$d/config"
export SPOLU_DEPLOY_CONFIG="$d/config"
run() { : > "$d/calls"; bash "$root/scripts/move-data.sh" "$@" > "$d/out" 2>&1; echo $?; }

# --- Arguments ---
check "no args" 2 "$(run)"
check "unknown mode" 2 "$(run copy test "$d/x")"
check "--replace on export" 2 "$(run export --replace test "$d/x")"
check "import without --replace" 1 "$(run import test "$d/x")"
has "import asks for --replace" "pass --replace" "$d/out"
chmod 644 "$d/config"
check "config not private" 1 "$(run export test "$d/x")"
chmod 600 "$d/config"

# --- Export refuses a running app, a missing volume, a non-empty folder ---
check "export with app running" 1 "$(STUB_RUNNING="postgres app media" run export test "$d/x")"
has "says stop app" "docker compose stop app media" "$d/out"
hasnt "no dump with app running" "pg_dump" "$d/calls"
check "export without volume" 1 "$(STUB_NO_VOLUME=1 run export test "$d/y")"
mkdir "$d/full" && touch "$d/full/a"
check "export into non-empty folder" 1 "$(run export test "$d/full")"

# --- Export ---
check "export" 0 "$(run export test "$d/exp")"
has "connects as deploy" "ssh deploy@203.0.113.5" "$d/calls"
has "runs in the env folder" "cd /opt/spolu/test && " "$d/calls"
# DEPLOY_ROOT in the config: the env folder under it (the company server, 2026-10-28).
cp "$d/config" "$d/config.root" && echo 'DEPLOY_ROOT=/home/knbform/spolu' >> "$d/config.root"
check "export with DEPLOY_ROOT" 0 "$(SPOLU_DEPLOY_CONFIG="$d/config.root" run export test "$d/exp-root")"
has "DEPLOY_ROOT: runs in <root>/<env>" "cd /home/knbform/spolu/test && " "$d/calls"
hasnt "DEPLOY_ROOT: not in /opt/spolu" "/opt/spolu" "$d/calls"
check "dump" "DUMP-v1" "$(cat "$d/exp/spolu.dump")"
check "files" "TAR-v1" "$(cat "$d/exp/files.tar")"
has "counts" "public.messages|84" "$d/exp/counts.txt"
has "file sums" "aa  ./groups/logo.png" "$d/exp/files.sha256"
has "source tag" "tag=abc123" "$d/exp/source.txt"
has "source not live" "live=0" "$d/exp/source.txt"
has "files read-only" "spolu_files:/data/files:ro" "$d/calls"
has "skips tmp files" "--exclude=*.tmp" "$d/calls"
has "keeps numeric owners" "--numeric-owner" "$d/calls"
check "folder private" "700" "$(stat -f %Lp "$d/exp" 2>/dev/null || stat -c %a "$d/exp")"
check "live export" 0 "$(STUB_RUNNING="postgres app media" run export --live test "$d/live")"
has "live marked" "live=1" "$d/live/source.txt"

# --- Import ---
check "import" 0 "$(run import --replace test "$d/exp")"
has "drops the database" "drop database if exists spolu with (force);" "$d/drop.sql"
check "restored dump" "DUMP-v1" "$(cat "$d/restored")"
check "extracted files" "TAR-v1" "$(cat "$d/extracted")"
has "empties the volume first" "find /data/files -mindepth 1 -delete" "$d/calls"
has "single transaction" "--single-transaction" "$d/calls"
has "says what next" "docker compose up -d" "$d/out"
hasnt "never starts the app" "compose up" "$d/calls"

check "import with app running" 1 "$(STUB_RUNNING="postgres app" run import --replace test "$d/exp")"
hasnt "nothing replaced with app running" "pg_restore" "$d/calls"
check "import other tag" 1 "$(STUB_TAG=def456 run import --replace test "$d/exp")"
has "names both tags" "runs TAG def456, the export was taken with abc123" "$d/out"
hasnt "nothing replaced on tag mismatch" "pg_restore" "$d/calls"

cp -R "$d/exp" "$d/bad" && printf 'X' >> "$d/bad/files.tar"
check "import damaged export" 1 "$(run import --replace test "$d/bad")"
hasnt "nothing replaced when damaged" "drop database" "$d/calls"

check "import count mismatch" 1 "$(STUB_MESSAGES=80 run import --replace test "$d/exp")"
has "shows the diff" "+public.messages|80" "$d/out"
has "says do not start" "do not start the app" "$d/out"
check "import file mismatch" 1 "$(STUB_FILE_SUM=bb run import --replace test "$d/exp")"
check "live export mismatch only warns" 0 "$(STUB_MESSAGES=80 run import --replace test "$d/live")"
has "warns" "WARNING: differences above" "$d/out"

exit "$fail"
