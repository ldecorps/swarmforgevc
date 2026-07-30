#!/usr/bin/env bash
# BL-590 slice 1: launches the Onboarder's topic-reconcile
# poll-loop, supervised by onboarder_supervisor.bb with bounded
# restart - mirrors launch_negotiation_relay.sh's own idempotent guard +
# *_LAUNCH_DRYRUN mode. ONE instance per swarm repo (unlike the negotiation
# relay's one-per-target), since the Onboarding topic lives in the PRIMARY
# swarm's own group and is reused across every target onboarded through it.
#
# Usage: launch_onboarder.sh <swarm-repo-root>
#
# Env:
#   ONBOARDER_LAUNCH_DRYRUN=1   print the assembled supervisor command, start nothing
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
launch_onboarder.sh — lifecycle start entry point.

Stop: stop_ancillary_services.sh / ./stop-swarm.sh (or ./swarm-kill for pipeline-only)

Usage: see header comments above.
EOF
  exit 0
fi


SWARM_REPO_ROOT="${1:?usage: launch_onboarder.sh <swarm-repo-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$SWARM_REPO_ROOT/.swarmforge/operator"
SUPERVISOR_BB="$SCRIPT_DIR/onboarder_supervisor.bb"
PID_FILE="$OP_DIR/onboarder-supervisor.pid"
LOG="$OP_DIR/onboarder-supervisor.log"
# BL-684: the pre-rename pid file - a supervisor started before this rename
# may still hold it. Compat-only; drop once no such supervisor can exist.
OLD_PID_FILE="$OP_DIR/onboarding-facilitator-supervisor.pid"
PID_WAIT_ATTEMPTS="${PID_WAIT_ATTEMPTS:-60}"

RECONCILE_ENTRYPOINT="$SWARM_REPO_ROOT/extension/out/tools/onboarder-reconcile.js"

mkdir -p "$OP_DIR"

if [[ "${ONBOARDER_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN launch_onboarder swarm-repo=%s\n' "$SWARM_REPO_ROOT"
  printf 'DRYRUN supervisor cmd: bb %s %s\n' "$SUPERVISOR_BB" "$SWARM_REPO_ROOT"
  printf 'DRYRUN reconcile cmd: node %s %s poll-loop\n' "$RECONCILE_ENTRYPOINT" "$SWARM_REPO_ROOT"
  exit 0
fi

# A missing compiled entrypoint is a hard error here (matches
# launch_negotiation_relay.sh's own posture) - fail loudly now rather than
# spawning `node <missing-file>` and leaving the supervisor to loop through
# its own bounded-restart cap against a failure that will never self-resolve.
if [[ ! -f "$RECONCILE_ENTRYPOINT" ]]; then
  echo "launch_onboarder: reconcile entrypoint not found: $RECONCILE_ENTRYPOINT (run npm run compile in extension/)" >&2
  exit 1
fi

# ── BL-684: a pre-rename supervisor may still be running under the old
#    pid-file name. Never adopt, kill or migrate it (invariant 2 - that would
#    risk a second supervisor or a heartbeat handoff neither side agreed to)
#    - decline and report, so a human stops it deliberately. A dead process,
#    a non-numeric pid, or an empty/missing file never blocks a start. ─────
if [[ -f "$OLD_PID_FILE" ]]; then
  old_pid="$(< "$OLD_PID_FILE")"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "launch_onboarder: a pre-rename supervisor is already running (pid $old_pid, $OLD_PID_FILE) for $SWARM_REPO_ROOT; not starting a second one - stop it manually first" >&2
    exit 0
  fi
fi

# ── idempotent: already running -> do nothing (mirrors launch_negotiation_relay.sh's
#    own pid-alive guard). ──────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(< "$PID_FILE")"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "launch_onboarder: supervisor already running (pid $existing_pid) for $SWARM_REPO_ROOT; not double-launching" >&2
    exit 0
  fi
fi

rm -f "$OP_DIR/onboarder-supervisor.stop"

nohup bb "$SUPERVISOR_BB" "$SWARM_REPO_ROOT" >> "$LOG" 2>&1 &

claimed=0
for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if [[ -f "$PID_FILE" ]]; then
    pid="$(< "$PID_FILE")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      claimed=1; break
    fi
  fi
  sleep 0.1
done

if [[ "$claimed" -ne 1 ]]; then
  echo "launch_onboarder: supervisor failed to claim its own pid file under $OP_DIR" >&2
  exit 1
fi

echo "Started onboarder supervisor (pid $(< "$PID_FILE")) for $SWARM_REPO_ROOT."
