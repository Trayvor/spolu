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
