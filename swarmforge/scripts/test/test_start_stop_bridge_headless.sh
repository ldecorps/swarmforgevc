#!/usr/bin/env bash
# Smoke tests for start_bridge_headless.sh / stop_bridge_headless.sh (supervised).
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
  cp "$SRC/start_bridge_headless.sh" "$SRC/stop_bridge_headless.sh" \
     "$SRC/bridge_headless_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '' > "$d/extension/out/tools/start-bridge-headless.js"
  printf '%s' "$d"
}

START_IN() { echo "$1/swarmforge/scripts/start_bridge_headless.sh"; }
STOP_IN() { echo "$1/swarmforge/scripts/stop_bridge_headless.sh"; }
PID_FILE_IN() { echo "$1/.swarmforge/operator/bridge-headless-supervisor.pid"; }

F="$(make_fixture)"
DRY="$(BRIDGE_HEADLESS_LAUNCH_DRYRUN=1 bash "$(START_IN "$F")" "$F" 8765 2>&1)"
check "start dry-run prints supervisor command" '[[ "$DRY" == *"DRYRUN start_bridge_headless supervisor cmd:"* ]]'
check "start dry-run writes no pid file" '[[ ! -f "$(PID_FILE_IN "$F")" ]]'
rm -rf "$F"

F="$(make_fixture)"
rm -f "$F/extension/out/tools/start-bridge-headless.js"
OUT="$(bash "$(START_IN "$F")" "$F" 8765 2>&1)" && rc=0 || rc=$?
check "missing compiled entrypoint fails loudly" \
  '[[ "$rc" -ne 0 && "$OUT" == *"entrypoint not found"* ]]'
rm -rf "$F"

F="$(make_fixture)"
sleep 300 &
LIVE_PID=$!
echo "$LIVE_PID" > "$(PID_FILE_IN "$F")"
OUT="$(bash "$(START_IN "$F")" "$F" 8765 2>&1)" && rc=0 || rc=$?
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
check "stop reports stopped" '[[ "$OUT" == *"Stopped bridge-headless"* ]]'
check "stop terminates the recorded supervisor" '! kill -0 "$LIVE_PID" 2>/dev/null'
rm -rf "$F"

F="$(make_fixture)"
OUT="$(bash "$(STOP_IN "$F")" "$F" 2>&1)"
check "stop is idempotent when nothing is running" '[[ "$OUT" == *"not running"* ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "start_stop_bridge_headless smoke: ALL CHECKS PASSED"
else
  echo "start_stop_bridge_headless smoke: FAILURES"; exit 1
fi
