#!/usr/bin/env bash
# BL-105: rejects a commit that would introduce a file over a configured
# size threshold. GitHub hard-rejects any push whose reachable objects
# include a file over 100 MB; the BL-093 hardening commit grew
# extension/stryker-incremental.json to 113.69 MB and made a true merge of
# that lineage unpushable. This guard catches the mistake at commit time,
# long before a push can fail.
#
# Usage: check_commit_size.sh [threshold-mb]
#   Checks every staged (git diff --cached) added/modified file's CURRENT
#   working-tree size against the threshold (default 50 MB). Exits 1 with
#   a message naming the offending file(s) and their size if any exceed it;
#   exits 0 otherwise. Safe to call standalone (for tests) or from a
#   pre-commit hook (no arguments, staged files only).

set -euo pipefail

THRESHOLD_MB="${1:-50}"
THRESHOLD_BYTES=$((THRESHOLD_MB * 1024 * 1024))

file_size_bytes() {
  local file="$1"
  if stat -f%z "$file" >/dev/null 2>&1; then
    stat -f%z "$file"
  else
    stat -c%s "$file"
  fi
}

human_mb() {
  awk -v bytes="$1" 'BEGIN { printf "%.2f", bytes / 1048576 }'
}

violations=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ -f "$file" ]] || continue
  size="$(file_size_bytes "$file")"
  if (( size > THRESHOLD_BYTES )); then
    echo "Error: '$file' is $(human_mb "$size") MB, over the ${THRESHOLD_MB} MB commit size limit." >&2
    violations=1
  fi
done < <(git diff --cached --name-only --diff-filter=ACM)

if (( violations )); then
  echo "Commit rejected: reduce or gitignore the oversized file(s) above before committing." >&2
  exit 1
fi

exit 0
