#!/usr/bin/env bash
# Starts the supervised Telegram ↔ Cursor SDK remote-control bridge.
# Kept separate from swarm ancillary services — use CURSOR_BRIDGE_BOT_TOKEN
# when the front desk is already polling the same group bot.
#
# Usage: start_cursor_bridge.sh <project-root>
#
# Env: see cursor_bridge_supervisor.bb and swarm.env (sourced below).
#   CURSOR_BRIDGE_LAUNCH_DRYRUN=1    print command, start nothing
set -euo pipefail

ROOT="${1:?usage: start_cursor_bridge.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
SUPERVISOR_BB="$SCRIPT_DIR/cursor_bridge_supervisor.bb"
ENTRYPOINT="$ROOT/extension/out/tools/telegram-cursor-bridge.js"
PID_FILE="$OP_DIR/cursor-bridge-supervisor.pid"
LOG="$OP_DIR/cursor-bridge-supervisor.log"
PID_WAIT_ATTEMPTS="${PID_WAIT_ATTEMPTS:-60}"

mkdir -p "$OP_DIR"

SWARM_ENV="$ROOT/.swarmforge/swarm.env"
if [[ -f "$SWARM_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$SWARM_ENV"
fi

# shellcheck disable=SC1091
source "$SCRIPT_DIR/cursor_ripgrep_env.sh"
resolve_cursor_ripgrep_path "$ROOT"

if [[ "${CURSOR_BRIDGE_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN start_cursor_bridge supervisor cmd: bb %s %s\n' "$SUPERVISOR_BB" "$ROOT"
  printf 'DRYRUN bridge cmd: node %s %s\n' "$ENTRYPOINT" "$ROOT"
  printf 'DRYRUN env: CURSOR_BRIDGE_BOT_TOKEN|TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID CURSOR_API_KEY CURSOR_BRIDGE_MODEL\n'
  exit 0
fi

export TELEGRAM_BOT_TOKEN="${CURSOR_BRIDGE_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:?set CURSOR_BRIDGE_BOT_TOKEN or TELEGRAM_BOT_TOKEN}}"
: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is not set}"
: "${TELEGRAM_PRINCIPAL_USER_ID:?TELEGRAM_PRINCIPAL_USER_ID is not set}"

if [[ ! -f "$ENTRYPOINT" ]]; then
  echo "start_cursor_bridge: entrypoint not found: $ENTRYPOINT (run npm run compile in extension/)" >&2
  exit 1
fi

if [[ ! -f "$SUPERVISOR_BB" ]]; then
  echo "start_cursor_bridge: supervisor not found: $SUPERVISOR_BB" >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(< "$PID_FILE")"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "start_cursor_bridge: supervisor already running (pid $existing_pid)" >&2
    exit 0
  fi
fi

rm -f "$OP_DIR/cursor-bridge-supervisor.stop"

nohup bb "$SUPERVISOR_BB" "$ROOT" >> "$LOG" 2>&1 &

claimed=0
for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if [[ -f "$PID_FILE" ]]; then
    pid="$(< "$PID_FILE")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      claimed=1; break
    fi
  fi
  sleep 0.1
done

if [[ "$claimed" -ne 1 ]]; then
  echo "start_cursor_bridge: supervisor failed to claim pid file under $OP_DIR" >&2
  exit 1
fi

echo "Started cursor-bridge supervisor (pid $(< "$PID_FILE")); log $LOG"
