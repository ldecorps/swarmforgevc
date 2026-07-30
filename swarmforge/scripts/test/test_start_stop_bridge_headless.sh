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
     "$SRC/cursor_ripgrep_env.sh" \
     "$d/swarmforge/scripts/"
  printf '' > "$d/extension/out/tools/start-bridge-headless.js"
  # Satisfy resolve_cursor_ripgrep_path (hard-fails when unset in start script).
  printf '#!/bin/sh\nexit 0\n' > "$d/fake-rg"
  chmod +x "$d/fake-rg"
  printf '%s' "$d"
}

START_IN() { echo "$1/swarmforge/scripts/start_bridge_headless.sh"; }
STOP_IN() { echo "$1/swarmforge/scripts/stop_bridge_headless.sh"; }
PID_FILE_IN() { echo "$1/.swarmforge/operator/bridge-headless-supervisor.pid"; }
START() {
  local root="$1"; shift
  env CURSOR_RIPGREP_PATH="$root/fake-rg" bash "$(START_IN "$root")" "$root" "$@"
}

F="$(make_fixture)"
DRY="$(BRIDGE_HEADLESS_LAUNCH_DRYRUN=1 START "$F" 8765 2>&1)"
check "start dry-run prints supervisor command" '[[ "$DRY" == *"DRYRUN start_bridge_headless supervisor cmd:"* ]]'
check "start dry-run writes no pid file" '[[ ! -f "$(PID_FILE_IN "$F")" ]]'
rm -rf "$F"

F="$(make_fixture)"
rm -f "$F/extension/out/tools/start-bridge-headless.js"
OUT="$(START "$F" 8765 2>&1)" && rc=0 || rc=$?
check "missing compiled entrypoint fails loudly" \
  '[[ "$rc" -ne 0 && "$OUT" == *"entrypoint not found"* ]]'
rm -rf "$F"

F="$(make_fixture)"
sleep 300 &
LIVE_PID=$!
echo "$LIVE_PID" > "$(PID_FILE_IN "$F")"
OUT="$(START "$F" 8765 2>&1)" && rc=0 || rc=$?
check "start is idempotent when supervisor pid is alive" \
  '[[ "$rc" -eq 0 && "$OUT" == *"already running"* ]]'
check "idempotent start leaves the existing supervisor running" 'kill -0 "$LIVE_PID" 2>/dev/null'
kill "$LIVE_PID" 2>/dev/null || true
rm -rf "$F"

# When front-desk-supervisor is live, never start a second bridge supervisor
# (that fight is what produces the give-up escalation emails).
F="$(make_fixture)"
sleep 300 &
FD_PID=$!
echo "$FD_PID" > "$F/.swarmforge/operator/front-desk-supervisor.pid"
printf '%s\n' '{"bridge":{"pid":1,"attempts":5,"status":"gave-up","gave-up-at-ms":1},"bot":{"pid":2,"status":"running"}}' \
  > "$F/.swarmforge/operator/front-desk-supervisor.status.json"
# Pretend /lets-talk is down so the handoff re-arms; hide real curl behind a failing stub.
BIN_DIR="$F/.bin"
mkdir -p "$BIN_DIR"
printf '#!/bin/sh\nexit 1\n' > "$BIN_DIR/curl"
chmod +x "$BIN_DIR/curl"
OUT="$(
  env PATH="$BIN_DIR:$PATH" CURSOR_RIPGREP_PATH="$F/fake-rg" PID_WAIT_ATTEMPTS=1 \
    bash "$(START_IN "$F")" "$F" 8765 2>&1
)" && rc=0 || rc=$?
check "start defers to live front-desk-supervisor instead of dual-owning" \
  '[[ "$OUT" == *"front-desk-supervisor"* && "$OUT" == *"re-arming"* ]]'
check "deferred start does not claim bridge-headless-supervisor.pid" \
  '[[ ! -f "$(PID_FILE_IN "$F")" ]]'
BRIDGE_STATUS="$(python3 -c "import json;print(json.load(open('$F/.swarmforge/operator/front-desk-supervisor.status.json'))['bridge']['status'])")"
check "deferred start re-arms front-desk bridge to not-started" \
  '[[ "$BRIDGE_STATUS" == "not-started" ]]'
# Health wait times out against the failing curl stub (expected in this fixture).
check "deferred start times out waiting when bridge stays down" '[[ "$rc" -ne 0 ]]'
kill "$FD_PID" 2>/dev/null || true
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
