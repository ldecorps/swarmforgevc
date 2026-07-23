#!/usr/bin/env bash
# BL-203: verify_daemon_lifecycle.sh and collect_daemon_postmortem.sh read the
# handoffd heartbeat file's mtime with the BSD/macOS-only `stat -f` form and
# no GNU fallback (unlike check_commit_size.sh's file_size_bytes, which tries
# both). On Linux this fails silently (caught by `|| echo missing`/`||
# echo "(missing)"`), so every postmortem and audit log on Linux/WSL reports
# the heartbeat as missing even when it is fresh - masking real staleness in
# diagnostics for this daemon-wiring ticket.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERIFY="$SCRIPT_DIR/../verify_daemon_lifecycle.sh"
POSTMORTEM="$SCRIPT_DIR/../collect_daemon_postmortem.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON_DIR="$ROOT/.swarmforge/daemon"
mkdir -p "$DAEMON_DIR"

# Disposable child processes stand in for a live handoffd/supervisor so the
# probes see "alive" without touching this test's own pid (engineering rule:
# never target the test's own process from code under test).
sleep 120 & HANDOFFD_PID=$!
sleep 120 & SUPERVISOR_PID=$!
cleanup() {
  kill "$HANDOFFD_PID" "$SUPERVISOR_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

echo "$HANDOFFD_PID" > "$DAEMON_DIR/handoffd.pid"
echo "$SUPERVISOR_PID" > "$DAEMON_DIR/handoffd-supervisor.pid"
touch "$DAEMON_DIR/handoffd.heartbeat"

# ── 1: verify_daemon_lifecycle.sh's audit log must record a real heartbeat
#       mtime, not "missing", when the heartbeat file exists and probes pass
#       on the first attempt (no daemon start needed) ──────────────────────
SWARMFORGE_SKIP_DAEMON="" DAEMON_VERIFY_ATTEMPTS=1 bash "$VERIFY" "$ROOT" >/dev/null 2>&1 \
  || fail "01: verify_daemon_lifecycle.sh should succeed with both pids alive"
AUDIT="$DAEMON_DIR/daemon-start-audit.log"
[[ -f "$AUDIT" ]] || fail "01: expected an audit log at $AUDIT"
grep -q "heartbeat_mtime=missing" "$AUDIT" \
  && fail "01: heartbeat_mtime read as missing even though the heartbeat file exists (BSD-only stat -f, no Linux fallback)"
grep -qE "heartbeat_mtime=[0-9]+" "$AUDIT" \
  || fail "01: expected a numeric heartbeat_mtime in the audit log, got: $(grep heartbeat_mtime "$AUDIT" || true)"
pass "01: verify_daemon_lifecycle.sh reports a real heartbeat mtime on this platform"

# ── 2: collect_daemon_postmortem.sh must report the heartbeat mtime/size,
#       not "(missing)", when the heartbeat file exists ────────────────────
POSTMORTEM_LOG="$(bash "$POSTMORTEM" "$ROOT")"
[[ -f "$POSTMORTEM_LOG" ]] || fail "02: expected a postmortem log to be written"
grep -q "heartbeat: (missing)" "$POSTMORTEM_LOG" \
  && fail "02: postmortem reports heartbeat (missing) even though the heartbeat file exists (BSD-only stat -f, no Linux fallback)"
grep -qi "heartbeat mtime=" "$POSTMORTEM_LOG" \
  || fail "02: expected a 'heartbeat mtime=' line in the postmortem, got: $(grep -i heartbeat "$POSTMORTEM_LOG" || true)"
pass "02: collect_daemon_postmortem.sh reports a real heartbeat mtime on this platform"

# ── 3: a failed stat probe attempt must not leak its stdout (e.g. GNU
#       stat -f's filesystem-status dump) into the postmortem log ─────────
grep -q "Block size:" "$POSTMORTEM_LOG" \
  && fail "03: postmortem leaked a failed stat probe's filesystem-status output into the log"
pass "03: no stray stat-probe output leaked into the postmortem log"

echo "ALL PASS"
