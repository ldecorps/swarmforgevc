#!/usr/bin/env bash
# BL-334 — launch the RESTRICTED, front-desk-only disposable LLM.
#
# Structurally incapable of acting on the swarm: `--tools ""` removes EVERY
# tool from the session (no Bash, no Write, no Edit, no Read, no MCP - pure
# text reasoning only), so there is no capability for the model to exercise
# regardless of what it is told, asked, or tricked into attempting. This is
# NOT a permission prompt a human could accidentally approve - the tool
# simply does not exist in this session. Verified empirically 2026-07-13: a
# `--tools ""` session instructed to run a shell command narrated intent but
# produced no filesystem effect at all (no tool_use, nothing to approve).
#
# NEVER pass --dangerously-skip-permissions or --remote-control here - the
# first exists to bypass exactly the restriction this launcher depends on,
# the second would hand the session an interactive channel a human could be
# talked into approving something through. Runs headless (`-p`), one shot,
# and exits on its own the moment it answers - no operator.done marker, no
# window-kill step, unlike the unrestricted Operator's long-lived RC session.
#
# Called by operator_runtime.bb's launch-front-desk-operator! only when the
# full (unrestricted) Operator is already holding the single-Operator slot
# and a front-desk message is pending - see should-launch-front-desk-
# operator? in operator_lib.bb for the exact gate.
#
# Usage: launch_front_desk_operator.sh <project-root> <prompt-file> <result-file>
#
# Env:
#   FRONT_DESK_LAUNCH_DRYRUN=1  print the assembled command, do not launch
#                               (used by the smoke test; no tokens spent)
set -euo pipefail

ROOT="${1:?usage: launch_front_desk_operator.sh <project-root> <prompt-file> <result-file>}"
PROMPT_FILE="${2:?usage: launch_front_desk_operator.sh <project-root> <prompt-file> <result-file>}"
RESULT_FILE="${3:?usage: launch_front_desk_operator.sh <project-root> <prompt-file> <result-file>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
SETTINGS="$SCRIPT_DIR/front-desk-operator.claude-settings.json"
SESSION="front-desk-operator"

# Own dedicated tmux socket, same resilience posture as launch_operator.sh/
# launch_support.sh - a dead swarm tmux must never take this down with it,
# and its liveness must never be confused with the unrestricted Operator's
# own operator-tmux.sock (a DIFFERENT socket file entirely).
FD_SOCK="$OP_DIR/front-desk-operator-tmux.sock"

mkdir -p "$OP_DIR"

CLAUDE_CMD=(claude -p --output-format json --tools "" --settings "$SETTINGS")

if [[ "${FRONT_DESK_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN launch_front_desk_operator session=%s\n' "$SESSION"
  printf 'DRYRUN cmd:'; printf ' %q' "${CLAUDE_CMD[@]}"; printf ' <prompt from %s>\n' "$PROMPT_FILE"
  exit 0
fi

# Reuse if one is somehow already present (the runtime gates on
# front-desk-operator-running?, so this is just belt-and-braces).
if tmux -S "$FD_SOCK" has-session -t "$SESSION" 2>/dev/null; then
  echo "launch_front_desk_operator: session already present; not double-launching" >&2
  exit 0
fi

# unset provider keys so it uses the same auth path as the swarm agents.
# The prompt is passed via a file (never inlined into the tmux command
# string) so arbitrary message content never has to survive shell quoting.
tmux -S "$FD_SOCK" new-session -d -s "$SESSION" -n "$SESSION" \
  "cd '$ROOT'; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; ${CLAUDE_CMD[*]@Q} \"\$(cat '$PROMPT_FILE')\" > '$RESULT_FILE' 2>'$RESULT_FILE.err'"

# Record the pane pid for liveness tracking (best-effort). The session
# disappears on its own once the one-shot `claude -p` exits - no done-marker
# or window-kill step needed, unlike the unrestricted Operator's long-lived
# RC session.
sleep 0.3
tmux -S "$FD_SOCK" list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null | head -1 > "$OP_DIR/front-desk-operator.pid" || true
echo "launch_front_desk_operator: started $SESSION on its own socket $FD_SOCK"
