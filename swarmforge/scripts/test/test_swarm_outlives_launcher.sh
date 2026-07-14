#!/usr/bin/env bash
# BL-372: proves the REAL detach mechanism start-swarm.sh uses (nohup ... &,
# the same portable idiom start_handoff_daemon.sh already relies on for
# handoffd) actually survives its launching process exiting, and that
# check_swarm_detached.bb correctly classifies both a still-owned and a
# genuinely-detached process.
#
# REVISED (architect bounce, 2026-07-14): the first cut of this file (and
# check_swarm_detached.bb) checked the launched process's PPID against the
# caller's pid - a signal that, per an independent architect repro,
# NEVER discriminates against a REAL tmux server (its own server
# self-daemonizes unconditionally, reparented away from its caller within
# a fraction of a second, identically whether or not nohup was used - see
# backlog/evidence/BL-372-swarm-outlives-its-launcher-20260714-architect-bounce.md).
# The check now reads the launch job's own SIGHUP-ignored bit instead
# (nohup's own direct, immediate effect on the process it wraps) - this
# file's scenario 04 below proves that THIS signal, unlike ppid, actually
# discriminates even when the launch chain culminates in a real tmux
# server, closing the exact gap that let the original defect ship past
# the automated suite.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK_DETACHED="$SCRIPT_DIR/../check_swarm_detached.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

cleanup_pids=()
cleanup_socks=()
cleanup() {
  local pid sock
  for sock in "${cleanup_socks[@]:-}"; do
    [[ -n "$sock" ]] && tmux -S "$sock" kill-server 2>/dev/null || true
  done
  for pid in "${cleanup_pids[@]:-}"; do
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 01: a not-yet-detached child (no nohup) is correctly reported as
# still owned by its caller (the check must be able to fail, not just pass)
# ═══════════════════════════════════════════════════════════════════════════

sleep 30 &
UNDETACHED_CHILD=$!
cleanup_pids+=("$UNDETACHED_CHILD")

if bb "$CHECK_DETACHED" 1 "$UNDETACHED_CHILD" >/tmp/check-detached-undetached.out 2>&1; then
  fail "01: expected check_swarm_detached.bb to reject a child that was never nohup'd, got: $(cat /tmp/check-detached-undetached.out)"
fi
grep -qi "still owned by the caller" /tmp/check-detached-undetached.out \
  || fail "01: expected a diagnostic naming the launch as still owned by the caller, got: $(cat /tmp/check-detached-undetached.out)"
pass "01: a child that was never nohup'd is reported as not detached, never a silent pass"

kill -9 "$UNDETACHED_CHILD" 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 02: a nohup'd child is correctly reported as detached
# ═══════════════════════════════════════════════════════════════════════════

nohup sleep 30 >/dev/null 2>&1 &
NOHUP_CHILD=$!
cleanup_pids+=("$NOHUP_CHILD")

if ! bb "$CHECK_DETACHED" 1 "$NOHUP_CHILD" >/tmp/check-detached-detached.out 2>&1; then
  fail "02: expected check_swarm_detached.bb to accept a nohup'd child, got: $(cat /tmp/check-detached-detached.out)"
fi
pass "02: a nohup'd child is correctly classified as detached"

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 02b: the CLI wrapper's own ready-flag parsing reports "not
# ready" first, even when detachment would otherwise look fine - closes
# the one branch of check_swarm_detached.bb's -main scenarios 01/02 above
# never exercise (they only ever pass ready-flag "1").
# ═══════════════════════════════════════════════════════════════════════════

if bb "$CHECK_DETACHED" 0 "$NOHUP_CHILD" >/tmp/check-detached-notready.out 2>&1; then
  fail "02b: expected check_swarm_detached.bb to fail when ready-flag is 0, got: $(cat /tmp/check-detached-notready.out)"
fi
grep -qi "did not become ready" /tmp/check-detached-notready.out \
  || fail "02b: expected a diagnostic naming the swarm as not ready, got: $(cat /tmp/check-detached-notready.out)"
pass "02b: check_swarm_detached.bb's CLI ready-flag parsing reports not-ready even with a detached launch"

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 03: the swarm's caller exits normally after nohup-backgrounding
# the launch - start-swarm.sh's own idiom - and the launched process
# survives, its SIGHUP-ignored bit intact after the caller is long gone.
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

if ! bb "$CHECK_DETACHED" 1 "$CHILD_PID" >/tmp/check-detached-survived.out 2>&1; then
  fail "03: expected the nohup'd child to still read as detached after its caller exited, got: $(cat /tmp/check-detached-survived.out)"
fi
pass "03: nohup ... & survives the launching caller exiting normally, and still reads as detached afterward"

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 04 (THE ARCHITECT'S OWN GAP, closed): the check must discriminate
# even when the launch chain culminates in a REAL tmux server - a bare
# ppid/session check on the SERVER itself cannot (tmux self-daemonizes
# unconditionally, masking the launcher's own fix or its absence). Proves
# the check now targets the LAUNCH JOB, not the server, by driving a real
# tmux new-session through both an undetached and a nohup'd launch chain.
# ═══════════════════════════════════════════════════════════════════════════

if ! command -v tmux >/dev/null 2>&1; then
  echo "SKIP: 04 - tmux not available on this host"
else
  TMUX_FIXTURE_BASE="$(mktemp -d)"

  # start-swarm.sh checks its launch job's pid RIGHT AFTER backgrounding it
  # (see start-swarm.sh's own comment on why: no race to wait out, and the
  # job may have exited entirely by the time wait_for_ready succeeds). In
  # production that launch job is swarmforge.sh, which stays busy well
  # past creating the tmux server - provisioning every role's session,
  # writing prompts and state files - so it is reliably still alive at
  # check time. A bare `tmux new-session` one-liner is NOT a realistic
  # stand-in for that (tmux's client forks the server and returns almost
  # instantly, so the wrapping process would already be gone by check
  # time regardless of nohup - a false negative that proves nothing); the
  # trailing sleep here models that same post-session-creation work.
  launch_tmux_and_stay_busy() {
    tmux -S "$1" new-session -d -s "$2" 'sleep 30'
    sleep 5
  }

  # 04a: launched WITHOUT nohup - the launch job itself must read as
  # not-detached, even though the real tmux server it spawns will (per the
  # architect's own repro) already show a foreign ppid and ignored SIGHUP
  # regardless - proving THIS check no longer trusts that masked signal.
  SOCK_A="$TMUX_FIXTURE_BASE/undetached.sock"
  launch_tmux_and_stay_busy "$SOCK_A" undetached &
  LAUNCH_JOB_A=$!
  cleanup_socks+=("$SOCK_A")
  cleanup_pids+=("$LAUNCH_JOB_A")
  if bb "$CHECK_DETACHED" 1 "$LAUNCH_JOB_A" >/tmp/check-detached-real-tmux-undetached.out 2>&1; then
    fail "04a: expected a real-tmux launch chain WITHOUT nohup to still read as not detached, got: $(cat /tmp/check-detached-real-tmux-undetached.out)"
  fi
  pass "04a: a real tmux launch chain without nohup still reads as not detached - the check is not fooled by tmux's own server self-daemonizing"

  # 04b: launched WITH nohup, the same shape start-swarm.sh uses - the
  # launch job must read as detached.
  SOCK_B="$TMUX_FIXTURE_BASE/detached.sock"
  export -f launch_tmux_and_stay_busy
  nohup bash -c 'launch_tmux_and_stay_busy "$1" "$2"' _ "$SOCK_B" detached >/dev/null 2>&1 &
  LAUNCH_JOB_B=$!
  cleanup_socks+=("$SOCK_B")
  cleanup_pids+=("$LAUNCH_JOB_B")
  if ! bb "$CHECK_DETACHED" 1 "$LAUNCH_JOB_B" >/tmp/check-detached-real-tmux-detached.out 2>&1; then
    fail "04b: expected a real-tmux launch chain launched via nohup to read as detached, got: $(cat /tmp/check-detached-real-tmux-detached.out)"
  fi
  pass "04b: a real tmux launch chain launched via nohup reads as detached - the same shape start-swarm.sh uses in production"

  rm -rf "$TMUX_FIXTURE_BASE"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 05: start-swarm.sh's own source actually uses the detach
# mechanism and runs the self-check against its own launch job's pid.
# ═══════════════════════════════════════════════════════════════════════════

START_SWARM="$SCRIPT_DIR/../../../start-swarm.sh"
[[ -f "$START_SWARM" ]] || fail "05: start-swarm.sh not found at $START_SWARM"
grep -qE '^\s*nohup ' "$START_SWARM" \
  || fail "05: expected start-swarm.sh to detach its ./swarm invocation with nohup, got no nohup line in: $START_SWARM"
grep -q 'LAUNCH_PID=\$!' "$START_SWARM" \
  || fail "05: expected start-swarm.sh to capture its own launch job's pid"
grep -q 'check_swarm_detached.bb' "$START_SWARM" \
  || fail "05: expected start-swarm.sh to run the post-launch detachment self-check"
pass "05: start-swarm.sh's own source wires the nohup detach and the post-launch self-check proven above"

echo "ALL PASS"
