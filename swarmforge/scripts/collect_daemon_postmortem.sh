#!/usr/bin/env bash
# Bundle daemon + transport diagnostics for post-mortem investigation.
set -euo pipefail

ROOT="${1:-$(pwd)}"
ROOT="$(cd "$ROOT" && pwd -P)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_DIR="$ROOT/.swarmforge/daemon"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DAEMON_DIR/postmortem-$STAMP.log"

source "$SCRIPT_DIR/portable_stat_lib.sh"

heartbeat_stat_line() {
  portable_stat "heartbeat mtime=%Sm size=%z" "heartbeat mtime=%y size=%s" "$1"
}

mkdir -p "$DAEMON_DIR"

{
  echo "SwarmForge daemon post-mortem"
  echo "captured_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "project_root: $ROOT"
  echo "invoked_by: ${USER:-unknown} pid=$$"
  echo "SWARMFORGE_SKIP_DAEMON=${SWARMFORGE_SKIP_DAEMON:-}"
  echo "SWARMFORGE_MAILBOX_ONLY=${SWARMFORGE_MAILBOX_ONLY:-}"
  echo "SWARMFORGE_CONFIG=${SWARMFORGE_CONFIG:-}"
  echo

  echo "=== process table (handoffd) ==="
  pgrep -fl 'handoffd\.bb|handoffd_supervisor' 2>/dev/null || echo "(none)"
  echo

  echo "=== pid files ==="
  for f in handoffd.pid handoffd-supervisor.pid; do
    if [[ -f "$DAEMON_DIR/$f" ]]; then
      pid="$(< "$DAEMON_DIR/$f")"
      alive="no"
      [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && alive="yes"
      echo "$f pid=$pid alive=$alive"
    else
      echo "$f (missing)"
    fi
  done
  echo

  echo "=== status / stop / heartbeat ==="
  [[ -f "$DAEMON_DIR/handoffd.status.json" ]] && cat "$DAEMON_DIR/handoffd.status.json" || echo "status: (missing)"
  [[ -f "$DAEMON_DIR/stop" ]] && echo "stop file: PRESENT" || echo "stop file: absent"
  [[ -f "$DAEMON_DIR/handoffd.heartbeat" ]] && heartbeat_stat_line "$DAEMON_DIR/handoffd.heartbeat" || echo "heartbeat: (missing)"
  echo

  echo "=== tmux ==="
  if [[ -f "$ROOT/.swarmforge/tmux-socket" ]]; then
    sock="$(< "$ROOT/.swarmforge/tmux-socket")"
    echo "socket=$sock"
    tmux -S "$sock" list-sessions 2>&1 || true
  else
    echo "tmux socket file missing"
  fi
  echo

  echo "=== last extension launch ==="
  [[ -f "$ROOT/.swarmforge/last-launch.log" ]] && tail -80 "$ROOT/.swarmforge/last-launch.log" || echo "(missing)"
  echo

  echo "=== daemon-start-audit.log (tail) ==="
  [[ -f "$DAEMON_DIR/daemon-start-audit.log" ]] && tail -40 "$DAEMON_DIR/daemon-start-audit.log" || echo "(missing)"
  echo

  echo "=== extension-daemon-audit.log (tail) ==="
  [[ -f "$DAEMON_DIR/extension-daemon-audit.log" ]] && tail -40 "$DAEMON_DIR/extension-daemon-audit.log" || echo "(missing)"
  echo

  echo "=== handoffd.log (tail 40) ==="
  [[ -f "$DAEMON_DIR/handoffd.log" ]] && tail -40 "$DAEMON_DIR/handoffd.log" || echo "(missing)"
  echo

  echo "=== handoffd-supervisor.log (tail 30) ==="
  [[ -f "$DAEMON_DIR/handoffd-supervisor.log" ]] && tail -30 "$DAEMON_DIR/handoffd-supervisor.log" || echo "(missing)"
  echo

  echo "=== recent failure logs ==="
  ls -lt "$DAEMON_DIR"/handoffd-failure-*.log 2>/dev/null | head -3 || echo "(none)"
  newest="$(ls -t "$DAEMON_DIR"/handoffd-failure-*.log 2>/dev/null | head -1 || true)"
  if [[ -n "$newest" ]]; then
    echo "--- $newest ---"
    cat "$newest"
  fi
  echo

  echo "=== inject-traffic.log (tail 10) ==="
  [[ -f "$ROOT/.swarmforge/handoffs/inject-traffic.log" ]] && tail -10 "$ROOT/.swarmforge/handoffs/inject-traffic.log" || echo "(missing)"
} > "$OUT"

echo "$OUT"
