#!/usr/bin/env bash
#
# start-swarm.sh — reliably (re)start the SwarmForge swarm headless.
#
# The bare `./swarm` uses a terminal backend (Terminal.app / ghostty) that can
# fail when launched outside an interactive shell (e.g. from the VS Code
# extension host, which also may not have tmux/bb/claude on its PATH). This
# wrapper forces headless mode, makes sure common tool paths are present,
# cleanly stops any swarm already on the socket, then starts and waits until
# every configured role session is up.
#
# Usage:
#   ./start-swarm.sh [target-path]     # defaults to this repo's root
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-$SCRIPT_DIR}"
TARGET="$(cd "$TARGET" && pwd)"

# GUI-launched processes (VS Code) often miss Homebrew paths where tmux/bb/claude live.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

for tool in tmux; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: required tool '$tool' not found on PATH ($PATH)" >&2
    exit 1
  fi
done

SOCKET_FILE="$TARGET/.swarmforge/tmux-socket"
DAEMON_PID_FILE="$TARGET/.swarmforge/daemon/handoffd.pid"

stop_existing() {
  local sock
  [[ -f "$SOCKET_FILE" ]] || return 0
  sock="$(cat "$SOCKET_FILE" 2>/dev/null || true)"
  [[ -n "$sock" ]] || return 0

  local sessions
  sessions="$(tmux -S "$sock" list-sessions -F '#{session_name}' 2>/dev/null || true)"
  if [[ -n "$sessions" ]]; then
    echo "Stopping running swarm on $sock ..."
    while IFS= read -r s; do
      [[ -n "$s" ]] && tmux -S "$sock" kill-session -t "$s" 2>/dev/null || true
    done <<< "$sessions"
  fi

  if [[ -f "$DAEMON_PID_FILE" ]]; then
    local pid
    pid="$(cat "$DAEMON_PID_FILE" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -TERM "$pid" 2>/dev/null || true
  fi
  sleep 1
}

expected_role_count() {
  # The launcher creates one session per `window` line in the active config,
  # so that count is what "ready" means for the run we're about to start.
  local conf="$TARGET/swarmforge/swarmforge.conf"
  if [[ -f "$conf" ]]; then
    grep -cE '^[[:space:]]*window[[:space:]]' "$conf" 2>/dev/null || echo 0
  else
    local roles_file="$TARGET/.swarmforge/roles.tsv"
    [[ -f "$roles_file" ]] && grep -cve '^[[:space:]]*$' "$roles_file" || echo 0
  fi
}

wait_for_ready() {
  local want="$1" i sock n
  for ((i = 0; i < 60; i++)); do
    if [[ -f "$SOCKET_FILE" ]]; then
      sock="$(cat "$SOCKET_FILE" 2>/dev/null || true)"
      if [[ -n "$sock" ]]; then
        n="$(tmux -S "$sock" list-sessions 2>/dev/null | grep -c . || true)"
        if [[ "${n:-0}" -ge "$want" && "$want" -gt 0 ]]; then
          echo "SwarmForge is up: $n session(s) on $sock"
          tmux -S "$sock" list-sessions 2>/dev/null || true
          return 0
        fi
      fi
    fi
    sleep 2
  done
  echo "ERROR: swarm did not become ready (wanted $want sessions)" >&2
  return 1
}

echo "Target: $TARGET"
stop_existing

WANT="$(expected_role_count)"
echo "Launching headless swarm (expecting $WANT roles) ..."
SWARMFORGE_TERMINAL=none "$TARGET/swarm" "$TARGET"

wait_for_ready "$WANT"
