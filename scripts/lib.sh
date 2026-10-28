#!/usr/bin/env bash
# Shared helpers for the scripts in this folder. Source it, do not run it:
#   source "$(dirname "$0")/lib.sh"

# Print a progress line to stderr, prefixed with the calling script's name.
log() {
  echo "[$(basename "$0")] $*" >&2
}

# Print an error and exit 1.
die() {
  echo "[$(basename "$0")] ERROR: $*" >&2
  exit 1
}

# Print the usage line and exit 2 (wrong arguments).
usage() {
  echo "Usage: $*" >&2
  exit 2
}

# Exit unless every named environment variable is set and not empty.
require_env() {
  local name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || die "environment variable $name is required"
  done
}

# Exit unless every named command is installed.
require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "command '$cmd' is required but not installed"
  done
}

# run_parallel <name> <command> [<name> <command>...]: runs every command at the same time (each
# with bash -c), then prints each one's output in the given order, under its name, with its result
# and seconds. Output is buffered per step, so the steps never interleave. Returns 1 when any
# command failed (after all have finished and printed), 0 otherwise.
run_parallel() {
  (( $# > 0 && $# % 2 == 0 )) || { echo "run_parallel: expects <name> <command> pairs" >&2; return 2; }
  local dir names=() pids=() i rc=0 status secs
  dir="$(mktemp -d)"
  i=0
  while (( $# > 0 )); do
    names+=("$1")
    (
      start=$SECONDS
      # `|| code=$?` keeps a caller's `set -e` from ending this subshell before the status is written.
      code=0
      bash -c "$2" >"$dir/$i.out" 2>&1 || code=$?
      echo "$code $((SECONDS - start))" >"$dir/$i.status"
    ) &
    pids+=("$!")
    shift 2
    i=$((i + 1))
  done
  for i in "${!pids[@]}"; do
    wait "${pids[$i]}" || true
  done
  for i in "${!names[@]}"; do
    status=1 secs='?'
    [[ -s "$dir/$i.status" ]] && read -r status secs <"$dir/$i.status"
    log "${names[$i]}"
    cat "$dir/$i.out"
    if [[ "$status" -eq 0 ]]; then
      log "${names[$i]}: ok (${secs} s)"
    else
      log "${names[$i]}: FAILED with exit $status (${secs} s)"
      rc=1
    fi
  done
  rm -rf "$dir"
  return "$rc"
}

# deploy_env <env file>: prints the env file for the server. DOMAIN and PUBLIC_URL come from the
# DOMAIN variable (so a domain change is one CI variable), REDIRECT_DOMAINS from its own
# optional variable (empty when unset), and a non-empty TICKETS_API_KEY (its own CI secret)
# replaces the file's. With BEHIND_PROXY=1 (see proxy_mode) it also writes BEHIND_PROXY,
# HTTP_PORT and the COMPOSE_FILE that adds deploy/docker-compose.proxy.yml; those three keys
# always come from the variables, never from the file. Every other line is kept as it is.
deploy_env() {
  local drop='^(DOMAIN|PUBLIC_URL|REDIRECT_DOMAINS|BEHIND_PROXY|HTTP_PORT|COMPOSE_FILE)=' redirects=()
  read -ra redirects <<< "${REDIRECT_DOMAINS:-}"
  [[ -n "${TICKETS_API_KEY:-}" ]] && drop='^(DOMAIN|PUBLIC_URL|REDIRECT_DOMAINS|BEHIND_PROXY|HTTP_PORT|COMPOSE_FILE|TICKETS_API_KEY)='
  grep -Ev "$drop" "$1" | rename_senders || true
  printf 'DOMAIN=%s\nPUBLIC_URL=https://%s\n' "$DOMAIN" "$DOMAIN"
  printf 'REDIRECT_DOMAINS=%s\n' "${redirects[*]-}"
  if [[ -n "${TICKETS_API_KEY:-}" ]]; then printf 'TICKETS_API_KEY=%s\n' "$TICKETS_API_KEY"; fi
  if [[ "${BEHIND_PROXY:-}" == 1 ]]; then
    printf 'BEHIND_PROXY=1\nHTTP_PORT=%s\nCOMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml\n' "${HTTP_PORT:-}"
  fi
}

# deploy_root: prints the folder on the server that holds each environment's folder
# (<root>/<env>): DEPLOY_ROOT, default /opt/spolu, without a trailing slash. Only an absolute path
# of letters, digits, dots, dashes, underscores and slashes, without "..": it goes into the remote
# shell commands unquoted.
deploy_root() {
  local dir="${DEPLOY_ROOT:-/opt/spolu}"
  dir="${dir%/}"
  if [[ ! "$dir" =~ ^/[A-Za-z0-9._/-]+$ || "$dir" == *..* ]]; then
    die "DEPLOY_ROOT must be an absolute path of letters, digits, '.', '_', '-' and '/' (got '$dir')"
  fi
  printf '%s\n' "$dir"
}

# proxy_mode: checks the proxy settings (ADR 0068). BEHIND_PROXY unset, empty or 0: Caddy owns
# 80/443 and gets its own certificates; returns 1 (not in proxy mode). BEHIND_PROXY=1: another web
# server on the host (Apache) terminates TLS and forwards to 127.0.0.1:$HTTP_PORT; HTTP_PORT must
# then be a port number from 1024 to 65535; returns 0. Any other value exits with an error.
proxy_mode() {
  case "${BEHIND_PROXY:-}" in
    '' | 0) return 1 ;;
    1) ;;
    *) die "BEHIND_PROXY must be 1, 0 or empty: ${BEHIND_PROXY}" ;;
  esac
  if [[ ! "${HTTP_PORT:-}" =~ ^[1-9][0-9]{3,4}$ ]] || (( HTTP_PORT < 1024 || HTTP_PORT > 65535 )); then
    die "BEHIND_PROXY=1 needs HTTP_PORT, a free port from 1024 to 65535 (got '${HTTP_PORT:-}')"
  fi
}

# rename_senders (stdin to stdout): with MAIL_FROM_NAME set, MAIL_FROM= and MAIL_FROM_BULK= keep
# their address and get that display name ("Name <address>"); otherwise lines pass unchanged.
rename_senders() {
  local line key value address
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -n "${MAIL_FROM_NAME:-}" && "$line" =~ ^(MAIL_FROM|MAIL_FROM_BULK)=(.+)$ ]]; then
      key="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
      if [[ "$value" =~ \<([^\>]+)\> ]]; then address="${BASH_REMATCH[1]}"; else address="$value"; fi
      printf '%s=%s <%s>\n' "$key" "$MAIL_FROM_NAME" "$address"
    else
      printf '%s\n' "$line"
    fi
  done
}

# caddy_redirects: prints the Caddy site block imported by deploy/Caddyfile (redirects.caddy).
# Every domain in REDIRECT_DOMAINS (space-separated old domains) gets its own certificate and
# answers a permanent redirect to https://$DOMAIN with the same path and query. With no
# REDIRECT_DOMAINS it prints only a comment, so Caddy asks for no extra certificate. Returns 1
# for a name that is not a plain lowercase host name, or that is DOMAIN itself.
caddy_redirects() {
  local domains=() d
  read -ra domains <<< "${REDIRECT_DOMAINS:-}"
  for d in ${domains[@]+"${domains[@]}"}; do
    if [[ ! "$d" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
      echo "[$(basename "$0")] ERROR: REDIRECT_DOMAINS has an invalid domain: $d" >&2
      return 1
    fi
    if [[ "$d" == "${DOMAIN:-}" ]]; then
      echo "[$(basename "$0")] ERROR: REDIRECT_DOMAINS must not contain DOMAIN ($d)" >&2
      return 1
    fi
  done
  echo '# Generated by scripts/deploy.sh from REDIRECT_DOMAINS (scripts/lib.sh caddy_redirects).'
  if [[ ${#domains[@]} -eq 0 ]]; then
    echo '# No old domains to redirect.'
    return 0
  fi
  echo "${domains[*]} {"
  # shellcheck disable=SC2016 # {$DOMAIN} and {uri} are Caddy placeholders, not shell ones
  printf '\tredir https://{$DOMAIN}{uri} permanent\n'
  echo '}'
}

# deploy_ssh <work dir>: sets the global arrays ssh_cmd (ssh to $DEPLOY_USER@$DEPLOY_HOST; append the
# remote command) and scp_cmd (scp with the same options; append sources and target) from
# DEPLOY_SSH_KEY, DEPLOY_PORT (default 22) and DEPLOY_KNOWN_HOSTS. The host key is pinned through
# <work dir>/known_hosts, so the caller's own ~/.ssh is never used or changed. DEPLOY_KNOWN_HOSTS
# is required: without it a man in the middle would get the env file with every secret.
deploy_ssh() {
  local known_hosts="$1/known_hosts" opts port="${DEPLOY_PORT:-22}"
  [[ -n "${DEPLOY_KNOWN_HOSTS:-}" ]] \
    || die "DEPLOY_KNOWN_HOSTS is not set: the server's host key must be pinned (ssh-keyscan <host>, see docs/runbooks/deploy.md)"
  printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$known_hosts"
  opts=(
    -i "$DEPLOY_SSH_KEY"
    -o IdentitiesOnly=yes
    -o BatchMode=yes
    -o ConnectTimeout=20
    -o "UserKnownHostsFile=$known_hosts"
    -o StrictHostKeyChecking=yes
  )
  # shellcheck disable=SC2034 # read by the caller
  ssh_cmd=(ssh "${opts[@]}" -p "$port" "$DEPLOY_USER@$DEPLOY_HOST")
  # shellcheck disable=SC2034 # read by the caller
  scp_cmd=(scp "${opts[@]}" -P "$port")
}

# load_deploy_config <file> <allowed key>...: sets shell variables from a KEY=value file without
# running it as shell code. Blank lines and lines starting with # are skipped; "export " is allowed
# before a key. The value is everything after "=", trailing spaces removed, so spaces need no
# quotes (MAIL_FROM_NAME=Help by eGrant); one pair of surrounding '…' or "…" is removed; a leading
# ~/ becomes $HOME/. No comments after a value. Exits on a malformed line or a key not in the list;
# the message names the line, never the value.
load_deploy_config() {
  local file="$1" line key value n=0 allowed
  shift
  allowed=" $* "
  local kv='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$'
  local single="^'(.*)'$" double='^"(.*)"$'
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ $kv ]] || die "$file line $n is not KEY=value"
    key="${BASH_REMATCH[2]}" value="${BASH_REMATCH[3]}"
    [[ "$allowed" == *" $key "* ]] || die "$file line $n: unknown key $key"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "$value" =~ $single || "$value" =~ $double ]]; then value="${BASH_REMATCH[1]}"; fi
    # shellcheck disable=SC2088 # a literal "~/" is matched here and expanded by hand
    if [[ "$value" == "~" ]]; then value="$HOME"; elif [[ "$value" == "~/"* ]]; then value="$HOME/${value:2}"; fi
    printf -v "$key" '%s' "$value"
  done < "$file"
}

# file_mode <file>: prints its permission bits in octal, e.g. 600 (GNU stat, else BSD/macOS stat).
file_mode() {
  stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"
}

# require_private_file <what> <file>: exits unless <file> exists and only its owner may read or
# write it (no group or other bits, e.g. chmod 600).
require_private_file() {
  local mode
  [[ -f "$2" ]] || die "$1 not found: $2"
  mode="$(file_mode "$2")" || die "cannot read the permissions of $1: $2"
  (( (8#$mode & 8#077) == 0 )) || die "$1 must be private to you (chmod 600 $2); its mode is $mode"
}

# Number of CPU cores (nproc on Linux, sysctl on macOS, 1 if neither works).
cpu_count() {
  nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1
}

# limit_local_parallelism: on a laptop (CI unset) cap the load the checks create themselves.
# The server, web and shared suites ran at once with one heavy worker per core: the load average
# reached 60-80 on 8 cores and tests with a 15 s timeout failed at random. So:
#   - packages run their tests one after the other (pnpm_config_workspace_concurrency=1; pnpm 11+
#     ignores the npm_config_ prefix, so the old npm_config_workspace_concurrency did nothing),
#   - Vitest gets half the cores (VITEST_MAX_WORKERS), Playwright a quarter (E2E_WORKERS).
# A value already set by the caller wins. Under CI (GitHub runner, 4 cores) nothing is changed.
limit_local_parallelism() {
  [[ -z "${CI:-}" ]] || return 0
  local cores
  cores="$(cpu_count)"
  export pnpm_config_workspace_concurrency="${pnpm_config_workspace_concurrency:-1}"
  export VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-$(( cores / 2 > 0 ? cores / 2 : 1 ))}"
  export E2E_WORKERS="${E2E_WORKERS:-$(( cores / 4 > 0 ? cores / 4 : 1 ))}"
}

# ci_run_id <directory name> <absolute path>: a short id for one working tree, safe in a database
# name: the directory name lowercased, every other character turned into "_", cut to 16 characters,
# plus 6 digits of the path's checksum (two trees with the same name stay apart). Pure function.
ci_run_id() {
  local name sum
  name="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | cut -c1-16)"
  sum="$(printf '%s' "$2" | cksum | cut -d' ' -f1)"
  printf '%s_%06d' "$name" "$(( sum % 1000000 ))"
}

# free_port: prints a TCP port nobody listens on right now (asks the OS through Node).
free_port() {
  node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
}

# isolate_local_run: on a laptop (CI unset) give this ci.sh run its own database names, e2e port and
# e2e superadmin address, so two runs from two worktrees can go at the same time. Sets:
#   CI_RUN_ID, TEST_DATABASE_URL (spolu_test_ci_<id>, and its <that>_explain_<volume> clones),
#   E2E_DATABASE_URL (spolu_e2e_<id>), E2E_PORT, E2E_SUPERADMIN_EMAIL (Mailpit is shared; the
#   address is what keeps one run from reading another's login code).
# A value already set by the caller wins. Under CI (a fresh runner) nothing is changed.
isolate_local_run() {
  [[ -z "${CI:-}" ]] || return 0
  local base="postgres://spolu:spolu@localhost:5432"
  CI_RUN_ID="${CI_RUN_ID:-$(ci_run_id "$(basename "$PWD")" "$PWD")}"
  export CI_RUN_ID
  export TEST_DATABASE_URL="${TEST_DATABASE_URL:-$base/spolu_test_ci_$CI_RUN_ID}"
  export E2E_DATABASE_URL="${E2E_DATABASE_URL:-$base/spolu_e2e_$CI_RUN_ID}"
  export E2E_PORT="${E2E_PORT:-$(free_port)}"
  export E2E_SUPERADMIN_EMAIL="${E2E_SUPERADMIN_EMAIL:-admin-$CI_RUN_ID@example.com}"
}
