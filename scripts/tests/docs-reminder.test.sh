#!/usr/bin/env bash
# Tests for .claude/hooks/docs-reminder.sh
set -u
HOOK="$(cd "$(dirname "$0")/../.." && pwd)/.claude/hooks/docs-reminder.sh"
fail=0

new_repo() {
  d="$(mktemp -d)"
  cd "$d" || exit 1
  git init -q
  echo init > README.md
  git add -A
  git -c user.email=t@t -c user.name=t commit -q -m init
}
touch_file() { mkdir -p "$(dirname "$1")"; echo x > "$1"; }
run() { echo "$1" | env -u CLAUDE_PROJECT_DIR bash "$HOOK"; }

t_block() {
  new_repo; touch_file apps/x.ts
  out="$(run '{"stop_hook_active":false}')"; rc=$?
  [[ $rc -eq 0 && "$out" == *'"decision":"block"'* && "$out" == *update-kb* ]] || { echo "FAIL block: rc=$rc '$out'"; return 1; }
  echo "ok block"
}
t_active() {
  new_repo; touch_file apps/x.ts
  out="$(run '{"stop_hook_active":true}')"; rc=$?
  [[ $rc -eq 0 && -z "$out" ]] || { echo "FAIL active: rc=$rc '$out'"; return 1; }
  echo "ok active"
}
t_both() {
  new_repo; touch_file apps/x.ts; touch_file docs/a.md
  out="$(run '{"stop_hook_active":false}')"; rc=$?
  [[ $rc -eq 0 && -z "$out" ]] || { echo "FAIL both: rc=$rc '$out'"; return 1; }
  echo "ok both"
}
t_clean() {
  new_repo
  out="$(run '{"stop_hook_active":false}')"; rc=$?
  [[ $rc -eq 0 && -z "$out" ]] || { echo "FAIL clean: rc=$rc '$out'"; return 1; }
  echo "ok clean"
}
t_nogit() {
  d="$(mktemp -d)"; cd "$d" || exit 1; touch_file apps/x.ts
  out="$(run '{"stop_hook_active":false}')"; rc=$?
  [[ $rc -eq 0 && -z "$out" ]] || { echo "FAIL nogit: rc=$rc '$out'"; return 1; }
  echo "ok nogit"
}

for t in t_block t_active t_both t_clean t_nogit; do
  ( $t ) || fail=1
done
exit $fail
