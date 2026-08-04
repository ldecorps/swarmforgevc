#!/usr/bin/env bash
# BL-785: the freshness cron (BL-675/BL-783) must not resurrect a daemon
# that was stopped ON PURPOSE, while still restarting a genuine crash or
# freeze exactly as before. Mirrors the ticket's six acceptance scenarios.
#
# Declared invariants (BL-654) this file exists to encode:
#   1. Restart happens iff the stop was NOT deliberate (04b/04c below cover
#      the "iff", not just the "if": marker present -> never; marker absent
#      after a genuine crash -> always).
#   2. The deliberate-stop verdict is readable with every bb/node/swarm
#      process dead — see 05 below and
#      test_freshness_stop_marker_lib.sh#07 (static check on the verdict
#      function's body).
# No *.property.test.js exists for this: this project's JS/Vitest
# property-test harness (vitest.properties.config.mjs) covers the
# extension's TypeScript, not POSIX shell/bb swarm scripts — per the
# constitution's Babashka/Clojure toolchain note, swarmforge/scripts/test/
# is this domain's only wired test gate. These scenarios are that
# encoding.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKER="$SRC/daemon_log_freshness_check.sh"
CONF="$SRC/daemon_log_freshness.conf"
KILL_PIPELINE="$SRC/kill_pipeline_swarm.sh"
STOP_ANCILLARY="$SRC/stop_ancillary_services.sh"
START_HANDOFF="$SRC/start_handoff_daemon.sh"
START_BABYSITTERD="$SRC/start_babysitterd.sh"
# shellcheck disable=SC1090
source "$SRC/freshness_stop_marker_lib.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() {
  if eval "$2"; then
    note "ok   - $1"
  else
    note "FAIL - $1"
    fail=1
  fi
}
pass() { note "PASS: $*"; }

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/daemon" "$d/.swarmforge/babysitterd"
  printf '%s' "$d"
}

ts_of() {
  local epoch=$1
  date -u -d "@$epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -r "$epoch" +%Y-%m-%dT%H:%M:%SZ
}

run_checker() {
  local root=$1 now=$2
  FRESHNESS_ROOT="$root" \
  FRESHNESS_CONF="$CONF" \
  FRESHNESS_NOW_EPOCH="$now" \
  FRESHNESS_INCIDENT_FILE="$root/.swarmforge/daemon/freshness-incidents.log" \
  FRESHNESS_COOL_OFF_SECS=300 \
  FRESHNESS_ANNOUNCE_CMD="printf '%s\n' \"\$1\" >> \"$root/announces.log\"" \
  FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> \"$root/kills.log\"" \
  FRESHNESS_START_CMD="printf '%s %s\n' \"\$1\" \"\$2\" >> \"$root/starts.log\"" \
  /bin/sh "$CHECKER"
}

NOW=1700000000
STALE_HANDOFFD="$(ts_of $((NOW - 200)))"   # >120s threshold
STALE_BABYSITTERD="$(ts_of $((NOW - 700)))" # >600s threshold
FRESH="$(ts_of "$NOW")"

# ── 01: full-stack stop — a checker run restarts NEITHER daemon ────────────
ROOT="$(make_root)"
printf '%s heartbeat\n' "$STALE_HANDOFFD" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$STALE_BABYSITTERD" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
freshness_mark_stopped "$ROOT" "handoffd"
freshness_mark_stopped "$ROOT" "babysitterd"
run_checker "$ROOT" "$NOW"
check "01: no kills at all" '[[ ! -f "$ROOT/kills.log" ]]'
check "01: no restarts at all" '[[ ! -f "$ROOT/starts.log" ]]'
pass "01: full-stack stop suppresses restart for both watched daemons"

# ── 02: pipeline-only stop — handoffd suppressed, babysitterd unaffected ──
ROOT="$(make_root)"
printf '%s heartbeat\n' "$STALE_HANDOFFD" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$STALE_BABYSITTERD" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
freshness_mark_stopped "$ROOT" "handoffd"
sleep 120 & FAKE_BB_PID=$!
echo "$FAKE_BB_PID" > "$ROOT/.swarmforge/babysitterd/babysitterd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_BB_PID" 2>/dev/null || true
check "02: handoffd not restarted (deliberately stopped)" \
  '! grep -q "start_handoff_daemon.sh" "$ROOT/starts.log" 2>/dev/null'
check "02: babysitterd IS restarted (never stopped, just froze)" \
  'grep -q "start_babysitterd.sh" "$ROOT/starts.log"'
check "02: only babysitterd was killed" \
  'grep -qx "$FAKE_BB_PID" "$ROOT/kills.log"'
pass "02: pipeline-only stop scopes suppression to handoffd alone"

# ── 03: no stop requested — baseline restart is unaffected (no regression) ─
ROOT="$(make_root)"
printf '%s heartbeat\n' "$STALE_HANDOFFD" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 & FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "03: stale handoffd is killed exactly as today" 'grep -qx "$FAKE_PID" "$ROOT/kills.log"'
check "03: stale handoffd is restarted exactly as today" \
  'grep -q "start_handoff_daemon.sh" "$ROOT/starts.log"'
check "03: incident record appended before announce" \
  'grep -q "daemon=handoffd" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "action=restart" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "03: announce carries the existing FRESHNESS_VIOLATION text" \
  'grep -q "FRESHNESS_VIOLATION restart daemon=handoffd" "$ROOT/announces.log"'
pass "03: unconditional-suppression regression scenario — no marker, no suppression"

# ── 04: stop, then start (real script), then stale — restart happens ───────
ROOT="$(make_root)"
freshness_mark_stopped "$ROOT" "handoffd"
check "04a: marker present immediately after a deliberate stop" \
  'freshness_is_stopped "$ROOT" "handoffd"'
FAKE_BIN="$(mktemp -d)"
register_tmp_dir "$FAKE_BIN"
cat > "$FAKE_BIN/bb" <<EOF
#!/usr/bin/env bash
for arg in "\$@"; do
  if [[ "\$arg" == *fake-handoffd.bb ]]; then
    sleep 120 & echo \$! > "$ROOT/.swarmforge/daemon/handoffd.pid"
    exit 0
  fi
  if [[ "\$arg" == *fake-supervisor.bb ]]; then
    sleep 120 & echo \$! > "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid"
    exit 0
  fi
done
exec true
EOF
chmod +x "$FAKE_BIN/bb"
HANDOFFD_BB="$ROOT/bin/fake-handoffd.bb" \
HANDOFFD_SUPERVISOR_BB="$ROOT/bin/fake-supervisor.bb" \
PID_WAIT_ATTEMPTS=30 \
PATH="$FAKE_BIN:$PATH" \
  bash "$START_HANDOFF" "$ROOT" >/dev/null
check "04b: the real start script re-armed handoffd (marker cleared)" \
  '! freshness_is_stopped "$ROOT" "handoffd"'
STARTED_PID="$(cat "$ROOT/.swarmforge/daemon/handoffd.pid")"
kill "$STARTED_PID" 2>/dev/null || true
# Now a stale heartbeat after re-arm: normal restart must fire.
printf '%s heartbeat\n' "$STALE_HANDOFFD" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 & FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "04c: post-re-arm stale heartbeat is restarted (not suppressed)" \
  'grep -q "start_handoff_daemon.sh" "$ROOT/starts.log"'
pass "04: real start_handoff_daemon.sh re-arms watching; the proof is the restart happening"

# ── 04g: real start_babysitterd.sh re-arms watching (parity with 04a-c) ────
# start_handoff_daemon.sh's freshness_clear_stopped call is proven above by
# actually invoking the real script. start_babysitterd.sh got the identical
# one-line change and, until this scenario, had none of the same proof — the
# BL-785 diff only exercised it indirectly through the checker's own
# FRESHNESS_START_CMD stub, which never runs the real script body at all.
#
# freshness_clear_stopped runs before start_babysitterd.sh even attempts to
# spawn the daemon, so the re-arm assertion below does not depend on the
# daemon's own startup succeeding — only on the script having run at all.
# Deliberately NOT asserted here: that the real babysitterd process comes up
# within start_babysitterd.sh's internal wait window. That is pre-existing,
# BL-785-unrelated startup timing (test_babysitterd_lifecycle.sh shows the
# identical sensitivity on this host, independent of anything this ticket
# touched) — asserting it here would make this scenario flake on a defect
# this ticket does not own. `|| true` keeps that pre-existing flakiness from
# aborting this scenario under `set -e`.
ROOT="$(make_root)"
freshness_mark_stopped "$ROOT" "babysitterd"
check "04g-pre: marker present immediately after a deliberate stop" \
  'freshness_is_stopped "$ROOT" "babysitterd"'
bash "$START_BABYSITTERD" "$ROOT" >/dev/null 2>&1 || true
check "04g: the real start script re-armed babysitterd (marker cleared)" \
  '! freshness_is_stopped "$ROOT" "babysitterd"'
# Best-effort cleanup only — no assertion on whether/when the real daemon
# came up; give it a generous window before giving up on reaping it.
BSD_PIDFILE="$ROOT/.swarmforge/babysitterd/babysitterd.pid"
for _ in $(seq 1 25); do
  [[ -f "$BSD_PIDFILE" ]] && break
  sleep 0.2
done
BSD_PID="$(cat "$BSD_PIDFILE" 2>/dev/null || true)"
if [[ -n "$BSD_PID" ]]; then
  kill -TERM "$BSD_PID" 2>/dev/null || true
  sleep 0.2
  kill -0 "$BSD_PID" 2>/dev/null && kill -KILL "$BSD_PID" 2>/dev/null || true
fi
# Now a stale heartbeat after re-arm: normal restart must fire (parity with 04c).
printf '%s heartbeat\n' "$STALE_BABYSITTERD" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
printf '%s heartbeat\n' "$FRESH" > "$ROOT/.swarmforge/daemon/handoffd.log"
sleep 120 & FAKE_HD_PID=$!
echo "$FAKE_HD_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
sleep 120 & FAKE_BSD_PID=$!
echo "$FAKE_BSD_PID" > "$ROOT/.swarmforge/babysitterd/babysitterd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_HD_PID" 2>/dev/null || true
kill "$FAKE_BSD_PID" 2>/dev/null || true
check "04h: post-re-arm stale babysitterd heartbeat is restarted (not suppressed)" \
  'grep -q "start_babysitterd.sh" "$ROOT/starts.log"'
pass "04g-h: real start_babysitterd.sh re-arms watching; the proof is the restart happening"

# ── 05: deliberate-stop verdict needs no live swarm process ────────────────
# The checker run in 01/02/04c above already executed against fixtures with
# no live bb/node/handoffd/babysitterd process besides the test's own
# disposable `sleep` stand-ins (which the checker never queries — it only
# ever reads FRESHNESS_STOPPED marker files and heartbeat logs). Static
# proof that the verdict function itself issues no process query lives in
# test_freshness_stop_marker_lib.sh#07.
ROOT="$(make_root)"
freshness_mark_stopped "$ROOT" "handoffd"
printf '%s heartbeat\n' "$STALE_HANDOFFD" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
# No handoffd.pid file at all — nothing for the checker to even query.
run_checker "$ROOT" "$NOW"
check "05: verdict reached and honored with no pid file / no process to ask" \
  '[[ ! -f "$ROOT/kills.log" && ! -f "$ROOT/starts.log" ]]'
pass "05: suppression holds from durable state alone, no live process required"

# ── 06: stop paths stay idempotent under the new marker write ──────────────
ROOT="$(make_root)"
bash "$STOP_ANCILLARY" "$ROOT" >/dev/null 2>&1
FIRST_MARKER_CONTENT="$(cat "$ROOT/.swarmforge/daemon/freshness-stopped/babysitterd.stopped")"
bash "$STOP_ANCILLARY" "$ROOT" >/dev/null 2>&1
check "06a: babysitterd marker present after stopping nothing, twice in a row" \
  'freshness_is_stopped "$ROOT" "babysitterd"'
check "06a: exactly one marker file (overwrite, not append)" \
  '[[ "$(wc -l < "$ROOT/.swarmforge/daemon/freshness-stopped/babysitterd.stopped")" -eq 1 ]]'

ROOT2="$(make_root)"
bash "$KILL_PIPELINE" "$ROOT2" >/dev/null 2>&1 || true
bash "$KILL_PIPELINE" "$ROOT2" >/dev/null 2>&1 || true
check "06b: handoffd marker present after two pipeline-only stops of an empty root" \
  'freshness_is_stopped "$ROOT2" "handoffd"'
check "06b: pipeline-only stop still never marks babysitterd" \
  '! freshness_is_stopped "$ROOT2" "babysitterd"'
pass "06: repeated stops (including stopping nothing) stay idempotent"

if [[ "$fail" -eq 0 ]]; then
  echo "BL-785 freshness-deliberate-stop: ALL CHECKS PASSED"
else
  echo "BL-785 freshness-deliberate-stop: FAILURES"
  exit 1
fi
