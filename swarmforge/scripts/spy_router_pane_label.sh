#!/usr/bin/env bash
# spy_router_pane_label.sh — live pane-border label for open_swarm_spy_router.sh.
#
# Invoked by tmux itself as a pane-border-format #() job (re-run on tmux's
# status-interval timer), NOT from inside the attached pane — so it repaints
# on its own regardless of what attach-swarm is doing in that pane.
#
# Usage: spy_router_pane_label.sh <root> <coordinator-pane-id> <this-pane-id>
set -euo pipefail

ROOT="${1:?root}"
COORD_ID="${2:?coordinator pane id}"
THIS_ID="${3:?this pane id}"

if [[ "$THIS_ID" == "$COORD_ID" ]]; then
  echo "COORDINATOR"
  exit 0
fi

role="$(cat "$ROOT/.swarmforge/mono-router-active-role" 2>/dev/null || true)"
role="${role:-resident}"
printf '%s\n' "$role" | tr '[:lower:]' '[:upper:]'
