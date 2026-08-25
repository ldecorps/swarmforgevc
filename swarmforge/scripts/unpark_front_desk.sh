#!/usr/bin/env bash
# BL-404 — the explicit, auditable counterpart to launch_front_desk.sh's
# park-flag guard. A park (front-desk-PARKED.md) is a deliberate human "do
# not restart" decision, so lifting it must be an explicit action a human
# runs, never an implicit side effect of a relaunch or daemon restart.
#
# Usage: unpark_front_desk.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: unpark_front_desk.sh <project-root>}"
PARKED_FILE="$ROOT/.swarmforge/operator/front-desk-PARKED.md"

if [[ ! -f "$PARKED_FILE" ]]; then
  echo "unpark_front_desk: front desk is not parked ($PARKED_FILE does not exist); nothing to do" >&2
  exit 0
fi

rm -f "$PARKED_FILE"
echo "unpark_front_desk: removed park flag ($PARKED_FILE); front desk may be launched again"
