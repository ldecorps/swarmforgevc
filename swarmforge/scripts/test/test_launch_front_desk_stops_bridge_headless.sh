#!/usr/bin/env bash
# BL-1158: launch_front_desk stops a live bridge-headless supervisor first.
set -euo pipefail
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
  cp "$SRC/launch_front_desk.sh" "$SRC/stop_bridge_headless.sh" "$d/swarmforge/scripts/"
  printf '' > "$d/extension/out/tools/start-bridge-headless.js"
  printf '' > "$d/extension/out/tools/telegram-front-desk-bot.js"
  printf '%s' "$d"
}

LAUNCH_IN() { echo "$1/swarmforge/scripts/launch_front_desk.sh"; }

F="$(make_fixture)"
sleep 300 &
BH_PID=$!
echo "$BH_PID" > "$F/.swarmforge/operator/bridge-headless-supervisor.pid"
OUT="$(FRONT_DESK_LAUNCH_DRYRUN=1 bash "$(LAUNCH_IN "$F")" "$F" 2>&1)" && rc=0 || rc=$?
check "launch stops live bridge-headless before dry-run continues" \
  '[[ "$OUT" == *"stopping bridge-headless-supervisor"* && "$OUT" == *"front desk owns port"* ]]'
check "launch dry-run still succeeds after stop" '[[ "$rc" -eq 0 && "$OUT" == *"DRYRUN bridge cmd:"* ]]'
check "bridge-headless supervisor was terminated" '! kill -0 "$BH_PID" 2>/dev/null'
kill "$BH_PID" 2>/dev/null || true
rm -rf "$F"

F="$(make_fixture)"
OUT="$(FRONT_DESK_LAUNCH_DRYRUN=1 bash "$(LAUNCH_IN "$F")" "$F" 2>&1)" && rc=0 || rc=$?
check "launch without bridge-headless skips stop message" \
  '[[ "$rc" -eq 0 && "$OUT" != *"stopping bridge-headless-supervisor"* ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "launch_front_desk_stops_bridge_headless smoke: ALL CHECKS PASSED"
else
  echo "launch_front_desk_stops_bridge_headless smoke: FAILURES"; exit 1
fi
