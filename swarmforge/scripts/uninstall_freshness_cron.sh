#!/usr/bin/env bash
# BL-785: remove the root-scoped freshness cron line installed by
# install_freshness_cron.sh. Idempotent — safe when no line exists.
# A sibling root's line on the same host's crontab is never touched (BL-783).
#
# Usage: uninstall_freshness_cron.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: uninstall_freshness_cron.sh <project-root>}"
MARKER="# swarmforge-BL-675-freshness-check root=[$ROOT]"

if ! command -v crontab >/dev/null 2>&1; then
  echo "uninstall_freshness_cron.sh: no crontab command on this host; nothing to remove for $ROOT" >&2
  exit 0
fi

existing="$(crontab -l 2>/dev/null || true)"
if ! printf '%s\n' "$existing" | grep -q -F -- "$MARKER"; then
  echo "No freshness cron line for $ROOT"
  exit 0
fi

filtered="$(printf '%s\n' "$existing" | grep -v -F -- "$MARKER" || true)"
remaining="$(printf '%s\n' "$filtered" | grep -v '^$' || true)"
if [[ -z "$remaining" ]]; then
  crontab -r 2>/dev/null || true
else
  printf '%s\n' "$remaining" | crontab -
fi

echo "Removed freshness cron for $ROOT"
