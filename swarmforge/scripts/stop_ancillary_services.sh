#!/usr/bin/env bash
# Stop operator runtime, Telegram front desk, babysitter, and remote tunnels.
#
# Paired with start_ancillary_services.sh and stop-swarm.sh (full-stack stop).
# Idempotent — safe when nothing is running.
#
# Usage: stop_ancillary_services.sh [repo-root]
set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
BB_DIR="$ROOT/.swarmforge/babysitter"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

signal_pid_file() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(tr -d '[:space:]' < "$pid_file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.3
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

signal_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -TERM "$pid" 2>/dev/null || true
  sleep 0.2
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
}

stop_front_desk_children() {
  local status_file="$OP_DIR/front-desk-supervisor.status.json"
  [[ -f "$status_file" ]] || return 0
  if command -v jq >/dev/null 2>&1; then
    for key in bridge bot; do
      local pid
      pid="$(jq -r ".${key}.pid // empty" "$status_file" 2>/dev/null || true)"
      [[ -n "$pid" && "$pid" != "null" ]] && signal_pid "$pid"
    done
  else
    while IFS= read -r pid; do
      signal_pid "$pid"
    done < <(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$status_file" 2>/dev/null \
      | grep -oE '[0-9]+$' || true)
  fi
  # Orphans: node bridge/bot entrypoints for this project root.
  while IFS= read -r line; do
    local pid="${line%% *}"
    signal_pid "$pid"
  done < <(pgrep -fl "start-bridge-headless.js.*$ROOT" 2>/dev/null || true)
  while IFS= read -r line; do
    local pid="${line%% *}"
    signal_pid "$pid"
  done < <(pgrep -fl "telegram-front-desk-bot.js.*$ROOT" 2>/dev/null || true)
}

log "stop_ancillary_services begin root=$ROOT"

# Babysitter first — it can relaunch or wake agents while we tear down.
if [[ -d "$BB_DIR" || -f "$SCRIPT_DIR/start_babysitter.sh" ]]; then
  log "stopping babysitter"
  mkdir -p "$BB_DIR"
  touch "$BB_DIR/stop" 2>/dev/null || true
  sleep 0.5
  signal_pid_file "$BB_DIR/runtime.pid"
  sock="$BB_DIR/babysitter-tmux.sock"
  if [[ -S "$sock" ]]; then
    tmux -S "$sock" kill-server 2>/dev/null || true
    rm -f "$sock"
  fi
  rm -f "$BB_DIR/stop" "$BB_DIR/enabled" "$BB_DIR/socket.path" 2>/dev/null || true
fi

# Front desk (graceful stop file — bridge + bot are children).
log "stopping Telegram front desk"
mkdir -p "$OP_DIR"
touch "$OP_DIR/front-desk-supervisor.stop" 2>/dev/null || true
sleep 1
signal_pid_file "$OP_DIR/front-desk-supervisor.pid"
stop_front_desk_children
rm -f "$OP_DIR/front-desk-supervisor.status.json" \
      "$OP_DIR/front-desk-poll-heartbeat.json" 2>/dev/null || true
rm -f "$OP_DIR/front-desk-supervisor.stop"

# Operator runtime (disposable Operator + supervision loop).
log "stopping operator runtime"
touch "$OP_DIR/stop" 2>/dev/null || true
sleep 1
signal_pid_file "$OP_DIR/runtime.pid"
rm -f "$OP_DIR/stop"

# Remote access tunnels.
if [[ -f "$SCRIPT_DIR/operator_tunnel.sh" ]]; then
  log "stopping vscode tunnel"
  bash "$SCRIPT_DIR/operator_tunnel.sh" stop "$ROOT" 2>/dev/null || true
fi
signal_pid_file "$OP_DIR/resident-spy-cloudflared.pid"

log "stop_ancillary_services done"
