#!/usr/bin/env bash
# Tests for scripts/check-docs.sh
set -u
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/check-docs.sh"
WARN='::warning::Code changed without docs/ changes. Run the update-kb skill.'
fail=0

new_repo() {
  d="$(mktemp -d)"
  cd "$d" || exit 1
  git init -q
  git checkout -q -b main 2>/dev/null
  echo init > README.md
  git add -A
  git -c user.email=t@t -c user.name=t commit -q -m init
  git checkout -q -b feat
}
commit_files() { # paths...
  for f in "$@"; do mkdir -p "$(dirname "$f")"; echo x > "$f"; done
  git add -A
  git -c user.email=t@t -c user.name=t commit -q -m change
}
check() { # name expect_warning(0/1)
  out="$(bash "$SCRIPT" main)"; rc=$?
  if [[ $rc -ne 0 ]]; then echo "FAIL $1: exit $rc"; fail=1; return; fi
  if [[ $2 -eq 1 ]]; then
    [[ "$out" == *"$WARN"* ]] || { echo "FAIL $1: expected warning, got '$out'"; fail=1; return; }
  else
    [[ -z "$out" ]] || { echo "FAIL $1: expected no output, got '$out'"; fail=1; return; }
  fi
  echo "ok $1"
}

(new_repo; commit_files apps/x.ts; check "code-only" 1) || fail=1
(new_repo; commit_files apps/x.ts docs/a.md; check "code+docs" 0) || fail=1
(new_repo; commit_files docs/a.md; check "docs-only" 0) || fail=1
(new_repo; commit_files apps/x.ts docs/superpowers/p.md; check "code+superpowers-only" 1) || fail=1
(new_repo; check "no-diff" 0) || fail=1
(new_repo; commit_files packages/p/i.ts; check "packages" 1) || fail=1
(new_repo; bash "$SCRIPT" nosuchref >/dev/null; rc=$?; [[ $rc -eq 0 ]] && echo "ok missing-ref" || { echo "FAIL missing-ref"; exit 1; }) || fail=1
exit $fail
