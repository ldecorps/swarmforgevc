#!/usr/bin/env bash
# BL-522: expose the bridge (/resident-spy Mini App) via a Cloudflare quick
# tunnel. Prints the HTTPS base URL. When the URL or bridge token changes,
# posts the full Mini App link into the standing Resident Spy Telegram topic.
#
# Pair with the bridge token:
#   $URL/resident-spy?token=$(cat .swarmforge/operator/bridge-token)
set -euo pipefail
ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"
OP="$ROOT/.swarmforge/operator"
CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
PORT="${BRIDGE_PORT:-8765}"
PID_FILE="$OP/resident-spy-cloudflared.pid"
LOG="$OP/resident-spy-cloudflared.log"
STATE="$OP/resident-spy-tunnel.json"
NOTIFY_JS="$ROOT/extension/out/tools/notify-resident-spy-tunnel.js"
TOKEN_FILE="$OP/bridge-token"

install_cloudflared_if_missing() {
  if [[ -x "$CF" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$CF")"
  local arch cf_arch
  arch="$(uname -m)"
  case "$arch" in
    arm64|aarch64) cf_arch=arm64 ;;
    *) cf_arch=amd64 ;;
  esac
  local tgz="/tmp/cloudflared-darwin-${cf_arch}.tgz"
  echo "launch_resident_spy_tunnel: installing cloudflared to $CF ..." >&2
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${cf_arch}.tgz" -o "$tgz"
  tar -xzf "$tgz" -C "$(dirname "$CF")" cloudflared
  chmod +x "$CF"
  rm -f "$tgz"
}

notify_telegram_if_url_changed() {
  local base_url="$1"
  [[ -n "$base_url" ]] || return 0
  [[ -f "$TOKEN_FILE" ]] || return 0
  [[ -f "$NOTIFY_JS" ]] || {
    echo "launch_resident_spy_tunnel: notify skipped ($NOTIFY_JS missing; run npm run compile in extension/)" >&2
    return 0
  }
  # shellcheck disable=SC1090
  source "$HOME/.zshenv" 2>/dev/null || true
  if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
    echo "launch_resident_spy_tunnel: notify skipped (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set)" >&2
    return 0
  fi
  local token full_url
  token="$(cat "$TOKEN_FILE")"
  full_url="${base_url%/}/resident-spy?token=${token}"
  node "$NOTIFY_JS" --project-root "$ROOT" --url "$full_url" || {
    echo "launch_resident_spy_tunnel: telegram notify failed for $full_url" >&2
    return 0
  }
}

mkdir -p "$OP"
install_cloudflared_if_missing

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PID_FILE")" >&2
else
  : > "$LOG"
  nohup "$CF" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate >"$LOG" 2>&1 &
  echo $! > "$PID_FILE"
fi

URL=""
if [[ -f "$STATE" ]]; then
  URL="$(python3 -c "import json;print(json.load(open('$STATE')).get('url',''))" 2>/dev/null || true)"
fi
for i in $(seq 1 45); do
  fresh="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true)"
  if [[ -n "$fresh" ]]; then
    URL="$fresh"
    break
  fi
  sleep 1
done
[[ -n "$URL" ]] || { echo "no tunnel URL yet; see $LOG" >&2; exit 1; }

python3 -c "import json;print(json.dumps({'url':'$URL','port':$PORT,'path':'/resident-spy'}, indent=2))" > "$STATE"
notify_telegram_if_url_changed "$URL"
echo "$URL"
