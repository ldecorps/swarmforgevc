#!/usr/bin/env bash
# BL-292: launches the headless Telegram front desk - the bridge process
# and the Front Desk Bot process, supervised by front_desk_supervisor.bb
# with bounded restart. Mirrors start_handoff_daemon.sh's own
# stop-then-launch-then-wait-for-pid-claim shape and launch_support.sh's
# own idempotent guard + *_LAUNCH_DRYRUN mode. No tunnel needed - the bot
# polls Telegram outbound and talks to the bridge on localhost.
#
# Usage: launch_front_desk.sh <project-root>
#
# Env (secrets never written into the repo - the SAME posture as
# RESEND_API_KEY; the bridge token is the one exception, machine-local
# and persisted under the gitignored .swarmforge/ tree, never the repo):
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   optional here - the bot's actual
#                                 token/chat come from front_desk_supervisor.bb's
#                                 own resolution (this swarm's fleet creds file,
#                                 or - only for the recorded primary root -
#                                 these env vars; BL-622). Not hard-required by
#                                 THIS script: a swarm with its own creds file
#                                 must still be able to launch from a shell with
#                                 no ambient Telegram env at all (e.g. swarm_ensure's
#                                 stale-pid-file repair path), and a swarm with
#                                 neither is refused loudly by the supervisor
#                                 itself, not by a generic "not set" error here.
#   TELEGRAM_PRINCIPAL_USER_ID   required (operator-provided; unrelated to token
#                                 separation - the bot's own CLI validates it)
#   BRIDGE_PORT                   fixed port the bridge listens on (default 8765)
#   FRONT_DESK_LAUNCH_DRYRUN=1    print the assembled bridge + bot commands, start nothing
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
launch_front_desk.sh — lifecycle start entry point.

Stop: stop_ancillary_services.sh / ./stop-swarm.sh (or ./swarm-kill for pipeline-only)

Usage: see header comments above.
EOF
  exit 0
fi


ROOT="${1:?usage: launch_front_desk.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
SUPERVISOR_BB="$SCRIPT_DIR/front_desk_supervisor.bb"
TOKEN_FILE="$OP_DIR/bridge-token"
PID_FILE="$OP_DIR/front-desk-supervisor.pid"
LOG="$OP_DIR/front-desk-supervisor.log"
BRIDGE_PORT="${BRIDGE_PORT:-8765}"
PID_WAIT_ATTEMPTS="${PID_WAIT_ATTEMPTS:-60}"

BRIDGE_ENTRYPOINT="$ROOT/extension/out/tools/start-bridge-headless.js"
BOT_ENTRYPOINT="$ROOT/extension/out/tools/telegram-front-desk-bot.js"

mkdir -p "$OP_DIR"

PARKED_FILE="$OP_DIR/front-desk-PARKED.md"

# ── park flag (BL-404): a human's explicit "do not restart" decision must
#    survive host sleep and daemon restarts until a human runs
#    unpark_front_desk.sh. Checked before dry-run, token provisioning, and
#    env validation - the same idempotent early-return posture as the
#    already-running guard below, but earlier, so a parked front desk never
#    touches front-desk-supervisor.stop or spawns anything, regardless of
#    caller or mode. ────────────────────────────────────────────────────────
if [[ -f "$PARKED_FILE" ]]; then
  echo "launch_front_desk: front desk is PARKED ($PARKED_FILE exists); not launching" >&2
  exit 0
fi

# ── token provisioning: generate once, persist machine-local (gitignored
#    under .swarmforge/, mode 600), reused across restarts so a respawned
#    bridge/bot pair still shares the same credential - never regenerated
#    per launch, which would desync an already-running peer. The SAME
#    value is given to the bridge (as its accepted token) and the bot (as
#    both BRIDGE_TOKEN and BRIDGE_CONTROL_TOKEN), mirroring extension.ts's
#    own swarmforge.startBridge command's one-token-does-double-duty
#    posture (bridgeServer.ts's normalizeToRegistry). ─────────────────────
if [[ ! -f "$TOKEN_FILE" ]]; then
  bb -e '(let [b (byte-array 24)] (.nextBytes (java.security.SecureRandom.) b) (print (apply str (map #(format "%02x" (bit-and % 0xff)) b))))' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
BRIDGE_TOKEN="$(cat "$TOKEN_FILE")"
export BRIDGE_TOKEN

if [[ "${FRONT_DESK_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN launch_front_desk bridge_port=%s\n' "$BRIDGE_PORT"
  printf 'DRYRUN bridge cmd: node %s %s %s\n' "$BRIDGE_ENTRYPOINT" "$ROOT" "$BRIDGE_PORT"
  printf 'DRYRUN bot cmd: node %s http://127.0.0.1:%s %s\n' "$BOT_ENTRYPOINT" "$BRIDGE_PORT" "$ROOT"
  printf 'DRYRUN bot env: TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID BRIDGE_TOKEN BRIDGE_CONTROL_TOKEN\n'
  exit 0
fi

: "${TELEGRAM_PRINCIPAL_USER_ID:?TELEGRAM_PRINCIPAL_USER_ID is not set}"

# A missing compiled entrypoint is a hard error here (unlike BL-275's own
# OPTIONAL system-prompt flag) - the front desk cannot function without
# either process, so fail loudly and clearly now rather than spawning
# `node <missing-file>` and leaving the supervisor to loop through its own
# bounded-restart cap against a failure that will never self-resolve.
if [[ ! -f "$BRIDGE_ENTRYPOINT" ]]; then
  echo "launch_front_desk: bridge entrypoint not found: $BRIDGE_ENTRYPOINT (run npm run compile in extension/)" >&2
  exit 1
fi
if [[ ! -f "$BOT_ENTRYPOINT" ]]; then
  echo "launch_front_desk: bot entrypoint not found: $BOT_ENTRYPOINT (run npm run compile in extension/)" >&2
  exit 1
fi

# ── idempotent: already running -> do nothing (mirrors launch_support.sh's
#    tmux has-session guard - here a plain pid-alive check, since this
#    supervisor is a background process, not a tmux pane). ────────────────
if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(< "$PID_FILE")"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "launch_front_desk: supervisor already running (pid $existing_pid); not double-launching" >&2
    exit 0
  fi
fi

rm -f "$OP_DIR/front-desk-supervisor.stop"

BRIDGE_PORT="$BRIDGE_PORT" nohup bb "$SUPERVISOR_BB" "$ROOT" >> "$LOG" 2>&1 &
supervisor_launcher_pid=$!

claimed=0
for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if [[ -f "$PID_FILE" ]]; then
    pid="$(< "$PID_FILE")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      claimed=1; break
    fi
  fi
  # BL-622: a refused resolution (no own creds and not the recorded primary
  # root, or a duplicate-token conflict) exits fast and on purpose WITHOUT
  # ever claiming the pid file - stop waiting out the full timeout once the
  # supervisor process itself has already exited, so a refusal reports in
  # under a second rather than PID_WAIT_ATTEMPTS * 0.1s.
  if ! kill -0 "$supervisor_launcher_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if [[ "$claimed" -ne 1 ]]; then
  echo "launch_front_desk: supervisor failed to claim its own pid file under $OP_DIR" >&2
  if [[ -f "$LOG" ]]; then
    echo "launch_front_desk: last lines of $LOG:" >&2
    tail -n 5 "$LOG" >&2
  fi
  exit 1
fi

echo "Started front-desk supervisor (pid $(< "$PID_FILE")); bridge port $BRIDGE_PORT."
