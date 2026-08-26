#!/usr/bin/env bash
#
# stop-swarm.sh — stop the full SwarmForge stack for this repo.
#
# Scope: full stack — ancillaries first (babysitter, operator, Telegram front
# desk, onboarder, tunnels), then the pipeline via kill_pipeline_swarm.sh.
# Idempotent. After teardown, VERIFIES known supervised processes are gone
# (BL-637) and refuses to report a clean slate while any survive.
# Also removes this root's BL-675 freshness cron (BL-785) so the checker
# cannot resurrect stopped daemons on the next tick.
#
# Usage:
#   ./stop-swarm.sh [options] [target-path]   # defaults to this repo's root
#
# Options (forwarded to kill_pipeline_swarm.sh after ancillaries stop):
#   --sweep-inbox
#   --reset-worktrees
#   --full                 # inbox sweep + worktree reset
#
# Pipeline-only stop (tests / surgical): ./swarm-kill
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KILL_PIPELINE="$SCRIPT_DIR/swarmforge/scripts/kill_pipeline_swarm.sh"
STOP_ANCILLARY="$SCRIPT_DIR/swarmforge/scripts/stop_ancillary_services.sh"
UNINSTALL_CRON="$SCRIPT_DIR/swarmforge/scripts/uninstall_freshness_cron.sh"
# shellcheck source=swarmforge/scripts/stack_survivor_scan.sh
source "$SCRIPT_DIR/swarmforge/scripts/stack_survivor_scan.sh"

OPTS=()
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sweep-inbox|--reset-worktrees|--full)
      OPTS+=("$1")
      shift
      ;;
    -h|--help)
      cat <<'EOF'
stop-swarm.sh — stop the full SwarmForge stack for this repo.

Scope: full stack
Stops: babysitterd, operator runtime, Telegram front desk, onboarder,
       remote tunnels, then swarm agent sessions and handoffd.
Removes this repo's daemon freshness cron line (if installed).
Then verifies no babysitterd / Operator agent process survived.

Usage:
  ./stop-swarm.sh [options] [target-path]   # defaults to this repo's root

Options (pipeline only — after ancillaries):
  --sweep-inbox
  --reset-worktrees
  --full                 # inbox sweep + worktree reset

Pipeline-only stop (tests / surgical): ./swarm-kill
EOF
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      echo "Usage: ./stop-swarm.sh [--sweep-inbox|--reset-worktrees|--full] [target-path]" >&2
      exit 2
      ;;
    *)
      if [[ -n "$TARGET" ]]; then
        echo "ERROR: unexpected extra argument: $1" >&2
        exit 2
      fi
      TARGET="$1"
      shift
      ;;
  esac
done

TARGET="${TARGET:-$SCRIPT_DIR}"
TARGET="$(cd "$TARGET" && pwd)"

bash "$STOP_ANCILLARY" "$TARGET"
kill_rc=0
if ((${#OPTS[@]})); then
  bash "$KILL_PIPELINE" "${OPTS[@]}" "$TARGET" || kill_rc=$?
else
  bash "$KILL_PIPELINE" "$TARGET" || kill_rc=$?
fi

if stack_survivor_scan; then
  echo "REFUSE: full-stack stop left surviving processes:" >&2
  printf '%s\n' "$stack_survivor_lines" >&2
  echo "named survivors: $stack_survivor_names" >&2
  exit 1
fi

if [[ "$kill_rc" -ne 0 ]]; then
  echo "REFUSE: pipeline stop exited $kill_rc; not reporting a finished clean stop" >&2
  exit "$kill_rc"
fi

if ! bash "$UNINSTALL_CRON" "$TARGET"; then
  echo "WARN: freshness cron uninstall failed for $TARGET — daemons stay marked stopped, but the cron line may still fire; run: bash $UNINSTALL_CRON $TARGET" >&2
fi

echo "full stack SUCCESS — no known survivors"
