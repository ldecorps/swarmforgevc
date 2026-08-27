#!/usr/bin/env bash
# BL-710: compile extension and restart the supervised front desk (bridge + bot).
#
# Usage: redeploy_front_desk.sh <project-root>
#
# Intended to run detached (e.g. from Telegram /redeploy frontdesk).
set -euo pipefail

ROOT="$(cd "${1:?usage: redeploy_front_desk.sh <project-root>}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
LOG="$OP_DIR/redeploy-front-desk.log"

mkdir -p "$OP_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/stop_ancillary_services.sh"

{
  echo "=== redeploy front desk $(date -Is) root=$ROOT ==="
  stop_ancillary_init "$ROOT"
  cd "$ROOT/extension"
  npm run compile
  stop_front_desk
  sleep 1
  "$SCRIPT_DIR/launch_front_desk.sh" "$ROOT"
  echo "=== redeploy front desk done $(date -Is) ==="
} >> "$LOG" 2>&1
