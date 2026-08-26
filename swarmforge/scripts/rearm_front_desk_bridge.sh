#!/usr/bin/env bash
# BL-1158: reset front-desk bridge state and wait for /lets-talk — shared by
# start_bridge_headless.sh defer path and operator_runtime miniapp recovery.
#
# Usage: rearm_front_desk_bridge.sh <project-root> [port]
set -euo pipefail

ROOT="${1:?usage: rearm_front_desk_bridge.sh <project-root> [port]}"
PORT="${2:-8765}"
OP_DIR="$ROOT/.swarmforge/operator"
FD_STATUS="$OP_DIR/front-desk-supervisor.status.json"
HEALTH_URL="http://127.0.0.1:${PORT}/lets-talk"
PID_WAIT_ATTEMPTS="${PID_WAIT_ATTEMPTS:-60}"

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

if ! command -v curl >/dev/null 2>&1; then
  exit 0
fi

for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "rearm_front_desk_bridge: front-desk bridge is live on port $PORT"
    exit 0
  fi
  sleep 0.1
done

echo "rearm_front_desk_bridge: timed out waiting for front-desk bridge on $HEALTH_URL" >&2
exit 1
