#!/usr/bin/env bash
# Mini App bridge only (no Telegram front-desk poller). Use when the cursor
# bridge already owns getUpdates on the group bot.
#
# Usage: start_bridge_headless.sh <project-root> [port]
#
# Env: BRIDGE_TOKEN from .swarmforge/operator/bridge-token (auto-provisioned).
#      Let's Talk audio + CURSOR_API_KEY from .swarmforge/swarm.env when present.
#   BRIDGE_HEADLESS_LAUNCH_DRYRUN=1    print command, start nothing
set -euo pipefail

ROOT="${1:?usage: start_bridge_headless.sh <project-root> [port]}"
PORT="${2:-8765}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
ENTRYPOINT="$ROOT/extension/out/tools/start-bridge-headless.js"
TOKEN_FILE="$OP_DIR/bridge-token"
PID_FILE="$OP_DIR/bridge-headless.pid"
LOG="$OP_DIR/bridge-headless.log"

mkdir -p "$OP_DIR"

SWARM_ENV="$ROOT/.swarmforge/swarm.env"
if [[ -f "$SWARM_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$SWARM_ENV"
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  bb -e '(let [b (byte-array 24)] (.nextBytes (java.security.SecureRandom.) b) (print (apply str (map #(format "%02x" (bit-and % 0xff)) b))))' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
export BRIDGE_TOKEN="$(cat "$TOKEN_FILE")"

if [[ "${BRIDGE_HEADLESS_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN start_bridge_headless port=%s\n' "$PORT"
  printf 'DRYRUN cmd: node %s %s %s\n' "$ENTRYPOINT" "$ROOT" "$PORT"
  exit 0
fi

if [[ ! -f "$ENTRYPOINT" ]]; then
  echo "start_bridge_headless: entrypoint not found: $ENTRYPOINT (run npm run compile in extension/)" >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true)"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "start_bridge_headless: already running (pid $existing_pid)" >&2
    exit 0
  fi
fi

# Free the port if an orphan from another worktree holds it.
while IFS= read -r line; do
  pid="${line%% *}"
  if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$line" != *"$ROOT"* ]]; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
done < <(pgrep -fl "start-bridge-headless.js.* ${PORT}$" 2>/dev/null || true)
sleep 0.3

nohup env BRIDGE_TOKEN="$BRIDGE_TOKEN" \
  LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}" \
  node "$ENTRYPOINT" "$ROOT" "$PORT" >> "$LOG" 2>&1 &
bridge_pid=$!
echo "$bridge_pid" > "$PID_FILE"

claimed=0
for (( attempt = 1; attempt <= 50; attempt++ )); do
  if kill -0 "$bridge_pid" 2>/dev/null && grep -q "BRIDGE_LISTENING port=${PORT}" "$LOG" 2>/dev/null; then
    claimed=1
    break
  fi
  sleep 0.1
done

if [[ "$claimed" -ne 1 ]]; then
  echo "start_bridge_headless: failed to start (see $LOG)" >&2
  exit 1
fi

echo "Started bridge-headless (pid $bridge_pid) on port $PORT; log $LOG"
