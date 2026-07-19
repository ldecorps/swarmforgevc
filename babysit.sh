#!/usr/bin/env bash
# babysit.sh — turn on the Swarm Reliability Babysitter (outside the chain).
#
# Starts an always-on hawk that watches the live swarm, files reliability
# bugs, and publishes glitches/remediations to the Telegram "Babysitter" topic.
#
# Usage:
#   ./babysit.sh                 # project root = this script's directory
#   ./babysit.sh /path/to/repo
#   ./babysit.sh status
#   ./babysit.sh stop
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$SCRIPT_DIR}"
CMD=""

if [[ "${1:-}" == "status" || "${1:-}" == "stop" ]]; then
  CMD="$1"
  ROOT="${2:-$SCRIPT_DIR}"
elif [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,12p' "$0"
  exit 0
fi

# Allow invoking as ./babysit.sh when cwd is the repo.
if [[ ! -d "$ROOT/swarmforge" && -d "$SCRIPT_DIR/swarmforge" ]]; then
  ROOT="$SCRIPT_DIR"
fi

BB_DIR="$ROOT/.swarmforge/babysitter"
SOCK="$BB_DIR/babysitter-tmux.sock"
START="$ROOT/swarmforge/scripts/start_babysitter.sh"

case "$CMD" in
  status)
    if [[ -S "$SOCK" ]] && tmux -S "$SOCK" has-session -t babysitter 2>/dev/null; then
      echo "babysitter: RUNNING"
      tmux -S "$SOCK" list-sessions
      tmux -S "$SOCK" capture-pane -t babysitter:0.0 -p 2>/dev/null | tail -20
      exit 0
    fi
    echo "babysitter: STOPPED"
    exit 1
    ;;
  stop)
    if [[ -S "$SOCK" ]]; then
      tmux -S "$SOCK" kill-server 2>/dev/null || true
      rm -f "$SOCK"
      echo "babysitter: stopped"
    else
      echo "babysitter: already stopped"
    fi
    exit 0
    ;;
esac

exec bash "$START" "$ROOT"
