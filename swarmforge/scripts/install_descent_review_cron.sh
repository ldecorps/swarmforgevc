#!/usr/bin/env bash
# BL-1327: install the scheduled descent-ladder review line into the live user
# crontab, root-scoped, the same way the freshness and shift-schedule crons are
# installed. A periodic review nothing schedules is dead code (BL-419/BL-1235),
# which is why this installer and its entry in install_swarmforge_crons.sh land
# in the same parcel as the review itself.
#
# The review is PROPOSAL-ONLY (BL-1327 slice 1, human ruling 2026-09-02): this
# cron line writes a proposal record for a human to act on and never mutates a
# seat, so scheduling it carries no autonomy risk.
#
# Usage: install_descent_review_cron.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: install_descent_review_cron.sh <project-root>}"
ROOT="$(cd "$ROOT" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REVIEW_BB="$SCRIPT_DIR/descent_review_cli.bb"
MARKER="# swarmforge-descent-review $ROOT"
# Daily, off the hour the other swarmforge lines use, so a slow review never
# overlaps the freshness sweep.
SCHEDULE="${SWARMFORGE_DESCENT_REVIEW_SCHEDULE:-17 4 * * *}"

if ! command -v crontab >/dev/null 2>&1; then
  echo "install_descent_review_cron.sh: no crontab command on this host; the descent review will NOT run for $ROOT" >&2
  exit 1
fi

if ! command -v bb >/dev/null 2>&1; then
  echo "install_descent_review_cron.sh: bb missing; cannot schedule the descent review for $ROOT" >&2
  exit 1
fi

existing="$(crontab -l 2>/dev/null || true)"
# Idempotent: drop any previous line for THIS root, then re-add. Two installs
# must not leave two review lines behind.
filtered="$(printf '%s\n' "$existing" | grep -vF "$MARKER" || true)"
line="$SCHEDULE bb $REVIEW_BB review $ROOT >/dev/null 2>&1 $MARKER"

printf '%s\n%s\n' "$filtered" "$line" | grep -v '^$' | crontab -
echo "install_descent_review_cron.sh: scheduled descent review for $ROOT ($SCHEDULE)"
