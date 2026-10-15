#!/usr/bin/env bash
# Claude Code Stop hook: remind to update docs/ when code changed without it.
set -u
input="$(cat)"

if command -v jq >/dev/null 2>&1; then
  active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)"
else
  if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    active=true
  else
    active=false
  fi
fi
[ "$active" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

code="$(git status --porcelain -- apps packages 2>/dev/null)"
docs="$(git status --porcelain -- docs 2>/dev/null)"

if [ -n "$code" ] && [ -z "$docs" ]; then
  printf '%s\n' '{"decision":"block","reason":"Code under apps/ or packages/ changed but docs/ did not. Run the update-kb skill, or say why no docs change is needed."}'
fi
exit 0
