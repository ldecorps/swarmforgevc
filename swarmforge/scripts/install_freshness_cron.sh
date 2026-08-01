#!/usr/bin/env bash
# BL-675: idempotent installer for the cron-side daemon log-freshness checker.
# Schedules daemon_log_freshness_check.sh every 2 minutes. Safe to re-run.
#
# BL-783: the marker is root-scoped (bracket-delimited so one root's path can
# never prefix-collide with a sibling's) so installing for one project root
# never clobbers another root's line on the same host's crontab.
#
# Usage: install_freshness_cron.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: install_freshness_cron.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="$SCRIPT_DIR/daemon_log_freshness_check.sh"
MARKER="# swarmforge-BL-675-freshness-check root=[$ROOT]"

if [[ ! -f "$CHECKER" ]]; then
  echo "install_freshness_cron.sh: freshness_check missing at $CHECKER" >&2
  exit 1
fi
chmod +x "$CHECKER" 2>/dev/null || true

if ! command -v crontab >/dev/null 2>&1; then
  echo "install_freshness_cron.sh: no crontab command on this host; the daemon-log freshness watchdog will NOT run for $ROOT" >&2
  exit 1
fi

# Cron line: every 2 minutes, POSIX sh, FRESHNESS_ROOT set, logs to daemon dir.
LOG_DIR="$ROOT/.swarmforge/daemon"
mkdir -p "$LOG_DIR"
CRON_CMD="FRESHNESS_ROOT=$ROOT /bin/sh $CHECKER >>$LOG_DIR/freshness-check.cron.log 2>&1"
CRON_LINE="*/2 * * * * $CRON_CMD $MARKER"

existing="$(crontab -l 2>/dev/null || true)"
# Strip any prior line for THIS root only (marker is root-scoped) — a sibling
# root's line must survive on a multi-root host (BL-783).
filtered="$(printf '%s\n' "$existing" | grep -v -F -- "$MARKER" || true)"
if ! { printf '%s\n' "$filtered"; printf '%s\n' "$CRON_LINE"; } | grep -v '^$' | crontab -; then
  echo "install_freshness_cron.sh: crontab install failed (read-only or unavailable crontab); the daemon-log freshness watchdog will NOT run for $ROOT" >&2
  exit 1
fi

echo "Installed freshness_check cron for $ROOT"
echo "Line: $CRON_LINE"
