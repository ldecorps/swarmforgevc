#!/usr/bin/env bash
# BL-359: attend_operator.sh - the attended (interactive) Operator launch
# path must register the SAME single-Operator slot signal
# operator-running? already reads for a disposable run (operator.pid), or
# the runtime cannot tell an attended session apart from nothing running
# at all and double-launches a second, unrestricted Operator beside it.
# Real subprocess (a fake `claude` binary standing in for the real CLI -
# never a hand-rolled substitute for attend_operator.sh's own real pid
# registration/cleanup logic), real pid liveness.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
ATTEND="$SRC/attend_operator.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/roles"
  touch "$d/swarmforge/roles/operator.prompt"
  printf '%s' "$d"
}

mk_fake_claude_bin() {
  local dir behavior; dir="$(mktemp -d)"; behavior="$1"
  register_tmp_dir "$dir"
  cat > "$dir/claude" <<EOF
#!/usr/bin/env bash
$behavior
EOF
  chmod +x "$dir/claude"
  printf '%s' "$dir"
}

# ── always-on-operator-presence-06 (write side): registers via operator.pid
#    BEFORE the interactive session starts, using the same signal
#    operator-running? reads ─────────────────────────────────────────────
F="$(mk_fixture)"
FAKE_BIN="$(mk_fake_claude_bin 'sleep 2')"
PATH="$FAKE_BIN:$PATH" bash "$ATTEND" "$F" &
ATTEND_PID=$!
# Poll (bounded, no real-timer proof requirement here - this is real
# subprocess I/O, the case that convention explicitly still permits) for
# the pid file to appear.
for _ in $(seq 1 50); do
  [[ -s "$F/.swarmforge/operator/operator.pid" ]] && break
  sleep 0.1
done
[[ -s "$F/.swarmforge/operator/operator.pid" ]] || fail "expected operator.pid to be written while the attended session is starting"
REGISTERED_PID="$(cat "$F/.swarmforge/operator/operator.pid")"
kill -0 "$REGISTERED_PID" 2>/dev/null || fail "expected the registered pid to be a REAL live process"
pass "always-on-operator-presence-06: an attended session registers a real, live pid before the interactive claude session starts"

wait "$ATTEND_PID" 2>/dev/null || true
[[ ! -f "$F/.swarmforge/operator/operator.pid" ]] || fail "expected operator.pid to be cleaned up once the attended session ends"
pass "the pid registration is cleaned up when the attended session ends (never a stale slot-holder)"
rm -rf "$F" "$FAKE_BIN"

# ── cleanup never clobbers a LATER slot-holder's registration ────────────
# Probes the exact window the script's own cleanup() guards: if a
# different process (e.g. a disposable run) legitimately claims the pid
# file AFTER this attended session's own process started but BEFORE its
# trap fires, the trap must never delete that later registration just
# because IT is exiting.
F="$(mk_fixture)"
FAKE_BIN="$(mk_fake_claude_bin 'sleep 2')"
PATH="$FAKE_BIN:$PATH" bash "$ATTEND" "$F" &
ATTEND_PID=$!
for _ in $(seq 1 50); do
  [[ -s "$F/.swarmforge/operator/operator.pid" ]] && break
  sleep 0.1
done
[[ -s "$F/.swarmforge/operator/operator.pid" ]] || fail "setup: expected the attended session to register"
OTHER_PID=$$
echo "$OTHER_PID" > "$F/.swarmforge/operator/operator.pid"
wait "$ATTEND_PID" 2>/dev/null || true
[[ -s "$F/.swarmforge/operator/operator.pid" ]] || fail "expected the LATER slot-holder's registration to survive this session's own cleanup"
[[ "$(cat "$F/.swarmforge/operator/operator.pid")" == "$OTHER_PID" ]] || fail "expected operator.pid to still name the later slot-holder, got: $(cat "$F/.swarmforge/operator/operator.pid")"
pass "always-on-operator-presence-06: cleanup never removes a pid file a later slot-holder has already claimed"
rm -rf "$F" "$FAKE_BIN"

# ── refuses to double-launch when an Operator is already registered ──────
F="$(mk_fixture)"
FAKE_BIN="$(mk_fake_claude_bin 'sleep 30')"
PATH="$FAKE_BIN:$PATH" bash "$ATTEND" "$F" &
FIRST_PID=$!
for _ in $(seq 1 50); do
  [[ -s "$F/.swarmforge/operator/operator.pid" ]] && break
  sleep 0.1
done
[[ -s "$F/.swarmforge/operator/operator.pid" ]] || fail "setup: expected the first attended session to register"

set +e
PATH="$FAKE_BIN:$PATH" bash "$ATTEND" "$F" 2>/tmp/bl359-attend-second.err
SECOND_STATUS=$?
set -e
[[ "$SECOND_STATUS" -ne 0 ]] || fail "expected a second attend_operator.sh to refuse (nonzero exit) while one is already registered"
grep -q "already registered" /tmp/bl359-attend-second.err || fail "expected the refusal to name the reason, got: $(cat /tmp/bl359-attend-second.err)"
pass "always-on-operator-presence-06: a second attended session refuses to double-launch while one is already registered"
rm -f /tmp/bl359-attend-second.err

kill "$FIRST_PID" 2>/dev/null || true
wait "$FIRST_PID" 2>/dev/null || true
rm -rf "$F" "$FAKE_BIN"

echo "attend_operator smoke: ALL CHECKS PASSED"
