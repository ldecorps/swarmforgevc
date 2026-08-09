#!/usr/bin/env bash
# BL-522: expose the bridge (/resident-spy Mini App) via Cloudflare Tunnel.
# Default: quick tunnel (ephemeral *.trycloudflare.com).
# Named tunnel (fixed URL): set SWARMFORGE_NAMED_TUNNEL (+ hostname) or place
# .swarmforge/operator/named-tunnel.env (see setup_bubble_named_tunnel.sh and
# docs/how-to/named-tunnel-bubble-musicalsifu.md). No operator-specific
# hostname/zone default ships in this tracked script (BL-787) — named mode
# with no configured hostname fails loud instead of guessing one.
#
# On macOS, also starts detached `caffeinate -dims` (pidfile under operator/) so
# idle/auto-sleep with the lid open does not kill the tunnel. Lid-closed sleep
# is out of scope (needs sudo pmset -c disablesleep 1). Skip with
# SWARMFORGE_SKIP_CAFFEINATE=1; override binary with CAFFEINATE=/path.
#
# Pair with the bridge token:
#   $URL/resident-spy?token=$(cat .swarmforge/operator/bridge-token)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./tunnel_ownership_lib.sh
source "$SCRIPT_DIR/tunnel_ownership_lib.sh"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
launch_resident_spy_tunnel.sh — lifecycle start entry point.

Stop: stop_ancillary_services.sh / ./stop-swarm.sh (or ./swarm-kill for pipeline-only)

Named tunnel (fixed URL) — no default ships here, see:
  swarmforge/config/named-tunnel.env.example
  docs/how-to/named-tunnel-bubble-musicalsifu.md
  (SWARMFORGE_NAMED_TUNNEL / SWARMFORGE_NAMED_TUNNEL_HOSTNAME, or
   .swarmforge/operator/named-tunnel.env from setup_bubble_named_tunnel.sh)

Usage: see header comments above.
EOF
  exit 0
fi

ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"
OP="$ROOT/.swarmforge/operator"
CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
PORT="${BRIDGE_PORT:-8765}"
PID_FILE="$OP/resident-spy-cloudflared.pid"
LOG="$OP/resident-spy-cloudflared.log"
CAFFEINATE_PID_FILE="$OP/resident-spy-caffeinate.pid"
CAFFEINATE_LOG="$OP/resident-spy-caffeinate.log"
STATE="$OP/resident-spy-tunnel.json"
NOTIFY_JS="$ROOT/extension/out/tools/notify-resident-spy-tunnel.js"
TOKEN_FILE="$OP/bridge-token"
NAMED_ENV="$OP/named-tunnel.env"

# Optional local overrides (gitignored). Env already set in the shell wins.
if [[ -f "$NAMED_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1091
  . "$NAMED_ENV"
  set +a
fi

NAMED_TUNNEL="${SWARMFORGE_NAMED_TUNNEL:-}"
NAMED_HOST="${SWARMFORGE_NAMED_TUNNEL_HOSTNAME:-}"
CF_CONFIG="${SWARMFORGE_CLOUDFLARED_CONFIG:-$HOME/.cloudflared/config.yml}"
# Test-only seams (BL-787): named-03 drives the full "never registers" wait
# window, which would otherwise cost 45 real seconds per property-test run.
NAMED_WAIT_ATTEMPTS="${SWARMFORGE_NAMED_TUNNEL_WAIT_ATTEMPTS:-45}"
NAMED_WAIT_INTERVAL="${SWARMFORGE_NAMED_TUNNEL_WAIT_INTERVAL:-1}"

# BL-857: named mode binds the production tunnel name, which has exactly
# one owner - a run from outside the registered operator root is refused
# outright rather than merely asked to clean up after itself, because the
# incident this fixes (sandboxes orphaning cloudflared bound to
# swarmforge-bubble) happens precisely when a sandbox's tree is deleted
# before it can clean up. Quick tunnels (no NAMED_TUNNEL) are unaffected -
# any root may still request an ephemeral trycloudflare.com URL.
if [[ -n "$NAMED_TUNNEL" ]] && ! tunnel_is_operator_root "$ROOT"; then
  recorded_root="$(tunnel_read_operator_root)"
  echo "launch_resident_spy_tunnel: refusing named tunnel '$NAMED_TUNNEL' — this root ($ROOT) is not the registered operator root (${recorded_root:-none recorded yet})." >&2
  echo "  Named-tunnel mode is reserved for the operator instance. Run setup_bubble_named_tunnel.sh once from the real operator root to register it, or omit SWARMFORGE_NAMED_TUNNEL to use a quick tunnel." >&2
  exit 1
fi

# BL-787: named mode requires an explicit hostname — the operator's own
# domain never ships as a script default, and its absence fails loud instead
# of silently falling back to someone else's tunnel.
if [[ -n "$NAMED_TUNNEL" && -z "$NAMED_HOST" ]]; then
  echo "launch_resident_spy_tunnel: named tunnel requested (SWARMFORGE_NAMED_TUNNEL=$NAMED_TUNNEL) but no hostname configured." >&2
  echo "  Set SWARMFORGE_NAMED_TUNNEL_HOSTNAME, or run: bash swarmforge/scripts/setup_bubble_named_tunnel.sh $ROOT" >&2
  exit 1
fi

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

write_state() {
  local url="$1"
  local mode="$2"
  python3 -c "import json;print(json.dumps({'url':'$url','port':$PORT,'path':'/resident-spy','mode':'$mode'}, indent=2))" > "$STATE"
}

# Detached idle-sleep prevention for the tunnel host (macOS). Same nohup+pidfile
# posture as cloudflared — survives closing the launch shell. Does not cover
# clamshell/lid-closed sleep.
ensure_tunnel_caffeinate() {
  if [[ "${SWARMFORGE_SKIP_CAFFEINATE:-}" == "1" ]]; then
    return 0
  fi
  local bin="${CAFFEINATE:-}"
  if [[ -z "$bin" ]]; then
    [[ "$(uname -s)" == "Darwin" ]] || return 0
    bin="$(command -v caffeinate 2>/dev/null || true)"
    [[ -n "$bin" ]] || return 0
  fi
  if [[ ! -x "$bin" ]] && ! command -v "$bin" >/dev/null 2>&1; then
    echo "launch_resident_spy_tunnel: caffeinate skipped (not executable: $bin)" >&2
    return 0
  fi
  if [[ -f "$CAFFEINATE_PID_FILE" ]] && kill -0 "$(tr -d '[:space:]' < "$CAFFEINATE_PID_FILE")" 2>/dev/null; then
    echo "launch_resident_spy_tunnel: caffeinate already running pid=$(tr -d '[:space:]' < "$CAFFEINATE_PID_FILE")" >&2
    return 0
  fi
  : > "$CAFFEINATE_LOG"
  # -d display -i idle system -m disk -s AC system sleep. Not -u (5s without -t).
  nohup "$bin" -dims >>"$CAFFEINATE_LOG" 2>&1 &
  echo $! > "$CAFFEINATE_PID_FILE"
  echo "launch_resident_spy_tunnel: caffeinate -dims pid=$(cat "$CAFFEINATE_PID_FILE") (open-lid idle only)" >&2
}

start_quick_tunnel() {
  : > "$LOG"
  nohup "$CF" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate >"$LOG" 2>&1 &
  echo $! > "$PID_FILE"
}

start_named_tunnel() {
  [[ -f "$CF_CONFIG" ]] || {
    echo "launch_resident_spy_tunnel: named tunnel set ($NAMED_TUNNEL) but config missing: $CF_CONFIG" >&2
    echo "  Run: bash swarmforge/scripts/setup_bubble_named_tunnel.sh $ROOT" >&2
    exit 1
  }
  : > "$LOG"
  nohup "$CF" tunnel --config "$CF_CONFIG" --no-autoupdate run "$NAMED_TUNNEL" >"$LOG" 2>&1 &
  echo $! > "$PID_FILE"
}

wait_quick_url() {
  local url="" i fresh
  if [[ -f "$STATE" ]]; then
    url="$(python3 -c "import json;print(json.load(open('$STATE')).get('url',''))" 2>/dev/null || true)"
  fi
  for i in $(seq 1 45); do
    fresh="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true)"
    if [[ -n "$fresh" ]]; then
      echo "$fresh"
      return 0
    fi
    sleep 1
  done
  if [[ -n "$url" ]]; then
    echo "$url"
    return 0
  fi
  return 1
}

# BL-787: readiness is OBSERVED (a log line proving the edge registered the
# connection), never INFERRED from the tunnel process merely still being
# alive after the wait window — a live-but-unregistered process is exactly
# the BL-716 dead-hostname symptom manufactured locally. If the window
# elapses without observing registration, this fails; the caller writes no
# state and sends no notification.
wait_named_ready() {
  local i
  for i in $(seq 1 "$NAMED_WAIT_ATTEMPTS"); do
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "launch_resident_spy_tunnel: named tunnel process died; see $LOG" >&2
      return 1
    fi
    # cloudflared logs "Registered tunnel connection" when edge is up
    if grep -qE 'Registered tunnel connection|connIndex=' "$LOG" 2>/dev/null; then
      return 0
    fi
    # Fail fast on obvious misconfig
    if grep -qE 'Cannot determine default origin certificate|Unable to find credentials|error parsing config' "$LOG" 2>/dev/null; then
      echo "launch_resident_spy_tunnel: named tunnel failed to start; see $LOG" >&2
      return 1
    fi
    sleep "$NAMED_WAIT_INTERVAL"
  done
  echo "launch_resident_spy_tunnel: named tunnel never registered a connection with the edge after ${NAMED_WAIT_ATTEMPTS} attempts; see $LOG" >&2
  return 1
}

mkdir -p "$OP"
install_cloudflared_if_missing
ensure_tunnel_caffeinate

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PID_FILE")" >&2
else
  if [[ -n "$NAMED_TUNNEL" ]]; then
    echo "launch_resident_spy_tunnel: named tunnel mode name=$NAMED_TUNNEL host=$NAMED_HOST" >&2
    start_named_tunnel
  else
    start_quick_tunnel
  fi
fi

# BL-857: host-level ownership record, independent of $ROOT, so this
# process stays reapable even if the tree that launched it is later
# deleted. Recorded regardless of edge-registration success below (a hung
# or misconfigured named tunnel is still a live process bound to the name
# and still needs to be reapable) and unconditionally overwritten on every
# successful/observed launch, so the registry always tracks whichever pid
# most recently claimed the name.
if [[ -n "$NAMED_TUNNEL" ]]; then
  tunnel_record_owner "$NAMED_TUNNEL" "$(cat "$PID_FILE")" "$ROOT"
fi

URL=""
if [[ -n "$NAMED_TUNNEL" ]]; then
  URL="https://${NAMED_HOST}"
  wait_named_ready || { echo "named tunnel not ready; see $LOG" >&2; exit 1; }
  write_state "$URL" "named"
else
  URL="$(wait_quick_url)" || { echo "no tunnel URL yet; see $LOG" >&2; exit 1; }
  write_state "$URL" "quick"
fi

notify_telegram_if_url_changed "$URL"
echo "$URL"
