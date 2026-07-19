#!/bin/bash
# BL-522: expose the bridge (/resident-spy Mini App) via a Cloudflare quick
# tunnel. Prints the HTTPS base URL. Pair with the bridge token:
#   $URL/resident-spy?token=$(cat .swarmforge/operator/bridge-token)
set -euo pipefail
ROOT="${1:-.}"
OP="$ROOT/.swarmforge/operator"
CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
PORT="${BRIDGE_PORT:-8765}"
PID_FILE="$OP/resident-spy-cloudflared.pid"
LOG="$OP/resident-spy-cloudflared.log"
STATE="$OP/resident-spy-tunnel.json"

mkdir -p "$OP"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PID_FILE")" >&2
else
  : > "$LOG"
  nohup "$CF" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate >"$LOG" 2>&1 &
  echo $! > "$PID_FILE"
fi

URL=""
for i in $(seq 1 45); do
  URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "no tunnel URL yet; see $LOG" >&2; exit 1; }
python3 -c "import json;print(json.dumps({'url':'$URL','port':$PORT,'path':'/resident-spy'}, indent=2))" > "$STATE"
echo "$URL"
