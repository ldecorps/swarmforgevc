#!/usr/bin/env bash
# BL-1253 scenario 04 driver: runs the REAL start_cursor_bridge.sh (never a
# reimplementation, never a source-text assertion) against a fixture root with
# no front-desk feeder, and reports the CURSOR_BRIDGE_INBOUND_QUEUE value the
# script actually exported into the launch.
#
# The script's own dry-run exits BEFORE the feeder block, so dry-run cannot
# observe this. Instead the launch itself is stubbed: a fake `bb` on PATH
# records the exported value and claims the pid file, so the real script runs
# its real feeder decision to the real launch line and nothing is started.
#
# Usage: bl1253StartCursorBridgeFeederCli.sh <fresh|stale|absent>
# Prints one JSON line: {"exitCode":N,"queue":"0|1|","stderr":"..."}

set -uo pipefail

FEEDER="$1"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
START="$REPO_ROOT/swarmforge/scripts/start_cursor_bridge.sh"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

OP_DIR="$ROOT/.swarmforge/operator"
mkdir -p "$OP_DIR" "$ROOT/extension/out/tools" "$ROOT/.swarmforge"
touch "$ROOT/extension/out/tools/telegram-cursor-bridge.js"

# The shared-token shape the hotfix is about: no dedicated bridge token, so
# queue mode is what the script would otherwise default to.
cat > "$ROOT/.swarmforge/swarm.env" <<ENV
export TELEGRAM_BOT_TOKEN=fixture-token
export TELEGRAM_CHAT_ID=-100123
export TELEGRAM_PRINCIPAL_USER_ID=42
unset CURSOR_BRIDGE_BOT_TOKEN
ENV

HB="$OP_DIR/front-desk-poll-heartbeat.json"
case "$FEEDER" in
  fresh) printf '{"lastHeartbeatMs":%s}\n' "$(( $(date +%s) * 1000 ))" > "$HB" ;;
  stale) printf '{"lastHeartbeatMs":%s}\n' "$(( ($(date +%s) - 3600) * 1000 ))" > "$HB" ;;
  absent) : ;;
  *) echo "unknown feeder state: $FEEDER" >&2; exit 2 ;;
esac

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
# Records what the script exported, claims the pid file so the real script's
# own wait loop succeeds, and starts nothing.
cat > "$FAKE_BIN/bb" <<'BB'
#!/usr/bin/env bash
printf '%s' "${CURSOR_BRIDGE_INBOUND_QUEUE-}" > "$BL1253_QUEUE_OUT"
echo $$ > "$BL1253_PID_FILE"
exec sleep 20
BB
chmod +x "$FAKE_BIN/bb"

QUEUE_OUT="$ROOT/queue.txt"
: > "$QUEUE_OUT"

(
  PATH="$FAKE_BIN:$PATH" \
  BL1253_QUEUE_OUT="$QUEUE_OUT" \
  BL1253_PID_FILE="$OP_DIR/cursor-bridge-supervisor.pid" \
  CURSOR_BRIDGE_BOT_TOKEN= \
  CURSOR_BRIDGE_INBOUND_QUEUE= \
    bash "$START" "$ROOT"
) >"$ROOT/stdout.txt" 2>"$ROOT/stderr.txt"
EXIT_CODE=$?

# The fake bb is a background nohup; give it a moment to write.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -s "$QUEUE_OUT" ]] && break
  sleep 0.2
done
# Kill by the pid the stub recorded, never by pattern: a -f pattern match
# reaches every process whose argv merely CONTAINS it, this driver's own
# shell included.
STUB_PID="$(cat "$OP_DIR/cursor-bridge-supervisor.pid" 2>/dev/null || true)"
if [[ "$STUB_PID" =~ ^[0-9]+$ ]]; then kill "$STUB_PID" >/dev/null 2>&1 || true; fi

QUEUE="$(cat "$QUEUE_OUT" 2>/dev/null || true)"
STDERR_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' < "$ROOT/stderr.txt")"
printf '{"exitCode":%s,"queue":"%s","stderr":%s}\n' "$EXIT_CODE" "$QUEUE" "$STDERR_ESCAPED"
