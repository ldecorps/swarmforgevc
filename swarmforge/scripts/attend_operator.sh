#!/usr/bin/env bash
# BL-359: the attended (interactive) Operator - a human's own direct chat
# session with the Operator, run in whatever terminal the human is
# already in (never detached into tmux; that is launch_operator.sh's
# DISPOSABLE-run job, not this one).
#
# THE GAP THIS FIXES. The Operator's single-slot invariant
# (operator-running? in operator_runtime.bb) is checked EXACTLY two ways: a
# tmux session named "operator" on the Operator's own socket, or a live
# pid in operator.pid - the same two signals launch_operator.sh's
# disposable runs already register. Before this ticket, an ad hoc,
# untracked `attend.sh` (a bare `exec claude ...`) registered NEITHER, so
# an attended session was invisible to the runtime: should-launch-operator?
# read "not running" and spawned a SECOND, unrestricted, tool-holding
# Operator alongside the human, while BL-334's restricted front-desk lane
# (which is eligible only WHEN full-operator-running? is true) stayed
# dark. The code asserted "an attended session holds the slot indefinitely
# by design" while doing the opposite. This script IS that design, made
# true: it registers via operator.pid BEFORE starting, using the exact
# same signal operator-running? already reads for the disposable launcher
# - no new detection code needed, just a launch path that actually holds
# up its end of the existing contract.
#
# Usage: attend_operator.sh <project-root>

set -euo pipefail

ROOT="${1:?usage: attend_operator.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
SETTINGS="$SCRIPT_DIR/operator.claude-settings.json"
PROMPT="$ROOT/swarmforge/roles/operator.prompt"
PID_FILE="$OP_DIR/operator.pid"

mkdir -p "$OP_DIR"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "attend_operator.sh: an Operator is already registered as running (pid $EXISTING_PID) - not double-launching" >&2
    exit 1
  fi
fi

# Cleanup on exit - but ONLY if the pid file still names THIS session; a
# later disposable run may have legitimately claimed the slot after this
# one's own process, and this must never clobber that registration.
cleanup() {
  if [[ -f "$PID_FILE" ]] && [[ "$(cat "$PID_FILE" 2>/dev/null || true)" == "$$" ]]; then
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT

# Registers THIS shell's own pid - stable across the foreground `claude`
# invocation below (this process stays alive as claude's direct parent,
# never backgrounded/exec'd away), so operator-running?'s pid-alive? check
# sees a real, live process for exactly as long as the session lasts.
echo "$$" > "$PID_FILE"

cd "$ROOT"
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
PATH="$ROOT/swarmforge/scripts:$PATH" claude \
  --settings "$SETTINGS" \
  --dangerously-skip-permissions \
  --append-system-prompt-file "$PROMPT" \
  -n "Operator (attended)"
