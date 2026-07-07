#!/usr/bin/env bash
# BL-144: daemon-death alarm. On daemon death the supervisor must (instead of
# restarting) write a failure log, send one alarm email via the shared
# notification mechanism, and hard-stop the swarm - the decision/rendering
# logic in daemon_alarm_lib.bb is a testable module (fake clock, fake
# adapters, no real network/tmux), driven here through
# daemon_alarm_test_runner.bb.
#
# Covers acceptance scenarios BL-144 daemon-death-alarm-01, 02, 05 (the
# content/orchestration half; 03/04 - actual hard-stop and no-auto-restart -
# are covered by test_handoffd_supervisor.sh's wiring into the real
# supervisor).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/daemon_alarm_test_runner.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

bb "$RUNNER" "$ROOT"

# ── 01: failure log captures death timestamp, log tail, history, role counts ─
[[ -f "$ROOT/failure.log" ]] || fail "01: failure log was never written"
grep -q "died_at: 2026-07-07T08:00:00Z" "$ROOT/failure.log" || fail "01: missing death timestamp"
grep -q "reason: dead" "$ROOT/failure.log" || fail "01: missing death reason"
grep -q "line one" "$ROOT/failure.log" || fail "01: missing daemon log tail"
grep -q "coder: inbox/new=2 outbox=1" "$ROOT/failure.log" || fail "01: missing per-role inbox/outbox snapshot"
grep -q "restart_history" "$ROOT/failure.log" || fail "01: missing restart history"
pass "01: failure log contains death timestamp, log tail, history, and per-role counts"

# ── 02: exactly one alarm email is sent, naming the failure log and recovery command ─
CALL_COUNT="$(grep -c "^send-email" "$ROOT/calls.log")"
[[ "$CALL_COUNT" -eq 1 ]] || fail "02: expected exactly one send-email call, got $CALL_COUNT"
grep -q "Failure log: $ROOT/failure.log" "$ROOT/email-text.txt" || fail "02: email did not name the failure log path"
grep -q "run: ./swarm ensure" "$ROOT/email-text.txt" || fail "02: email did not name the recovery command"
pass "02: exactly one alarm email sent, naming the failure log path and recovery command"

# ── 03: the swarm is halted (adapter invoked) before status is written ───────
grep -q "^halt-swarm" "$ROOT/calls.log" || fail "03: halt-swarm! was never invoked"
pass "03: halt-swarm! invoked as part of the orchestration"

# ── 04: terminal status is 'halted', not a restart state ────────────────────
STATE="$(python3 -c "import json; print(json.load(open('$ROOT/status.json'))['state'])")"
[[ "$STATE" == "halted" ]] || fail "04: expected terminal state 'halted', got '$STATE'"
FAILURE_LOG_FIELD="$(python3 -c "import json; print(json.load(open('$ROOT/status.json'))['failure_log'])")"
[[ "$FAILURE_LOG_FIELD" == "$ROOT/failure.log" ]] || fail "04: status did not record the failure log path"
pass "04: status file records a terminal 'halted' state and the failure log path (no restart, no backoff)"

# ── 05: email-not-configured is reported, not thrown, and never touches the network ─
cat > "$ROOT/unconfigured_test.bb" <<EOF
(load-file "$SCRIPT_DIR/../daemon_alarm_lib.bb")
(let [result (daemon-alarm-lib/send-alarm-email! nil "" "onboarding@resend.dev" "subj" "text"
               (fn [& _] (throw (ex-info "must never be called" {}))))]
  (assert (false? (:success result)) "expected success=false when unconfigured")
  (println "unconfigured-ok"))
EOF
bb "$ROOT/unconfigured_test.bb" | grep -q "unconfigured-ok" || fail "05: missing to/api-key must not attempt a real send"
pass "05: send-alarm-email! reports missing configuration instead of attempting a network call"

echo "ALL PASS"
