#!/usr/bin/env bash
# BL-684: stop_ancillary_services.sh must clear the onboarder's artifacts
# under BOTH the old (pre-rename) and new names for this one release (the
# renamed launcher only ever DECLINES to start beside a pre-rename
# supervisor, never adopts or stops it itself - see launch_onboarder.sh and
# test_launch_onboarder.sh). Scenario 06. Runs the REAL script end to end
# against a scratch root - never a mocked signal_pid_file.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
OP_DIR="$ROOT/.swarmforge/operator"
mkdir -p "$OP_DIR"

sleep 300 & OLD_PID=$!
sleep 300 & NEW_PID=$!
echo "$OLD_PID" > "$OP_DIR/onboarding-facilitator-supervisor.pid"
echo "$NEW_PID" > "$OP_DIR/onboarder-supervisor.pid"
echo '{"lastHeartbeatMs":1}' > "$OP_DIR/onboarding-facilitator-heartbeat.json"
echo '{"lastHeartbeatMs":2}' > "$OP_DIR/onboarder-heartbeat.json"
echo '{}' > "$OP_DIR/onboarding-facilitator-supervisor.status.json"
echo '{}' > "$OP_DIR/onboarder-supervisor.status.json"

OUT="$(timeout 20 bash "$SRC/stop_ancillary_services.sh" "$ROOT" 2>&1)"
rc=$?

check "the stop script exits cleanly" '[[ "$rc" -eq 0 ]]'
check "the old-named heartbeat is gone"        '[[ ! -f "$OP_DIR/onboarding-facilitator-heartbeat.json" ]]'
check "the new-named heartbeat is gone"        '[[ ! -f "$OP_DIR/onboarder-heartbeat.json" ]]'
check "the old-named supervisor pid file is gone"  '[[ ! -f "$OP_DIR/onboarding-facilitator-supervisor.pid" ]]'
check "the new-named supervisor pid file is gone"  '[[ ! -f "$OP_DIR/onboarder-supervisor.pid" ]]'
check "the old-named status file is gone"      '[[ ! -f "$OP_DIR/onboarding-facilitator-supervisor.status.json" ]]'
check "the new-named status file is gone"      '[[ ! -f "$OP_DIR/onboarder-supervisor.status.json" ]]'
check "no old-named stop sentinel lingers"     '[[ ! -f "$OP_DIR/onboarding-facilitator-supervisor.stop" ]]'
check "no new-named stop sentinel lingers"     '[[ ! -f "$OP_DIR/onboarder-supervisor.stop" ]]'
check "the process behind the old-named pid was actually signalled"  '! kill -0 "$OLD_PID" 2>/dev/null'
check "the process behind the new-named pid was actually signalled"  '! kill -0 "$NEW_PID" 2>/dev/null'

kill "$OLD_PID" "$NEW_PID" 2>/dev/null || true

if [[ "$fail" -eq 0 ]]; then
  echo "stop_ancillary_services onboarder dual-clear: ALL CHECKS PASSED"
else
  echo "stop_ancillary_services onboarder dual-clear: FAILURES"; exit 1
fi
