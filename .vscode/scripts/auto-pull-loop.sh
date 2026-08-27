#!/usr/bin/env bash
# Background loop started by Cursor/VS Code on folder open.
# Pulls only when the tracking branch is behind (same posture as CI).

set -euo pipefail

INTERVAL_SEC="${CURSOR_AUTO_PULL_INTERVAL_SEC:-120}"

cd "$(git rev-parse --show-toplevel)"

while true; do
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git fetch origin -q 2>/dev/null || true
  fi

  upstream='@{upstream}'
  if git rev-parse --verify "${upstream}" >/dev/null 2>&1; then
    behind="$(git rev-list --count "HEAD..${upstream}" 2>/dev/null || echo 0)"
    if [ "${behind}" -gt 0 ]; then
      git pull --rebase --autostash -q 2>/dev/null || true
    fi
  fi

  sleep "${INTERVAL_SEC}"
done
