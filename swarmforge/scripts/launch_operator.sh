#!/usr/bin/env bash
# Operator v2 — launch the DISPOSABLE LLM Operator (Claude Opus).
#
# Called by operator_runtime.bb only when an event needs reasoning. Starts an
# interactive claude session in a tmux window on the SWARM socket so it is
# monitorable via Remote Control (--remote-control SwarmForge-Operator), the
# same way every role agent is. The operator processes the pending events,
# acts, and — as its instructed final step — writes .swarmforge/operator/
# operator.done; the runtime then tears the window down (disposal is the
# runtime's job, keeping the LLM half stateless/disposable).
#
# Usage: launch_operator.sh <project-root> <inflight-events-file>
#
# Env:
#   OPERATOR_LAUNCH_DRYRUN=1  print the assembled command, do not launch
#                             (used by the smoke test; no tokens spent)
set -euo pipefail

ROOT="${1:?usage: launch_operator.sh <project-root> <inflight-events-file>}"
EVENTS="${2:?usage: launch_operator.sh <project-root> <inflight-events-file>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
SETTINGS="$SCRIPT_DIR/operator.claude-settings.json"
PROMPT="$ROOT/swarmforge/roles/operator.prompt"
# Named plainly "Operator" (NOT "SwarmForge-Operator") — it is the external
# supervisor, not a swarm agent, and its name should make that obvious in
# claude.ai Remote Control and tmux.
SESSION="operator"
RC_NAME="Operator"

# CRITICAL (resilience): the Operator runs on its OWN dedicated tmux socket,
# NOT the swarm's socket. This is what lets the Operator survive — and
# recover — a total swarm/tmux failure. If it shared the swarm socket, a
# dead swarm tmux would take the Operator down with it and there would be
# nothing left to relaunch the swarm.
OP_SOCK="$OP_DIR/operator-tmux.sock"

mkdir -p "$OP_DIR"

# The kickoff message the Operator wakes on. Its standing behaviour is in
# operator.prompt (appended as system prompt); this just points it at the
# concrete work for this run.
KICKOFF="You are the Operator — the external supervisor of the SwarmForge swarm (you are NOT a swarm agent). Read your system prompt, then process the pending events in ${EVENTS} and the live swarm state. Take the minimal correct action per your prompt (health check, ONE targeted nudge, recovery, or escalate), update .swarmforge/operator/status.json if warranted, then as your FINAL action run: touch ${OP_DIR}/operator.done — and stop."

CLAUDE_CMD=(claude
  --settings "$SETTINGS"
  --dangerously-skip-permissions
  --remote-control "$RC_NAME"
  --append-system-prompt-file "$PROMPT"
  -n "Operator"
  "$KICKOFF")

if [[ "${OPERATOR_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN launch_operator session=%s rc=%s events=%s\n' "$SESSION" "$RC_NAME" "$EVENTS"
  printf 'DRYRUN cmd:'; printf ' %q' "${CLAUDE_CMD[@]}"; printf '\n'
  exit 0
fi

# NOTE: deliberately does NOT require the swarm's tmux socket. The Operator
# must be launchable even when the swarm is completely down — that is the
# recovery path. It runs on its own OP_SOCK tmux server.

# Reuse if one is somehow already present (the runtime gates on
# operator-running?, so this is just belt-and-braces).
if tmux -S "$OP_SOCK" has-session -t "$SESSION" 2>/dev/null; then
  echo "launch_operator: operator session already present; not double-launching" >&2
  exit 0
fi

# unset provider keys so it uses the same auth path as the swarm agents.
# new-session (not new-window) creates the operator's own tmux server on
# OP_SOCK from nothing, so it never depends on a live swarm.
tmux -S "$OP_SOCK" new-session -d -s "$SESSION" -n "$SESSION" \
  "cd '$ROOT'; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; PATH='$ROOT/swarmforge/scripts':\$PATH ${CLAUDE_CMD[*]@Q}"

# Record the pane pid for liveness tracking (best-effort).
sleep 0.3
tmux -S "$OP_SOCK" list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null | head -1 > "$OP_DIR/operator.pid" || true
echo "launch_operator: started $SESSION ($RC_NAME) on its own socket $OP_SOCK"
