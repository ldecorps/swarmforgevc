#!/usr/bin/env bash
# BL-349: handoffd.bb's :on-stuck-escalation! adapter now also emails the
# human (stuck-escalation-email-sweep!), alongside its existing
# write-escalation! file write. The delivery-based arming DECISION logic
# itself is exhaustively covered by stuck_escalation_email_lib_test_runner.bb
# (fake adapters, explicit now-ms, no real daemon/clock); this test only
# proves the REAL daemon reaches and fires the new sweep when chase_sweep_lib's
# OWN unchanged stuck-detection decides "alert" - real in_process fixture,
# real wall-clock stuck-timeout (60s, hardcoded in handoffd.bb's own
# chase-sweep-config), ESCALATION_ALARM_FORCE_RESULT so no real network is
# ever reached.
#
# nudgeCount is pre-seeded at the configured cap (3) so the very FIRST time
# idle time crosses the 60s stuck threshold, chase_sweep_lib's own
# decide-stuck-action returns "alert" directly (skipping the intermediate
# "nudge" stage) - the minimum real wall-clock cost this proof needs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON_PID=""
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    mkdir -p "$ROOT/.swarmforge/daemon" 2>/dev/null || true
    touch "$ROOT/.swarmforge/daemon/stop" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/.swarmforge/handoffs/inbox/in_process" \
  "$ROOT/.swarmforge/handoffs/outbox" "$ROOT/.swarmforge/handoffs/sent"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"

IN_PROCESS_FILE="$ROOT/.swarmforge/handoffs/inbox/in_process/00_20260701T000000Z_000001_from_specifier_to_coder.handoff"
printf 'id: t\nfrom: specifier\nto: coder\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' \
  > "$IN_PROCESS_FILE"
# Pre-seed nudgeCount at the configured cap (maxChases: 3, handoffd.bb's
# own chase-sweep-config) - the FIRST tick that crosses the 60s stuck
# threshold decides "alert" directly, never "nudge" first.
printf '{"nudgeCount":3}\n' > "$IN_PROCESS_FILE.nudge"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "$TMUX_LOG"
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
FORCE_SUCCESS='{"success": true, "status": 200}'

env -u RESEND_API_KEY PATH="$FAKE_BIN:$PATH" \
  ESCALATION_ALARM_FORCE_RESULT="$FORCE_SUCCESS" \
  setsid bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

wait_for_log() {
  local pattern="$1" timeout_s="$2" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$LOG_FILE" ]] && grep -q "$pattern" "$LOG_FILE" 2>/dev/null && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

# The 60s stuck-timeout is real wall-clock (hardcoded in handoffd.bb's own
# chase-sweep-config); this test needs to wait for it to elapse at least
# once for the real daemon to ever reach "alert".
wait_for_log "stuck-escalation-alarm coder delivered" 90 \
  || fail "the stuck-escalation email sweep never fired within 90s; log: $(cat "$LOG_FILE" 2>/dev/null)"

pass "the real daemon's :on-stuck-escalation! adapter reached stuck-escalation-email-sweep! and attempted a real send (forced to succeed)"

grep -q '"coder"' "$ROOT/.swarmforge/daemon/chase-escalations.json" \
  || fail "expected write-escalation! to still record the escalation file, unchanged"
pass "write-escalation!'s own file record is still written, unchanged by the new email leg"

STATE_FILE="$ROOT/.swarmforge/daemon/chase-escalation-email-state.json"
[[ -f "$STATE_FILE" ]] || fail "expected the new per-role email-arming state file to exist"
grep -q '"armed?":true' "$STATE_FILE" || fail "expected coder's email state to be armed after a delivered send, got: $(cat "$STATE_FILE")"
pass "the per-role email-arming state is armed after a real (forced-success) delivery"

grep -q "stuck-escalation-email-error" "$LOG_FILE" && fail "the stuck-escalation email sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "the stuck-escalation email sweep ran without throwing"

echo "ALL PASS"
