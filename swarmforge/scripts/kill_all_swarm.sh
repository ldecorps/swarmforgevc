#!/usr/bin/env bash
# Legacy alias for kill_pipeline_swarm.sh (BL-637).
#
# Scope: pipeline-only — this does NOT kill the full stack. Prefer
# ./stop-swarm.sh for a full-stack stop, or kill_pipeline_swarm.sh by name.
#
# Kept so handoffd's endless-loop hard stop, model-factory cold apply, and
# every other existing caller keep working without a hard cut.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'HELP'
kill_all_swarm.sh — legacy alias (BL-637).

Scope: pipeline-only
This shim delegates to kill_pipeline_swarm.sh. It does NOT stop the full stack.

Prefer: ./stop-swarm.sh (full stack) or kill_pipeline_swarm.sh (pipeline-only).
HELP
  exit 0
fi

echo "kill_all_swarm.sh: pipeline-only shim → kill_pipeline_swarm.sh (prefer that name; full stack: ./stop-swarm.sh)" >&2
exec bash "$SCRIPT_DIR/kill_pipeline_swarm.sh" "$@"
