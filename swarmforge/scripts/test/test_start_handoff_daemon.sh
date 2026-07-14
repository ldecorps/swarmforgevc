#!/usr/bin/env bash
# Ordered daemon startup: handoffd claims pid before supervisor starts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
START_SCRIPT="$SCRIPT_DIR/../start_handoff_daemon.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_fixture() {
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$ROOT/.swarmforge/daemon"
  FAKE_BIN="$ROOT/bin"
  mkdir -p "$FAKE_BIN"

  cat > "$FAKE_BIN/bb" <<EOF
#!/usr/bin/env bash
for arg in "\$@"; do
  if [[ "\$arg" == *fake-handoffd.bb ]]; then
    sleep 120 &
    echo \$! > "$ROOT/.swarmforge/daemon/handoffd.pid"
    touch "$ROOT/.swarmforge/daemon/handoffd.heartbeat"
    echo started-handoffd >> "$ROOT/daemon-order.log"
    exit 0
  fi
  if [[ "\$arg" == *fake-supervisor.bb ]]; then
    sleep 120 &
    echo \$! > "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid"
    echo started-supervisor >> "$ROOT/daemon-order.log"
    exit 0
  fi
done
exec true
EOF
  chmod +x "$FAKE_BIN/bb"
}

run_start() {
  HANDOFFD_BB="$ROOT/bin/fake-handoffd.bb" \
  HANDOFFD_SUPERVISOR_BB="$ROOT/bin/fake-supervisor.bb" \
  PID_WAIT_ATTEMPTS=30 \
  PATH="$FAKE_BIN:$PATH" \
  bash "$START_SCRIPT" "$ROOT"
}

trap '[[ -n "${ROOT:-}" ]] && rm -rf "$ROOT"' EXIT

make_fixture
printf '%s\n' '{"state":"halted","last_incident":{"reason":"dead"}}' > "$ROOT/.swarmforge/daemon/handoffd.status.json"
: > "$ROOT/.swarmforge/daemon/stop"
run_start

[[ -f "$ROOT/.swarmforge/daemon/handoffd.pid" ]] || fail "01: handoffd.pid was not written"
[[ -f "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid" ]] || fail "01: supervisor pid was not written"
grep -q '^started-handoffd$' "$ROOT/daemon-order.log" || fail "01: handoffd did not start"
grep -q '^started-supervisor$' "$ROOT/daemon-order.log" || fail "01: supervisor did not start"
HANDOFFD_LINE="$(grep -n '^started-handoffd$' "$ROOT/daemon-order.log" | cut -d: -f1)"
SUPERVISOR_LINE="$(grep -n '^started-supervisor$' "$ROOT/daemon-order.log" | cut -d: -f1)"
[[ "$HANDOFFD_LINE" -lt "$SUPERVISOR_LINE" ]] || fail "01: supervisor started before handoffd claimed pid"
[[ ! -f "$ROOT/.swarmforge/daemon/stop" ]] || fail "01: stop file was not cleared"
STATE="$(python3 -c 'import json;print(json.load(open("'"$ROOT"'/.swarmforge/daemon/handoffd.status.json"))["state"])')"
[[ "$STATE" == "healthy" ]] || fail "01: halted latch was not cleared, got state=$STATE"
pass "01: start_handoff_daemon.sh clears halt, starts handoffd, then supervisor"

make_fixture
echo "999999" > "$ROOT/.swarmforge/daemon/handoffd.pid"
echo "999998" > "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid"
run_start
NEW_PID="$(< "$ROOT/.swarmforge/daemon/handoffd.pid")"
kill -0 "$NEW_PID" 2>/dev/null || fail "02: repaired daemon pid is not alive"
pass "02: start_handoff_daemon.sh replaces stale daemon pids with a live process"

echo "ALL PASS: start_handoff_daemon ordering"
