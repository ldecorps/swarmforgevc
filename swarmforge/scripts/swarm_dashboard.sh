#!/usr/bin/env bash
# A consolidated, VIEWER-ONLY dashboard: one tmux window with a tiled,
# read-only pane per live role session.
#
# The roles deliberately live in SEPARATE sessions on the swarm's private
# socket - the supervisor and BL-324's role parking kill/respawn/park each
# one independently, and that isolation is load-bearing. This dashboard
# therefore never owns, merges or moves the role panes: every tile is a
# nested READ-ONLY attach (attach -r) to the role's own session, on a
# SEPARATE dashboard socket, so killing the dashboard (or the whole
# dashboard server) cannot touch the swarm and vice versa.
#
# The dashboard is a disposable snapshot: roles parked/unparked after it was
# built keep their tile (dead) or are missing until you re-run it. Re-running
# rebuilds it from the live session list.
#
# Usage: swarm_dashboard.sh <project-root>
#   Attaches interactively when run outside tmux; from inside a tmux client
#   it switches the current client to the dashboard instead (no nesting).
set -euo pipefail

ROOT="${1:?usage: swarm_dashboard.sh <project-root>}"
SOCK_FILE="$ROOT/.swarmforge/tmux-socket"

if [[ ! -f "$SOCK_FILE" ]]; then
  echo "swarm_dashboard: no tmux socket file at $SOCK_FILE - is the swarm up?" >&2
  exit 1
fi
SWARM_SOCK="$(cat "$SOCK_FILE")"

# The dashboard lives on its own socket for the same reason the operator
# does (launch_operator.sh): surviving - and never contributing to - a swarm
# tmux failure.
DASH_SOCK="$ROOT/.swarmforge/dashboard-tmux.sock"
SESSION="swarm-dashboard"

mapfile -t ROLE_SESSIONS < <(tmux -S "$SWARM_SOCK" list-sessions -F '#S' 2>/dev/null | grep '^swarmforge-' | sort)
if [[ "${#ROLE_SESSIONS[@]}" -eq 0 ]]; then
  echo "swarm_dashboard: no swarmforge-* sessions live on $SWARM_SOCK" >&2
  exit 1
fi

# Disposable viewer: always rebuild from the live session list.
tmux -S "$DASH_SOCK" kill-session -t "$SESSION" 2>/dev/null || true

# Each tile: a nested read-only attach. TMUX must be unset inside the pane
# or tmux refuses the nested client. The pane title carries the role name
# (pane-border-status) so a tiled grid stays legible.
tile_cmd() {
  printf 'env -u TMUX tmux -S %q attach -r -t %q' "$SWARM_SOCK" "$1"
}

first="${ROLE_SESSIONS[0]}"
tmux -S "$DASH_SOCK" new-session -d -s "$SESSION" -n swarm "$(tile_cmd "$first")"
tmux -S "$DASH_SOCK" select-pane -t "$SESSION:0.0" -T "${first#swarmforge-}"

for role_session in "${ROLE_SESSIONS[@]:1}"; do
  tmux -S "$DASH_SOCK" split-window -t "$SESSION:0" "$(tile_cmd "$role_session")"
  tmux -S "$DASH_SOCK" select-pane -t "$SESSION:0" -T "${role_session#swarmforge-}"
  # Re-tile after every split or a deep split chain runs out of space.
  tmux -S "$DASH_SOCK" select-layout -t "$SESSION:0" tiled
done

tmux -S "$DASH_SOCK" set-option -t "$SESSION" pane-border-status top
tmux -S "$DASH_SOCK" set-option -t "$SESSION" pane-border-format ' #{pane_title} '

echo "swarm_dashboard: ${#ROLE_SESSIONS[@]} role tiles on $DASH_SOCK (read-only)."
if [[ -n "${TMUX:-}" ]]; then
  # Already inside a tmux client: switching beats nesting.
  exec tmux -S "$DASH_SOCK" switch-client -t "$SESSION" 2>/dev/null || \
    echo "swarm_dashboard: attach with: tmux -S $DASH_SOCK attach -t $SESSION"
else
  exec tmux -S "$DASH_SOCK" attach -t "$SESSION"
fi
