#!/usr/bin/env bash
# open_swarm_spy_router.sh — resident-spy tmux view for a mono-router pack
# (config rotation router).
#
# A router pack keeps only TWO live sessions: the auto-provisioned
# coordinator and ONE resident pane that rotates in place through every
# pipeline role (coder → specifier → cleaner → ... ) via rotate_to_role.
# Every other role is a dormant pre-generated launch script, not a live
# session — so the 8-tile grid from open_swarm_spy_grid.sh has nothing to
# attach to for them. This is the 2-tile equivalent:
#
#   COORDINATOR | RESIDENT (rotating pipeline role)
#
# Each tile nests into the live session via attach-swarm (TMUX= cleared so
# the outer spy server does not steal the client). The resident tile's
# border label is driven by spy_router_pane_label.sh as a tmux
# pane-border-format #() job, polled on the outer session's status-interval
# (see SWARMFORGE_SPY_ROUTER_INTERVAL below) — it repaints live as
# .swarmforge/mono-router-active-role changes, independent of whatever
# attach-swarm is doing inside the pane.
#
# Usage:
#   open_swarm_spy_router.sh [project-root] [--attach|--detach] [--kill]
#   open_swarm_spy_router.sh --help
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DEFAULT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ATTACH_SH="$ROOT_DEFAULT/attach-swarm.sh"

SPY_SESSION="${SWARMFORGE_SPY_ROUTER_SESSION:-swarmforge-spy-router}"
SPY_SOCK_NAME="${SWARMFORGE_SPY_ROUTER_SOCK:-}"
SPY_INTERVAL="${SWARMFORGE_SPY_ROUTER_INTERVAL:-2}"
LABEL_SH="$SCRIPT_DIR/spy_router_pane_label.sh"

usage() {
  cat <<'EOF'
Usage: open_swarm_spy_router.sh [project-root] [--attach|--detach] [--kill]

Recreate a 2-pane tmux view (coordinator | resident) for a mono-router
(config rotation router) pack and attach-swarm into each.

  --attach   create (or reuse) the grid and attach this terminal (default)
  --detach   create the grid only; print how to attach
  --kill     tear down an existing spy-router session first

Env:
  SWARMFORGE_SPY_ROUTER_SESSION    outer session name (default: swarmforge-spy-router)
  SWARMFORGE_SPY_ROUTER_SOCK       outer tmux socket path (default: <root>/.swarmforge/tmux-spy-router.sock)
  SWARMFORGE_SPY_ROUTER_INTERVAL   seconds between border-label repaints (default: 2)

Detach from the spy view with: Ctrl-b d
EOF
}

ROOT=""
DO_ATTACH=1
DO_KILL=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --attach) DO_ATTACH=1 ;;
    --detach) DO_ATTACH=0 ;;
    --kill) DO_KILL=1 ;;
    *)
      if [[ -z "$ROOT" && ( -d "$arg" || "$arg" == . || "$arg" == .. ) ]]; then
        ROOT="$(cd "$arg" && pwd)"
      else
        echo "Unknown argument: $arg" >&2
        usage >&2
        exit 2
      fi
      ;;
  esac
done
ROOT="${ROOT:-$ROOT_DEFAULT}"
ATTACH_SH="$ROOT/attach-swarm.sh"

SOCKET_FILE="$ROOT/.swarmforge/tmux-socket"
SPY_SOCK="${SPY_SOCK_NAME:-$ROOT/.swarmforge/tmux-spy-router.sock}"

if [[ ! -x "$ATTACH_SH" && ! -f "$ATTACH_SH" ]]; then
  echo "attach-swarm not found at $ATTACH_SH" >&2
  exit 1
fi
chmod +x "$ATTACH_SH" 2>/dev/null || true

if [[ ! -f "$SOCKET_FILE" ]]; then
  echo "No swarm socket at $SOCKET_FILE — is the swarm running?" >&2
  echo "Start one with: SWARMFORGE_TERMINAL=none ./swarm \"$ROOT\" --pack anthropic-mono-router" >&2
  exit 1
fi

SWARM_SOCK="$(<"$SOCKET_FILE")"
if [[ -z "$SWARM_SOCK" ]]; then
  echo "Empty tmux socket file: $SOCKET_FILE" >&2
  exit 1
fi
if ! tmux -S "$SWARM_SOCK" list-sessions >/dev/null 2>&1; then
  echo "Swarm tmux socket not live: $SWARM_SOCK" >&2
  exit 1
fi

mkdir -p "$(dirname "$SPY_SOCK")"

spy() {
  tmux -S "$SPY_SOCK" "$@"
}

if [[ "$DO_KILL" -eq 1 ]]; then
  spy kill-session -t "$SPY_SESSION" 2>/dev/null || true
fi

if spy has-session -t "$SPY_SESSION" 2>/dev/null; then
  echo "Spy router already running (session $SPY_SESSION on $SPY_SOCK)." >&2
  if [[ "$DO_ATTACH" -eq 1 ]]; then
    exec tmux -S "$SPY_SOCK" attach-session -t "$SPY_SESSION"
  fi
  echo "Attach with: tmux -S $(printf '%q' "$SPY_SOCK") attach -t $(printf '%q' "$SPY_SESSION")"
  exit 0
fi

# Nested attach: clear TMUX so this outer client does not replace itself.
# Retry while the target session is missing so a partial swarm still fills in.
# (Border labels are handled separately by spy_router_pane_label.sh below —
# this only needs a plain retry-loop command, no title escape codes.)
pane_cmd() {
  local attach_arg="$1"
  local label="$2"
  printf 'cd %q; while true; do TMUX= %q %q %q && break; echo; echo "[%s] not live — retry in 5s (Ctrl-c to stop this tile)"; sleep 5; done; echo "[%s] attach ended"; sleep infinity' \
    "$ROOT" "$ATTACH_SH" "$attach_arg" "$ROOT" "$label" "$label"
}

spy new-session -d -s "$SPY_SESSION" -n router -x 220 -y 50 -c "$ROOT" \
  "$(pane_cmd coordinator COORDINATOR)"
spy set-option -t "$SPY_SESSION" remain-on-exit off
spy set-option -t "$SPY_SESSION" mouse on
spy set-option -t "$SPY_SESSION" status-interval "$SPY_INTERVAL"
spy set-option -t "$SPY_SESSION:router" pane-border-status top

COORD_PANE_ID="$(spy list-panes -t "$SPY_SESSION:router" -F '#{pane_id}' | head -n1)"

spy split-window -h -t "$SPY_SESSION:router" -c "$ROOT" \
  "$(pane_cmd resident RESIDENT)"

spy select-layout -t "$SPY_SESSION:router" even-horizontal

# Same format string is evaluated once per pane with that pane's own
# #{pane_id} — spy_router_pane_label.sh decides COORDINATOR vs. the live
# rotated role from that.
spy set-option -t "$SPY_SESSION:router" pane-border-format \
  " #(${LABEL_SH@Q} ${ROOT@Q} ${COORD_PANE_ID@Q} #{pane_id}) "

echo "Spy router ready: $SPY_SESSION ($SPY_SOCK)"
echo "Tiles: coordinator | resident (rotating pipeline role, repaints every ${SPY_INTERVAL}s from .swarmforge/mono-router-active-role)"

if [[ "$DO_ATTACH" -eq 1 ]]; then
  exec tmux -S "$SPY_SOCK" attach-session -t "$SPY_SESSION"
fi

echo "Attach with: tmux -S $(printf '%q' "$SPY_SOCK") attach -t $(printf '%q' "$SPY_SESSION")"
