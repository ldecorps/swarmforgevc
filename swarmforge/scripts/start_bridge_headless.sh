#!/usr/bin/env bash
# Starts the supervised Mini App headless bridge (no Telegram front-desk poller).
# Use when the cursor bridge already owns getUpdates on the group bot.
#
# Usage: start_bridge_headless.sh <project-root> [port]
#
# Env: BRIDGE_TOKEN from .swarmforge/operator/bridge-token (auto-provisioned).
#      Let's Talk audio + CURSOR_API_KEY from .swarmforge/swarm.env when present.
#   BRIDGE_HEADLESS_LAUNCH_DRYRUN=1    print command, start nothing
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
start_bridge_headless.sh — lifecycle start entry point.

Stop: stop_ancillary_services.sh / ./stop-swarm.sh (or ./swarm-kill for pipeline-only)

Usage: see header comments above.
EOF
  exit 0
fi


ROOT="${1:?usage: start_bridge_headless.sh <project-root> [port]}"
PORT="${2:-8765}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
SUPERVISOR_BB="$SCRIPT_DIR/bridge_headless_supervisor.bb"
ENTRYPOINT="$ROOT/extension/out/tools/start-bridge-headless.js"
TOKEN_FILE="$OP_DIR/bridge-token"
PID_FILE="$OP_DIR/bridge-headless-supervisor.pid"
LOG="$OP_DIR/bridge-headless-supervisor.log"
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

unset CURSOR_AGENT CURSOR_CONVERSATION_ID CURSOR_LAYOUT __CURSOR_SANDBOX_ENV_RESTORE 2>/dev/null || true

export BRIDGE_PORT="$PORT"

if [[ ! -f "$TOKEN_FILE" ]]; then
  bb -e '(let [b (byte-array 24)] (.nextBytes (java.security.SecureRandom.) b) (print (apply str (map #(format "%02x" (bit-and % 0xff)) b))))' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
export BRIDGE_TOKEN="$(cat "$TOKEN_FILE")"

if [[ "${BRIDGE_HEADLESS_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN start_bridge_headless supervisor cmd: bb %s %s\n' "$SUPERVISOR_BB" "$ROOT"
  printf 'DRYRUN bridge cmd: node %s %s %s\n' "$ENTRYPOINT" "$ROOT" "$PORT"
  exit 0
fi

if [[ ! -f "$ENTRYPOINT" ]]; then
  echo "start_bridge_headless: entrypoint not found: $ENTRYPOINT (run npm run compile in extension/)" >&2
  exit 1
fi

if [[ ! -f "$SUPERVISOR_BB" ]]; then
  echo "start_bridge_headless: supervisor not found: $SUPERVISOR_BB" >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true)"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "start_bridge_headless: supervisor already running (pid $existing_pid)" >&2
    exit 0
  fi
fi

# Front desk already owns start-bridge-headless on this port. Starting
# bridge_headless_supervisor.bb in parallel causes EADDRINUSE crash loops in
# front_desk_supervisor (give-up emails). Hand off: re-arm front desk if the
# port is down, never spawn a second supervisor.
FD_PID_FILE="$OP_DIR/front-desk-supervisor.pid"
FD_STATUS="$OP_DIR/front-desk-supervisor.status.json"
HEALTH_URL="http://127.0.0.1:${PORT}/lets-talk"
if [[ -f "$FD_PID_FILE" ]]; then
  fd_pid="$(tr -d '[:space:]' < "$FD_PID_FILE" 2>/dev/null || true)"
  if [[ "$fd_pid" =~ ^[0-9]+$ ]] && kill -0 "$fd_pid" 2>/dev/null; then
    if command -v curl >/dev/null 2>&1 && curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "start_bridge_headless: front-desk-supervisor (pid $fd_pid) already serves $HEALTH_URL; not starting a second supervisor" >&2
      exit 0
    fi
    echo "start_bridge_headless: front-desk-supervisor (pid $fd_pid) owns this stack; re-arming its bridge instead of starting bridge-headless-supervisor" >&2
    if [[ -f "$FD_STATUS" ]] && command -v python3 >/dev/null 2>&1; then
      python3 - "$FD_STATUS" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
try:
    d = json.loads(p.read_text())
except Exception:
    d = {}
bot = d.get("bot")
d["bridge"] = {
    "pid": None,
    "attempts": 0,
    "status": "not-started",
    "crashed-at-ms": None,
    "started-at-ms": None,
    "gave-up-at-ms": None,
}
if bot is not None:
    d["bot"] = bot
p.write_text(json.dumps(d) + "\n")
PY
    fi
    if command -v curl >/dev/null 2>&1; then
      for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
        if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
          echo "start_bridge_headless: front-desk bridge is live on port $PORT"
          exit 0
        fi
        sleep 0.1
      done
      echo "start_bridge_headless: timed out waiting for front-desk bridge on $HEALTH_URL" >&2
      exit 1
    fi
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

rm -f "$OP_DIR/bridge-headless-supervisor.stop"

nohup bb "$SUPERVISOR_BB" "$ROOT" >> "$LOG" 2>&1 &

claimed=0
for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if [[ -f "$PID_FILE" ]]; then
    pid="$(tr -d '[:space:]' < "$PID_FILE")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      claimed=1
      break
    fi
  fi
  sleep 0.1
done

if [[ "$claimed" -ne 1 ]]; then
  echo "start_bridge_headless: supervisor failed to claim pid file under $OP_DIR" >&2
  exit 1
fi

echo "Started bridge-headless supervisor (pid $(< "$PID_FILE")) on port $PORT; log $LOG"
