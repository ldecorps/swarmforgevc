#!/usr/bin/env bash
# babysit.sh — turn on the Swarm Reliability Babysitter (outside the chain).
#
# Starts an always-on hawk that watches the live swarm, files reliability
# bugs, and publishes glitches/remediations to the Telegram "Babysitter" topic.
# The LLM may idle; a cheap runtime wakes it on handoff delivery and ~every
# 20 minutes for a periodic observe pass.
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
  sed -n '2,14p' "$0"
  exit 0
fi

# Allow invoking as ./babysit.sh when cwd is the repo.
if [[ ! -d "$ROOT/swarmforge" && -d "$SCRIPT_DIR/swarmforge" ]]; then
  ROOT="$SCRIPT_DIR"
fi

BB_DIR="$ROOT/.swarmforge/babysitter"
SOCK="$BB_DIR/babysitter-tmux.sock"
START="$ROOT/swarmforge/scripts/start_babysitter.sh"
RUNTIME_PID="$BB_DIR/runtime.pid"

stop_runtime() {
  date -u +%Y-%m-%dT%H:%M:%SZ > "$BB_DIR/stop" 2>/dev/null || true
  rm -f "$BB_DIR/enabled"
  if [[ -f "$RUNTIME_PID" ]]; then
    pid="$(tr -d '[:space:]' < "$RUNTIME_PID" || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 0.3
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$RUNTIME_PID"
  fi
}

case "$CMD" in
  status)
    runtime_ok=0
    if [[ -f "$RUNTIME_PID" ]]; then
      rpid="$(tr -d '[:space:]' < "$RUNTIME_PID" || true)"
      if [[ -n "${rpid:-}" ]] && kill -0 "$rpid" 2>/dev/null; then
        runtime_ok=1
        echo "babysitter-runtime: RUNNING pid=$rpid"
      else
        echo "babysitter-runtime: STOPPED (stale pid file)"
      fi
    else
      echo "babysitter-runtime: STOPPED"
    fi
    if [[ -f "$BB_DIR/enabled" ]]; then
      echo "babysitter-enabled: yes"
    else
      echo "babysitter-enabled: no"
    fi
    if [[ -S "$SOCK" ]] && tmux -S "$SOCK" has-session -t babysitter 2>/dev/null; then
      echo "babysitter-llm: RUNNING"
      tmux -S "$SOCK" list-sessions
      tmux -S "$SOCK" capture-pane -t babysitter:0.0 -p 2>/dev/null | tail -20
      [[ "$runtime_ok" -eq 1 ]] && exit 0
      exit 0
    fi
    echo "babysitter-llm: STOPPED"
    exit 1
    ;;
  stop)
    stop_runtime
    if [[ -S "$SOCK" ]]; then
      tmux -S "$SOCK" kill-server 2>/dev/null || true
      rm -f "$SOCK"
      echo "babysitter: stopped (llm + runtime)"
    else
      echo "babysitter: llm already stopped; runtime cleared"
    fi
    exit 0
    ;;
esac

exec bash "$START" "$ROOT"
