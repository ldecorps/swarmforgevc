#!/usr/bin/env bash
# BL-372: proves the REAL detach mechanism start-swarm.sh uses (nohup ... &,
# the same portable idiom start_handoff_daemon.sh already relies on for
# handoffd) actually survives its launching process exiting, and that
# check_swarm_detached.bb correctly classifies both a still-owned and a
# genuinely-detached process. No real tmux/swarm launch here - the pure
# decision logic is unit-tested in swarm_detach_lib_test_runner.bb; this
# file proves the OS-level mechanism and the real CLI wrapper that shells
# out to `ps`, per the engineering article's ban on tests that wait out
# real time: reparenting-on-parent-exit is synchronous in the kernel, so
# this never sleeps longer than a best-effort scheduling-race guard.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK_DETACHED="$SCRIPT_DIR/../check_swarm_detached.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

cleanup_pids=()
cleanup() {
  local pid
  for pid in "${cleanup_pids[@]:-}"; do
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# ═══════════════════════════════════════════════════════════════════════════
# Scenario: a not-yet-detached child is correctly reported as still owned
# by its live caller (the check must be able to fail, not just pass)
# ═══════════════════════════════════════════════════════════════════════════

sleep 30 &
UNDETACHED_CHILD=$!
cleanup_pids+=("$UNDETACHED_CHILD")

if bb "$CHECK_DETACHED" 1 "$UNDETACHED_CHILD" "$$" >/tmp/check-detached-undetached.out 2>&1; then
  fail "expected check_swarm_detached.bb to reject a child still parented to its live caller, got: $(cat /tmp/check-detached-undetached.out)"
fi
grep -qi "still owned by the caller" /tmp/check-detached-undetached.out \
  || fail "expected a diagnostic naming the swarm as still owned by the caller, got: $(cat /tmp/check-detached-undetached.out)"
pass "01: a child still parented to its live caller is reported as not detached, never a silent pass"

kill -9 "$UNDETACHED_CHILD" 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════
# Scenario: the swarm's caller exits normally after nohup-backgrounding the
# launch - start-swarm.sh's own idiom, mirrored exactly from
# start_handoff_daemon.sh's proven nohup ... & pattern - and the launched
# process survives, reparented away from the now-gone caller.
# ═══════════════════════════════════════════════════════════════════════════

PIDFILE="$(mktemp)"
CALLER_SCRIPT="$(mktemp)"
cat > "$CALLER_SCRIPT" <<EOF
#!/usr/bin/env bash
nohup sleep 30 >/dev/null 2>&1 &
echo \$! > "$PIDFILE"
EOF
chmod +x "$CALLER_SCRIPT"

"$CALLER_SCRIPT" &
CALLER_PID=$!
wait "$CALLER_PID"   # the caller runs to completion and exits normally

CHILD_PID="$(cat "$PIDFILE")"
cleanup_pids+=("$CHILD_PID")

# Reparenting on parent-exit is a synchronous kernel action, not something
# that "eventually" happens - this loop is a bounded scheduling-race guard
# (the wait above already guarantees the caller has exited), never a
# wait-out-real-time poll.
child_ppid=""
for _ in $(seq 1 50); do
  child_ppid="$(ps -o ppid= -p "$CHILD_PID" 2>/dev/null | tr -d ' ')"
  [[ -n "$child_ppid" && "$child_ppid" != "$CALLER_PID" ]] && break
  sleep 0.01
done

[[ -n "$child_ppid" ]] || fail "02: the nohup'd child did not survive its caller's exit at all"
[[ "$child_ppid" != "$CALLER_PID" ]] \
  || fail "02: expected the nohup'd child to be reparented away from its exited caller, still shows ppid=$child_ppid"
pass "02: nohup ... & survives the launching caller exiting normally - the child is reparented away from it, never torn down with it"

if ! bb "$CHECK_DETACHED" 1 "$CHILD_PID" "$CALLER_PID" >/tmp/check-detached-detached.out 2>&1; then
  fail "02: expected check_swarm_detached.bb to accept a properly-reparented child, got: $(cat /tmp/check-detached-detached.out)"
fi
pass "02: check_swarm_detached.bb correctly classifies the reparented child as detached from its (now-exited) caller"

# ═══════════════════════════════════════════════════════════════════════════
# Scenario: the CLI wrapper's own ready-flag parsing (not just the pure lib)
# reports "not ready" first, even when detachment would otherwise look fine -
# closes the one branch of check_swarm_detached.bb's -main that scenarios 01/02
# above never exercise (they only ever pass ready-flag "1").
# ═══════════════════════════════════════════════════════════════════════════

if bb "$CHECK_DETACHED" 0 "$CHILD_PID" "$CALLER_PID" >/tmp/check-detached-notready.out 2>&1; then
  fail "02b: expected check_swarm_detached.bb to fail when ready-flag is 0, got: $(cat /tmp/check-detached-notready.out)"
fi
grep -qi "did not become ready" /tmp/check-detached-notready.out \
  || fail "02b: expected a diagnostic naming the swarm as not ready, got: $(cat /tmp/check-detached-notready.out)"
pass "02b: check_swarm_detached.bb's CLI ready-flag parsing reports not-ready even with a detached server"

# ═══════════════════════════════════════════════════════════════════════════
# Scenario: start-swarm.sh's own source actually uses the detach mechanism
# (structural proof the wrapper is wired to what scenarios 01/02 above
# prove works - a full tmux swarm launch is QA's own E2E procedure)
# ═══════════════════════════════════════════════════════════════════════════

START_SWARM="$SCRIPT_DIR/../../../start-swarm.sh"
[[ -f "$START_SWARM" ]] || fail "03: start-swarm.sh not found at $START_SWARM"
grep -qE '^\s*nohup ' "$START_SWARM" \
  || fail "03: expected start-swarm.sh to detach its ./swarm invocation with nohup, got no nohup line in: $START_SWARM"
grep -q 'check_swarm_detached.bb' "$START_SWARM" \
  || fail "03: expected start-swarm.sh to run the post-launch detachment self-check"
pass "03: start-swarm.sh's own source wires the nohup detach and the post-launch self-check proven above"

echo "ALL PASS"
