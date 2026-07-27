#!/usr/bin/env bash
# Starts the Telegram ↔ Cursor SDK remote-control bridge for a repo.
# Kept separate from swarm ancillary services — use a dedicated bot token
# via CURSOR_BRIDGE_BOT_TOKEN when the front desk is already polling.
#
# Principal-only messages in the standing "Cursor Remote" forum topic are
# forwarded to a durable local Cursor agent; replies post back to Telegram.
#
# Usage: start_cursor_bridge.sh <project-root>
#
# Env (secrets never written into the repo):
#   CURSOR_BRIDGE_BOT_TOKEN          preferred Telegram bot token
#   TELEGRAM_BOT_TOKEN               fallback if CURSOR_BRIDGE_BOT_TOKEN unset
#   TELEGRAM_CHAT_ID / TELEGRAM_PRINCIPAL_USER_ID
#   CURSOR_API_KEY
#   CURSOR_BRIDGE_MODEL              optional, default composer-2.5
#   CURSOR_BRIDGE_LAUNCH_DRYRUN=1    print command, start nothing
set -euo pipefail

ROOT="${1:?usage: start_cursor_bridge.sh <project-root>}"
OP_DIR="$ROOT/.swarmforge/operator"
ENTRYPOINT="$ROOT/extension/out/tools/telegram-cursor-bridge.js"
PID_FILE="$OP_DIR/cursor-bridge.pid"
LOG="$OP_DIR/cursor-bridge.log"

mkdir -p "$OP_DIR"

SWARM_ENV="$ROOT/.swarmforge/swarm.env"
if [[ -f "$SWARM_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$SWARM_ENV"
fi

if [[ "${CURSOR_BRIDGE_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN start_cursor_bridge cmd: node %s %s\n' "$ENTRYPOINT" "$ROOT"
  printf 'DRYRUN env: CURSOR_BRIDGE_BOT_TOKEN|TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID CURSOR_API_KEY CURSOR_BRIDGE_MODEL\n'
  exit 0
fi

export TELEGRAM_BOT_TOKEN="${CURSOR_BRIDGE_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:?set CURSOR_BRIDGE_BOT_TOKEN or TELEGRAM_BOT_TOKEN}}"
: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is not set}"
: "${TELEGRAM_PRINCIPAL_USER_ID:?TELEGRAM_PRINCIPAL_USER_ID is not set}"
# Local agents can use the Cursor install's auth when no API key is set.

if [[ ! -f "$ENTRYPOINT" ]]; then
  echo "start_cursor_bridge: entrypoint not found: $ENTRYPOINT (run npm run compile in extension/)" >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(< "$PID_FILE")"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "start_cursor_bridge: already running (pid $existing_pid)" >&2
    exit 0
  fi
fi

nohup node "$ENTRYPOINT" "$ROOT" >> "$LOG" 2>&1 &
echo $! > "$PID_FILE"
echo "Started cursor bridge (pid $(< "$PID_FILE")); log $LOG"
