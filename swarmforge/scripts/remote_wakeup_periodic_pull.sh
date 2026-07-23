#!/usr/bin/env bash
# BL-092: the second swarm's fallback when the Actions bridge is down
# (GitHub outage, runner offline, workflow disabled). Meant for a slow
# crontab entry on the remote WSL2 machine (e.g. every 10-15 minutes) - it
# does ONLY a safe, idempotent git sync, nothing else. No nudge, no
# business logic: every role already runs its own idle self-check
# (ready_for_next.sh when idle past its own timeout, per the constitution's
# workflow rule), so once this keeps the local checkout fresh, the
# specifier's own existing idle behavior picks up newly assigned work on
# its next self-check - this script's only job is "don't let the local
# clone go stale while the instant Actions nudge is unavailable."
#
# Usage: remote_wakeup_periodic_pull.sh <project-root>
set -euo pipefail

ROOT="${1:?Usage: remote_wakeup_periodic_pull.sh <project-root>}"

# fetch + fast-forward-only merge: never force, never rewrite history,
# never silently drop local state - matches the "fetch/re-merge/retry
# discipline, never force-pushed, never silently dropped" convention this
# project already uses for cross-swarm git coordination (BL-090).
git -C "$ROOT" fetch origin main --quiet
git -C "$ROOT" merge --ff-only origin/main
