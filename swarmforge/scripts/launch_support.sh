#!/usr/bin/env bash
# BL-275 — launch the DISPOSABLE LLM Support (Support MVP, slice 1 of the
# Support role epic BL-274). Mirrors launch_operator.sh exactly (same
# resilience posture: its own tmux socket, independent of the swarm).
#
# Called by support_runtime.bb only when a discussion has been requested.
# Starts an interactive claude session in its OWN tmux socket so it is
# monitorable via Remote Control (--remote-control Support), the same way
# every role agent and the Operator are. Support processes the pending
# events (record the interaction via support_thread.bb, converse with the
# caller over RC, send the email echo), and — as its instructed final step —
# writes .swarmforge/support/support.done; the runtime then tears the
# window down (disposal is the runtime's job, keeping the LLM half
# stateless/disposable).
#
# Usage: launch_support.sh <project-root> <inflight-events-file>
#
# Env:
#   SUPPORT_LAUNCH_DRYRUN=1  print the assembled command, do not launch
#                            (used by the smoke test; no tokens spent)
set -euo pipefail

ROOT="${1:?usage: launch_support.sh <project-root> <inflight-events-file>}"
EVENTS="${2:?usage: launch_support.sh <project-root> <inflight-events-file>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUP_DIR="$ROOT/.swarmforge/support"
SETTINGS="$SCRIPT_DIR/support.claude-settings.json"
PROMPT="$ROOT/swarmforge/roles/support.prompt"
# Named plainly "Support" (NOT "SwarmForge-Support") — it is the external
# front desk, not a swarm agent, same convention as the Operator's own
# session/RC naming.
SESSION="support"
RC_NAME="Support"

# CRITICAL (resilience, same reasoning as launch_operator.sh): Support runs
# on its OWN dedicated tmux socket, NOT the swarm's socket, so a dead
# swarm/tmux never takes the front desk down with it.
SUP_SOCK="$SUP_DIR/support-tmux.sock"

mkdir -p "$SUP_DIR"

KICKOFF="You are Support — the human-facing front desk (you are NOT a swarm agent). Read your system prompt, then process the pending events in ${EVENTS}. Take the minimal correct action per your prompt (open or follow up a SUP-### thread via support_thread.bb, converse with the caller over this Remote Control session, send the email echo), then as your FINAL action run: touch ${SUP_DIR}/support.done — and stop."

CLAUDE_CMD=(claude
  --settings "$SETTINGS"
  --dangerously-skip-permissions
  --remote-control "$RC_NAME"
  --append-system-prompt-file "$PROMPT"
  -n "Support"
  "$KICKOFF")

if [[ "${SUPPORT_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN launch_support session=%s rc=%s events=%s\n' "$SESSION" "$RC_NAME" "$EVENTS"
  printf 'DRYRUN cmd:'; printf ' %q' "${CLAUDE_CMD[@]}"; printf '\n'
  exit 0
fi

# NOTE: deliberately does NOT require the swarm's tmux socket — Support must
# be reachable even when the swarm is completely down.

# Reuse if one is somehow already present (the runtime gates on
# support-running?, so this is just belt-and-braces).
if tmux -S "$SUP_SOCK" has-session -t "$SESSION" 2>/dev/null; then
  echo "launch_support: support session already present; not double-launching" >&2
  exit 0
fi

# unset provider keys so it uses the same auth path as the swarm agents.
tmux -S "$SUP_SOCK" new-session -d -s "$SESSION" -n "$SESSION" \
  "cd '$ROOT'; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; PATH='$ROOT/swarmforge/scripts':\$PATH ${CLAUDE_CMD[*]@Q}"

# Record the pane pid for liveness tracking (best-effort).
sleep 0.3
tmux -S "$SUP_SOCK" list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null | head -1 > "$SUP_DIR/support.pid" || true
echo "launch_support: started $SESSION ($RC_NAME) on its own socket $SUP_SOCK"
