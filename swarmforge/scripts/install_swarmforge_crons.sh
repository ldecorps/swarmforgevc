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

exit "$rc"
