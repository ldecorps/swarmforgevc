#!/usr/bin/env bash
# BL-1162: install every swarmforge cron line this root needs while running.
# Freshness (BL-675/783), active shift schedule when configured, and the
# BL-1327 descent-ladder review.
#
# Usage: install_swarmforge_crons.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: install_swarmforge_crons.sh <project-root>}"
ROOT="$(cd "$ROOT" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rc=0
if [[ "${SWARMFORGE_SKIP_FRESHNESS_CRON:-}" == "1" ]]; then
  echo "Skipping freshness cron install (SWARMFORGE_SKIP_FRESHNESS_CRON=1)."
else
  if ! bash "$SCRIPT_DIR/install_freshness_cron.sh" "$ROOT"; then
    echo "WARN: freshness cron install failed for $ROOT" >&2
    rc=1
  fi
fi

if [[ "${SWARMFORGE_SKIP_SCHEDULE_CRON:-}" == "1" ]]; then
  echo "Skipping schedule cron install (SWARMFORGE_SKIP_SCHEDULE_CRON=1)."
else
  if ! bash "$SCRIPT_DIR/install_shift_schedule_cron.sh" "$ROOT"; then
    echo "WARN: schedule cron install failed for $ROOT" >&2
    rc=1
  fi
fi

if [[ "${SWARMFORGE_SKIP_DESCENT_REVIEW_CRON:-}" == "1" ]]; then
  echo "Skipping descent review cron install (SWARMFORGE_SKIP_DESCENT_REVIEW_CRON=1)."
else
  # BL-1327: the scheduled descent-ladder review. Proposal-only - it writes a
  # record a human applies by hand and never mutates a seat.
  if ! bash "$SCRIPT_DIR/install_descent_review_cron.sh" "$ROOT"; then
    echo "WARN: descent review cron install failed for $ROOT" >&2
    rc=1
  fi
fi

# ── BL-1392: is there a cron daemon to schedule INTO? ──────────────────────
#
# Every installer above checks that a `crontab` COMMAND exists and then prints
# "Installed". None asked whether a daemon is running. On this WSL2 host (no
# systemd, no `[boot]` line in /etc/wsl.conf) cron stopped on 2026-08-30 06:52
# BST and every ./swarm start since printed success over a dead scheduler: the
# BL-675 watchdog that restarts a dead handoffd was off for five days, every
# shift boundary was manual, and the 17:00 bedtime never fired.
#
# The lines above are still written - they fire the moment cron starts, which
# is why this probe runs AFTER them and never in place of them (invariant 1).
# And it never starts, restarts, installs or configures a daemon: that needs
# root and belongs to the host's owner (invariant 3). It names the fix.
#
# `pgrep -x` for either name: `cron` on Debian/WSL, `crond` on RHEL-family and
# BusyBox. On macOS launchd keeps /usr/sbin/cron running whenever a crontab
# exists, so the same probe answers there too.
cron_daemon_running() {
  pgrep -x cron >/dev/null 2>&1 || pgrep -x crond >/dev/null 2>&1
}

if cron_daemon_running; then
  echo "cron daemon: running."
else
  # The marker is a fixed literal so the launcher, a log sweep and a human
  # scanning output all match the same string.
  echo "CRON_DAEMON_DOWN: no cron daemon is running, so NOTHING scheduled will fire - not the freshness watchdog, not shift start or bedtime, not the descent review. The crontab lines above ARE installed and will run the moment cron starts." >&2
  echo "CRON_DAEMON_DOWN: fix on this host with 'sudo service cron start', and add a '[boot]' section with command=\"service cron start\" to /etc/wsl.conf so it survives a WSL restart." >&2
  rc=1
fi

exit "$rc"
