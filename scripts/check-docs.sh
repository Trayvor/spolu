#!/usr/bin/env bash
# Usage: check-docs.sh <base-ref>
# Warns (GitHub Actions annotation) when apps/ or packages/ changed without docs/. Always exits 0.
set -u
base="${1:-origin/main}"

if ! files="$(git diff --name-only "$base"...HEAD 2>/dev/null)"; then
  echo "check-docs: cannot diff against '$base'; skipping."
  exit 0
fi

code=0
docs=0
while IFS= read -r f; do
  case "$f" in
    apps/*|packages/*) code=1 ;;
    docs/*) docs=1 ;;
  esac
done <<EOF2
$files
EOF2

if [ "$code" -eq 1 ] && [ "$docs" -eq 0 ]; then
  echo "::warning::Code changed without docs/ changes. Run the update-kb skill."
fi
exit 0
