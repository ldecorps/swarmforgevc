#!/usr/bin/env bash
# Smoke tests for start_cursor_bridge.sh / stop_cursor_bridge.sh (supervised).
set -euo pipefail
set +m
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/swarmforge/scripts" "$d/extension/out/tools" "$d/.swarmforge/operator"
  cp "$SRC/start_cursor_bridge.sh" "$SRC/stop_cursor_bridge.sh" \
     "$SRC/cursor_bridge_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" \
     "$SRC/bridge_supervisor_env_lib.bb" "$SRC/cursor_ripgrep_env.sh" \
     "$SRC/tooling_root_lib.sh" "$SRC/daemon_log_freshness_pulse_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '' > "$d/extension/out/tools/telegram-cursor-bridge.js"
  printf '%s' "$d"
}

START_IN() { echo "$1/swarmforge/scripts/start_cursor_bridge.sh"; }
STOP_IN() { echo "$1/swarmforge/scripts/stop_cursor_bridge.sh"; }
PID_FILE_IN() { echo "$1/.swarmforge/operator/cursor-bridge-supervisor.pid"; }

F="$(make_fixture)"
DRY="$(CURSOR_BRIDGE_LAUNCH_DRYRUN=1 bash "$(START_IN "$F")" "$F" 2>&1)"
check "start dry-run prints supervisor command" '[[ "$DRY" == *"DRYRUN start_cursor_bridge supervisor cmd:"* ]]'
check "start dry-run writes no pid file" '[[ ! -f "$(PID_FILE_IN "$F")" ]]'
rm -rf "$F"

F="$(make_fixture)"
rm -f "$F/extension/out/tools/telegram-cursor-bridge.js"
OUT="$(TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x CURSOR_API_KEY=x \
  bash "$(START_IN "$F")" "$F" 2>&1)" && rc=0 || rc=$?
check "missing compiled entrypoint fails loudly" \
  '[[ "$rc" -ne 0 && "$OUT" == *"entrypoint not found"* ]]'
rm -rf "$F"

F="$(make_fixture)"
sleep 300 &
LIVE_PID=$!
echo "$LIVE_PID" > "$(PID_FILE_IN "$F")"
OUT="$(TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x CURSOR_API_KEY=x \
  bash "$(START_IN "$F")" "$F" 2>&1)" && rc=0 || rc=$?
check "start is idempotent when supervisor pid is alive" \
  '[[ "$rc" -eq 0 && "$OUT" == *"already running"* ]]'
check "idempotent start leaves the existing supervisor running" 'kill -0 "$LIVE_PID" 2>/dev/null'
kill "$LIVE_PID" 2>/dev/null || true
rm -rf "$F"

F="$(make_fixture)"
sleep 300 &
LIVE_PID=$!
echo "$LIVE_PID" > "$(PID_FILE_IN "$F")"
OUT="$(bash "$(STOP_IN "$F")" "$F" 2>&1)"
check "stop removes the supervisor pid file" '[[ ! -f "$(PID_FILE_IN "$F")" ]]'
check "stop reports stopped" '[[ "$OUT" == *"Stopped cursor bridge"* ]]'
check "stop terminates the recorded supervisor" '! kill -0 "$LIVE_PID" 2>/dev/null'
rm -rf "$F"

F="$(make_fixture)"
OUT="$(bash "$(STOP_IN "$F")" "$F" 2>&1)"
check "stop is idempotent when nothing is running" '[[ "$OUT" == *"not running"* ]]'
rm -rf "$F"

# ── BL-1757: a configured tooling root resolves the cursor bridge entrypoint
#    under it instead of the target's own (missing) build; the served root
#    argument passed to the bridge always still names the target ──────────
F="$(make_fixture)"
rm -f "$F/extension/out/tools/telegram-cursor-bridge.js"
TOOL="$(mktemp -d)"; register_tmp_dir "$TOOL"
mkdir -p "$TOOL/extension/out/tools"
printf '' > "$TOOL/extension/out/tools/telegram-cursor-bridge.js"
printf 'config tooling_root %s\n' "$TOOL" > "$F/swarmforge/swarmforge.conf"
DRY="$(CURSOR_BRIDGE_LAUNCH_DRYRUN=1 bash "$(START_IN "$F")" "$F" 2>&1)"
check "a configured tooling root resolves the cursor bridge entrypoint under it, served root still names the target" \
  '[[ "$DRY" == *"DRYRUN bridge cmd: node $TOOL/extension/out/tools/telegram-cursor-bridge.js $F"* ]]'
rm -rf "$F" "$TOOL"

# ── BL-1757: neither the tooling root nor the target has the compiled
#    entrypoint - refuses naming both paths, starts nothing (scenario 04) ──
F="$(make_fixture)"
rm -f "$F/extension/out/tools/telegram-cursor-bridge.js"
TOOL2="$(mktemp -d)"; register_tmp_dir "$TOOL2"
printf 'config tooling_root %s\n' "$TOOL2" > "$F/swarmforge/swarmforge.conf"
OUT="$(TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x CURSOR_API_KEY=x \
  bash "$(START_IN "$F")" "$F" 2>&1)" && rc=0 || rc=$?
check "neither place has the entrypoint: launch refuses (non-zero)" '[[ "$rc" -ne 0 ]]'
check "the refusal names the tooling root's own path" \
  '[[ "$OUT" == *"$TOOL2/extension/out/tools/telegram-cursor-bridge.js"* ]]'
check "the refusal names the target's own path too" \
  '[[ "$OUT" == *"$F/extension/out/tools/telegram-cursor-bridge.js"* ]]'
rm -rf "$F" "$TOOL2"

# ── BL-2060 (hotfix 4453766c28): the auto-decide block exports
#    CURSOR_BRIDGE_INBOUND_QUEUE_SOURCE=auto alongside its own decision, and
#    only when it is the one deciding — an operator's preset value must not
#    be marked. DRYRUN mode exits before this block ever runs (see the
#    comment above), so these drive the real (non-dry-run) path up to the
#    entrypoint-not-found exit and read the exported vars back via a trap
#    set in the sourcing shell (the exports do not survive a subprocess exec,
#    only a `source`) ──────────────────────────────────────────────────────
probe_inbound_queue_exports() {
  # $1: fixture root. Prints "Q=<value-or-unset>|S=<value-or-unset>" from
  # the script's own exported CURSOR_BRIDGE_INBOUND_QUEUE[_SOURCE], captured
  # via a trap that fires when the script's own `exit 1` (entrypoint not
  # found, reached right after the auto-decide block) ends this subshell.
  # fd 3 saves the real stdout BEFORE `source`'s own `>/dev/null 2>&1`
  # redirects fd 1/2: bash runs an EXIT trap fired by an `exit` inside an
  # already-redirected builtin (source never forks) with that redirection
  # still in effect, so a trap printf to the (by-then-/dev/null) fd 1 is
  # silently swallowed - only a fd saved beforehand survives to be read.
  ( set -uo pipefail
    exec 3>&1
    trap 'printf "Q=%s|S=%s\n" "${CURSOR_BRIDGE_INBOUND_QUEUE:-<unset>}" "${CURSOR_BRIDGE_INBOUND_QUEUE_SOURCE:-<unset>}" >&3' EXIT
    source "$(START_IN "$1")" "$1" >/dev/null 2>&1
  )
}

F="$(make_fixture)"
rm -f "$F/extension/out/tools/telegram-cursor-bridge.js"
OUT="$(TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x CURSOR_API_KEY=x probe_inbound_queue_exports "$F")" || true
check "auto-decide with no live front desk forces getUpdates and marks the source auto" \
  '[[ "$OUT" == "Q=0|S=auto" ]]'
rm -rf "$F"

F="$(make_fixture)"
rm -f "$F/extension/out/tools/telegram-cursor-bridge.js"
printf '{"lastHeartbeatMs": %s}' "$(node -e 'console.log(Date.now())')" \
  > "$F/.swarmforge/operator/front-desk-poll-heartbeat.json"
OUT="$(TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x CURSOR_API_KEY=x probe_inbound_queue_exports "$F")" || true
check "auto-decide with a live front desk queues and marks the source auto" \
  '[[ "$OUT" == "Q=1|S=auto" ]]'
rm -rf "$F"

F="$(make_fixture)"
rm -f "$F/extension/out/tools/telegram-cursor-bridge.js"
OUT="$(TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x CURSOR_API_KEY=x \
  CURSOR_BRIDGE_INBOUND_QUEUE=1 probe_inbound_queue_exports "$F")" || true
check "an operator's preset CURSOR_BRIDGE_INBOUND_QUEUE keeps its value and is never marked auto" \
  '[[ "$OUT" == "Q=1|S=<unset>" ]]'
rm -rf "$F"

# ── BL-2060 (hotfix 4453766c28): cursor_bridge_supervisor.bb forwards
#    CURSOR_BRIDGE_INBOUND_QUEUE_SOURCE to the spawned bridge child's env
#    alongside CURSOR_BRIDGE_INBOUND_QUEUE. Verified via a stub `node` on
#    PATH that dumps its own environment instead of running the real bridge
#    entrypoint - the supervisor's own spawn (process/process) is async and
#    fire-and-forget, so a bounded wait reads the dump back once the stub
#    has run and exited ────────────────────────────────────────────────────
F="$(make_fixture)"
FAKEBIN="$(mktemp -d)"; register_tmp_dir "$FAKEBIN"
CAPTURE="$FAKEBIN/env.txt"
cat > "$FAKEBIN/node" <<'EOS'
#!/bin/sh
env > "$CAPTURE_FILE"
exit 1
EOS
chmod +x "$FAKEBIN/node"
PATH="$FAKEBIN:$PATH" CAPTURE_FILE="$CAPTURE" \
  TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x CURSOR_API_KEY=x \
  CURSOR_BRIDGE_INBOUND_QUEUE=0 CURSOR_BRIDGE_INBOUND_QUEUE_SOURCE=auto \
  timeout 15 bb "$F/swarmforge/scripts/cursor_bridge_supervisor.bb" "$F" --check-once >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6 7 8 9 10; do [[ -s "$CAPTURE" ]] && break; sleep 0.2; done
check "cursor_bridge_supervisor forwards CURSOR_BRIDGE_INBOUND_QUEUE to the spawned bridge" \
  'grep -qx "CURSOR_BRIDGE_INBOUND_QUEUE=0" "$CAPTURE"'
check "cursor_bridge_supervisor forwards CURSOR_BRIDGE_INBOUND_QUEUE_SOURCE to the spawned bridge" \
  'grep -qx "CURSOR_BRIDGE_INBOUND_QUEUE_SOURCE=auto" "$CAPTURE"'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "start_stop_cursor_bridge smoke: ALL CHECKS PASSED"
else
  echo "start_stop_cursor_bridge smoke: FAILURES"; exit 1
fi
