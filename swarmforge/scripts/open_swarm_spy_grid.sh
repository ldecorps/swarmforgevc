#!/usr/bin/env bash
# open_swarm_spy_grid.sh — recreate the resident-spy 8-tile grid in tmux.
#
# Layout (2 columns × 4 rows), same order as the Mini App / Bubble spy view:
#
#   COORDINATOR | SPECIFIER
#   CODER       | CLEANER
#   ARCHITECT   | HARDENDER
#   DOCUMENTER  | QA
#
# Each tile nests into the live swarmforge-<role> session via attach-swarm
# (TMUX= cleared so the outer spy server does not steal the client).
#
# Usage:
#   open_swarm_spy_grid.sh [project-root] [--attach|--detach] [--kill]
#   open_swarm_spy_grid.sh --help
#
# From Windows (PowerShell / cmd):
#   wsl.exe -e bash /path/to/swarmforgevc/swarmforge/scripts/open_swarm_spy_grid.sh
#   or: swarmforge/deploy/windows/open-swarm-spy-grid.cmd
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DEFAULT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ATTACH_SH="$ROOT_DEFAULT/attach-swarm.sh"

SPY_SESSION="${SWARMFORGE_SPY_SESSION:-swarmforge-spy-grid}"
SPY_SOCK_NAME="${SWARMFORGE_SPY_SOCK:-}"

# Row-major left→right, top→bottom (matches resident-spy tiles).
LEFT_ROLES=(coordinator coder architect documenter)
RIGHT_ROLES=(specifier cleaner hardender QA)

usage() {
  cat <<'EOF'
Usage: open_swarm_spy_grid.sh [project-root] [--attach|--detach] [--kill]

Recreate the resident-spy 8-pane tmux grid and attach-swarm into each role.

  --attach   create (or reuse) the grid and attach this terminal (default)
  --detach   create the grid only; print how to attach
  --kill     tear down an existing spy-grid session first

Env:
  SWARMFORGE_SPY_SESSION   outer session name (default: swarmforge-spy-grid)
  SWARMFORGE_SPY_SOCK      outer tmux socket path (default: <root>/.swarmforge/tmux-spy.sock)

Detach from the spy grid with: Ctrl-b d
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
SPY_SOCK="${SPY_SOCK_NAME:-$ROOT/.swarmforge/tmux-spy.sock}"

if [[ ! -x "$ATTACH_SH" && ! -f "$ATTACH_SH" ]]; then
  echo "attach-swarm not found at $ATTACH_SH" >&2
  exit 1
fi
chmod +x "$ATTACH_SH" 2>/dev/null || true

if [[ ! -f "$SOCKET_FILE" ]]; then
  echo "No swarm socket at $SOCKET_FILE — is the swarm running?" >&2
  echo "Start one with: SWARMFORGE_TERMINAL=none ./swarm \"$ROOT\"" >&2
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
  echo "Spy grid already running (session $SPY_SESSION on $SPY_SOCK)." >&2
  if [[ "$DO_ATTACH" -eq 1 ]]; then
    exec tmux -S "$SPY_SOCK" attach-session -t "$SPY_SESSION"
  fi
  echo "Attach with: tmux -S $(printf '%q' "$SPY_SOCK") attach -t $(printf '%q' "$SPY_SESSION")"
  exit 0
fi

# Nested attach: clear TMUX so this outer client does not replace itself.
# Retry while a role session is missing so a partial swarm still fills in.
pane_cmd() {
  local role="$1"
  local label
  label="$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')"
  printf 'cd %q; printf "\\033]2;%s\\033\\\\"; while true; do TMUX= %q %q %q && break; echo; echo "[%s] not live — retry in 5s (Ctrl-c to stop this tile)"; sleep 5; done; echo "[%s] attach ended"; sleep infinity' \
    "$ROOT" "$label" "$ATTACH_SH" "$role" "$ROOT" "$label" "$label"
}

# Left column top→bottom, then split each row to the right.
spy new-session -d -s "$SPY_SESSION" -n grid -x 220 -y 64 -c "$ROOT" \
  "$(pane_cmd "${LEFT_ROLES[0]}")"
spy set-option -t "$SPY_SESSION" remain-on-exit off
spy set-option -t "$SPY_SESSION" mouse on
spy set-option -t "$SPY_SESSION:grid" pane-border-status top
spy set-option -t "$SPY_SESSION:grid" pane-border-format ' #{pane_title} '

for role in "${LEFT_ROLES[@]:1}"; do
  spy split-window -t "$SPY_SESSION:grid" -v -c "$ROOT" "$(pane_cmd "$role")"
done
spy select-layout -t "$SPY_SESSION:grid" even-vertical

i=0
while read -r pane_id; do
  spy split-window -h -t "$pane_id" -c "$ROOT" "$(pane_cmd "${RIGHT_ROLES[$i]}")"
  i=$((i + 1))
done < <(spy list-panes -t "$SPY_SESSION:grid" -F '#{pane_top} #{pane_id}' | sort -n | awk '{print $2}')

# Equalize into a stable 2×4.
spy select-layout -t "$SPY_SESSION:grid" tiled

echo "Spy grid ready: $SPY_SESSION ($SPY_SOCK)"
echo "Tiles: coordinator|specifier / coder|cleaner / architect|hardender / documenter|QA"

if [[ "$DO_ATTACH" -eq 1 ]]; then
  exec tmux -S "$SPY_SOCK" attach-session -t "$SPY_SESSION"
fi

echo "Attach with: tmux -S $(printf '%q' "$SPY_SOCK") attach -t $(printf '%q' "$SPY_SESSION")"
