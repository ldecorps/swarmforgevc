#!/usr/bin/env bash
# BL-1727: ollama_ancillary_stop_pid's own contract, directly - a process
# that exits after TERM, one that ignores TERM (forcing the KILL
# escalation), one already gone, and one this user cannot signal at all.
# Every "alive" check here is a real `kill -0` against a real process,
# never simulated: the fixtures are real Node children with real signal
# handlers, run through the REAL lib (sourced, never reimplemented).
# Short bounds (env overrides) keep the whole file in low single-digit
# seconds - the function's own default bounds are exercised separately by
# the acceptance feature's fixed two-second case.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

LIB="$SCRIPT_DIR/../ollama_ancillary_lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

export OLLAMA_ANCILLARY_STOP_TERM_GRACE_SECONDS=1
export OLLAMA_ANCILLARY_STOP_KILL_GRACE_SECONDS=1
export OLLAMA_ANCILLARY_STOP_POLL_INTERVAL_SECONDS=1

alive() { kill -0 "$1" >/dev/null 2>&1; }

# A real child that ignores SIGTERM outright and only a real SIGKILL ends
# it - node's own default SIGTERM action is replaced the moment a listener
# is registered, so this genuinely does not exit on TERM (never a mock).
# Output redirected to /dev/null: an unredirected background job inherits
# this function's stdout, and since that function is invoked inside a
# `$(...)` capture, the capture would then block reading until EOF on that
# pipe - which never comes while a long-running child still holds the
# write end open (BL-1727's own first run: every scenario hung).
spawn_ignores_term() {
  node -e 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);' >/dev/null 2>&1 &
  echo "$!"
}

# A real child that exits ~300ms after receiving TERM - long enough to
# prove the helper actually WAITS (never escalates to KILL) before the
# process is confirmed gone on its own.
spawn_exits_after_term() {
  node -e 'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 300)); setInterval(() => {}, 1000);' >/dev/null 2>&1 &
  echo "$!"
}

# ── 01: a process that exits after TERM succeeds without needing KILL ───
PID1="$(spawn_exits_after_term)"
sleep 0.2
source "$LIB"
if ! ollama_ancillary_stop_pid "$PID1"; then
  fail "01: expected ollama_ancillary_stop_pid to succeed for a process that exits after TERM"
fi
alive "$PID1" && fail "01: pid $PID1 is still alive after a successful stop"
pass "01: a process that exits after TERM is confirmed gone, and the call succeeds"

# ── 02: a process that ignores TERM is force-killed and the call still succeeds ──
PID2="$(spawn_ignores_term)"
sleep 0.2
if ! ollama_ancillary_stop_pid "$PID2"; then
  fail "02: expected ollama_ancillary_stop_pid to succeed for a process forced through KILL"
fi
alive "$PID2" && fail "02: pid $PID2 is still alive after a successful stop"
pass "02: a process that ignores TERM is escalated to KILL and confirmed gone"

# ── 03: an already-exited pid succeeds immediately ───────────────────────
node -e 'process.exit(0);' >/dev/null 2>&1 &
PID3=$!
wait "$PID3" 2>/dev/null || true
if ! ollama_ancillary_stop_pid "$PID3"; then
  fail "03: expected ollama_ancillary_stop_pid to succeed for an already-gone pid"
fi
pass "03: an already-exited pid is reported stopped without signalling anything new"

# ── 04: a pid this user cannot signal fails, naming the pid ──────────────
# A shell function named `kill` shadows the builtin (function lookup
# precedes builtin lookup in bash) for every call inside THIS process,
# including the lib's own `ollama_ancillary_pid_alive`. `-0` (the liveness
# check) is passed straight through to the real builtin so the process
# genuinely still looks alive; every other signal (TERM, KILL) is
# swallowed - simulating "cannot be signalled" (EPERM) without needing a
# real OS permission boundary, which `kill -0` cannot reliably distinguish
# from "gone" in the first place.
kill() {
  case "$1" in
    -0) builtin kill "$@" ;;
    *) return 0 ;;
  esac
}

PID4="$(spawn_ignores_term)"
sleep 0.2
STDERR4="$(mktemp)"
register_tmp_dir "$STDERR4"
if ollama_ancillary_stop_pid "$PID4" 2>"$STDERR4"; then
  fail "04: expected ollama_ancillary_stop_pid to fail for a pid this user cannot signal"
fi
grep -q "$PID4" "$STDERR4" || fail "04: expected the failure to name pid $PID4, got: $(cat "$STDERR4")"
unset -f kill
builtin kill -9 "$PID4" >/dev/null 2>&1 || true
pass "04: a pid that cannot be signalled is reported failed, naming the pid"

echo "ALL PASS"
