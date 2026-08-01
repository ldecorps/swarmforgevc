#!/usr/bin/env bash
# Legacy alias for kill_pipeline_swarm.sh (BL-637).
#
# Scope: pipeline-only — this does NOT kill the full stack. Prefer
# ./stop-swarm.sh for a full-stack stop, or kill_pipeline_swarm.sh by name.
#
# Kept so handoffd's endless-loop hard stop, model-factory cold apply, and
# every other existing caller keep working without a hard cut.
#
# BL-611 exception: babysitterd IS signalled here (via its pidfile), even
# though everything else stays pipeline-only. This name is the one the
# ticket's "nuclear path" callers already invoke, and a pidfile-signal is
# cheap and side-effect-free when babysitterd is not running. Every other
# ancillary (operator, front desk, onboarder) is still untouched here — the
# full-stack path for those is ./stop-swarm.sh via stop_ancillary_services.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'HELP'
kill_all_swarm.sh — legacy alias (BL-637).

Scope: pipeline-only, with one exception: babysitterd (BL-611) is also
signalled via its pidfile. This shim otherwise delegates to
kill_pipeline_swarm.sh and does NOT stop the rest of the full stack.

Prefer: ./stop-swarm.sh (full stack) or kill_pipeline_swarm.sh (pipeline-only).
HELP
  exit 0
fi

signal_pid_file() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(tr -d '[:space:]' < "$pid_file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.3
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

# Mirror kill_pipeline_swarm.sh's own flag-then-root parsing (never assume
# $1 is the root — a caller may pass --sweep-inbox/--reset-worktrees/--full
# first) so the pidfile lookup targets the right project root.
ROOT_ARG="."
for arg in "$@"; do
  case "$arg" in
    --sweep-inbox|--reset-worktrees|--full) continue ;;
    *) ROOT_ARG="$arg"; break ;;
  esac
done
if ROOT="$(cd "$ROOT_ARG" 2>/dev/null && pwd)"; then
  signal_pid_file "$ROOT/.swarmforge/babysitterd/babysitterd.pid"
fi

echo "kill_all_swarm.sh: pipeline-only shim (+ babysitterd pidfile) → kill_pipeline_swarm.sh (prefer that name; full stack: ./stop-swarm.sh)" >&2
exec bash "$SCRIPT_DIR/kill_pipeline_swarm.sh" "$@"
