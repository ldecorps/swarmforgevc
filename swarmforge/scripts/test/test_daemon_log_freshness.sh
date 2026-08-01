#!/usr/bin/env bash
# BL-675: unit/property tests for the POSIX daemon log-freshness checker and
# heartbeat emission. All seams injected — no real timers, no live swarm
# paths, no killing this test process.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKER="$SRC/daemon_log_freshness_check.sh"
INSTALLER="$SRC/install_freshness_cron.sh"
CONF="$SRC/daemon_log_freshness.conf"
BABYSITTERD_SH="$SRC/babysitterd.sh"

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

chmod +x "$CHECKER" "$INSTALLER"

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/daemon" "$d/.swarmforge/babysitterd" "$d/bin" "$d/announces" "$d/kills" "$d/starts"
  printf '%s' "$d"
}

run_checker() {
  local root=$1
  local now=${2:?run_checker needs epoch}
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

# ── 01: babysitterd heartbeats every tick with no work ────────────────────
ROOT="$(make_root)"
for _ in 1 2 3; do
  bash "$BABYSITTERD_SH" "$ROOT" --tick-once >/dev/null
done
HB_COUNT="$(grep -cE '[[:space:]]heartbeat([[:space:]]|$)' "$ROOT/.swarmforge/babysitterd/babysitterd.log" || true)"
check "daemon-log-freshness-01: three ticks yield three heartbeat lines" '[[ "$HB_COUNT" -eq 3 ]]'
pass "01: babysitterd heartbeats every tick with no work"

# ── 02a: stale handoffd heartbeat → kill + restart via start script + record + announce ─
ROOT="$(make_root)"
NOW=1700000000
# Heartbeat 200s old (>120 threshold)
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
# Fresh babysitterd so only handoffd trips
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
# Disposable child — never the test pid
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true

check "02a: handoffd kill invoked" 'grep -qx "$FAKE_PID" "$ROOT/kills.log"'
check "02a: handoffd restarted via its own start script" \
  'grep -q "start_handoff_daemon.sh" "$ROOT/starts.log"'
check "02a: durable record names handoffd and age" \
  'grep -q "daemon=handoffd" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "age_secs=200" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "action=restart" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "02a: announce after record (FRESHNESS_VIOLATION)" \
  'grep -q "FRESHNESS_VIOLATION restart daemon=handoffd" "$ROOT/announces.log"'
pass "02a: stale handoffd restarts through start_handoff_daemon.sh"

# ── 02b: stale babysitterd ────────────────────────────────────────────────
ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 700))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 700)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/babysitterd/babysitterd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "02b: babysitterd kill invoked" 'grep -qx "$FAKE_PID" "$ROOT/kills.log"'
check "02b: babysitterd restarted via start_babysitterd.sh" \
  'grep -q "start_babysitterd.sh" "$ROOT/starts.log"'
check "02b: durable record names babysitterd" \
  'grep -q "daemon=babysitterd" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "action=restart" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
pass "02b: stale babysitterd restarts through start_babysitterd.sh"

# ── 03: quiet but heartbeating handoffd is never restarted ────────────────
ROOT="$(make_root)"
NOW=1700000000
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
{
  printf '%s heartbeat\n' "$FRESH_TS"
} > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
run_checker "$ROOT" "$NOW"
check "03: no kills" '[[ ! -f "$ROOT/kills.log" ]]'
check "03: no starts" '[[ ! -f "$ROOT/starts.log" ]]'
check "03: no incident record" '[[ ! -s "$ROOT/.swarmforge/daemon/freshness-incidents.log" ]]'
check "03: no announce" '[[ ! -f "$ROOT/announces.log" ]]'
pass "03: quiet heartbeating daemon is never restarted"

# ── 04: failed announce still leaves the durable record ───────────────────
ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
FRESHNESS_ROOT="$ROOT" \
FRESHNESS_CONF="$CONF" \
FRESHNESS_NOW_EPOCH="$NOW" \
FRESHNESS_INCIDENT_FILE="$ROOT/.swarmforge/daemon/freshness-incidents.log" \
FRESHNESS_ANNOUNCE_CMD="exit 1" \
FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> \"$ROOT/kills.log\"" \
FRESHNESS_START_CMD="printf '%s\n' \"\$1\" >> \"$ROOT/starts.log\"" \
  /bin/sh "$CHECKER" || true
kill "$FAKE_PID" 2>/dev/null || true
check "04: restart still happened despite announce failure" \
  'grep -q "start_handoff_daemon.sh" "$ROOT/starts.log"'
check "04: durable record survives failed announce" \
  'grep -q "daemon=handoffd" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "age_secs=200" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
pass "04: failed announce still leaves durable incident record"

# ── 05: all logs fresh → no side effects ──────────────────────────────────
ROOT="$(make_root)"
NOW=1700000000
FRESH_TS="$(date -u -d "@$((NOW - 10))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 10)) +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
run_checker "$ROOT" "$NOW"
check "05: no kills" '[[ ! -f "$ROOT/kills.log" ]]'
check "05: no starts" '[[ ! -f "$ROOT/starts.log" ]]'
check "05: no record" '[[ ! -s "$ROOT/.swarmforge/daemon/freshness-incidents.log" ]]'
check "05: no announce" '[[ ! -f "$ROOT/announces.log" ]]'
pass "05: all fresh → no side effects"

# ── 06: cool-off → escalate announce, no second restart ───────────────────
ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
# Prior restart 60s ago (inside 300s cool-off)
printf 'epoch=%s daemon=handoffd age_secs=200 threshold=120 action=restart\n' "$((NOW - 60))" \
  > "$ROOT/.swarmforge/daemon/freshness-incidents.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "06: no second kill" '[[ ! -f "$ROOT/kills.log" ]]'
check "06: no second start" '[[ ! -f "$ROOT/starts.log" ]]'
check "06: escalate action recorded" \
  'grep -q "action=escalate" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "06: escalation announce invoked" \
  'grep -q "FRESHNESS_VIOLATION escalate daemon=handoffd" "$ROOT/announces.log"'
pass "06: cool-off escalates without hammering restarts"

# ── installer references the checker (required_wiring) ────────────────────
check "install_freshness_cron.sh references freshness_check / daemon_log_freshness_check" \
  'grep -q "daemon_log_freshness_check.sh" "$INSTALLER" && grep -q "freshness_check" "$INSTALLER"'

# Idempotent crontab install against a fake crontab binary
ROOT="$(make_root)"
FAKE_CRON="$ROOT/bin"
mkdir -p "$FAKE_CRON"
CRONTAB_STORE="$ROOT/crontab.txt"
: > "$CRONTAB_STORE"
cat > "$FAKE_CRON/crontab" <<'EOF'
#!/usr/bin/env bash
store="${CRONTAB_STORE:?}"
if [[ "${1:-}" == "-l" ]]; then
  cat "$store" 2>/dev/null || true
  exit 0
fi
cat > "$store"
EOF
chmod +x "$FAKE_CRON/crontab"
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$CRONTAB_STORE" bash "$INSTALLER" "$ROOT" >/dev/null
check "installer writes a crontab line for the checker" \
  'grep -q "daemon_log_freshness_check.sh" "$CRONTAB_STORE"'
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$CRONTAB_STORE" bash "$INSTALLER" "$ROOT" >/dev/null
LINE_COUNT="$(grep -c 'swarmforge-BL-675-freshness-check' "$CRONTAB_STORE" || true)"
check "installer is idempotent (one marker line)" '[[ "$LINE_COUNT" -eq 1 ]]'
pass "installer schedules freshness_check idempotently"

# ── hardening (mutation_cost: low): work≠liveness, missing log, record-before-announce, pid guard ─
ROOT="$(make_root)"
NOW=1700000000
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
# Recent WORK lines only — no heartbeat token. Must still trip (process-liveness lie class).
printf '%s delivered parcel-1\n%s chase-sweep done\n' "$FRESH_TS" "$FRESH_TS" \
  > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "harden: work lines without heartbeat still restart" \
  'grep -q "start_handoff_daemon.sh" "$ROOT/starts.log"'
pass "harden: work≠liveness — only heartbeat freshness counts"

ROOT="$(make_root)"
NOW=1700000000
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
# Missing handoffd log entirely
rm -f "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "harden: missing log is treated as stale" \
  'grep -q "action=restart" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
pass "harden: missing log triggers restart"

ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
# Announce asserts the durable record already exists (order property).
FRESHNESS_ROOT="$ROOT" \
FRESHNESS_CONF="$CONF" \
FRESHNESS_NOW_EPOCH="$NOW" \
FRESHNESS_INCIDENT_FILE="$ROOT/.swarmforge/daemon/freshness-incidents.log" \
FRESHNESS_ANNOUNCE_CMD="test -s \"$ROOT/.swarmforge/daemon/freshness-incidents.log\" && printf order-ok\\\\n >> \"$ROOT/announces.log\"" \
FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> \"$ROOT/kills.log\"" \
FRESHNESS_START_CMD="printf '%s\n' \"\$1\" >> \"$ROOT/starts.log\"" \
  /bin/sh "$CHECKER"
kill "$FAKE_PID" 2>/dev/null || true
check "harden: announce sees durable record already written" \
  'grep -q "order-ok" "$ROOT/announces.log"'
pass "harden: record-before-announce order holds"

ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
echo "1" > "$ROOT/.swarmforge/daemon/handoffd.pid"
# Default kill path (no FRESHNESS_KILL_CMD) must refuse pid 1
FRESHNESS_ROOT="$ROOT" \
FRESHNESS_CONF="$CONF" \
FRESHNESS_NOW_EPOCH="$NOW" \
FRESHNESS_INCIDENT_FILE="$ROOT/.swarmforge/daemon/freshness-incidents.log" \
FRESHNESS_ANNOUNCE_CMD="true" \
FRESHNESS_START_CMD="printf started\\\\n >> \"$ROOT/starts.log\"" \
  /bin/sh "$CHECKER" 2>"$ROOT/stderr.log" || true
check "harden: refuses to kill pid 1" 'grep -q "refusing to kill protected pid=1" "$ROOT/stderr.log"'
pass "harden: protected-pid guard"

# ── wiring: handoffd + babysitterd emit heartbeat ────────────────────────
check "required_wiring: handoffd.bb mentions heartbeat" \
  'grep -q "heartbeat" "$SRC/handoffd.bb"'
check "required_wiring: babysitterd.sh emits a heartbeat line every tick" \
  'grep -q "heartbeat" "$SRC/babysitterd.sh"'
check "required_wiring: handoffd logs heartbeat every cycle (every-cycles=1)" \
  'grep -q "heartbeat-log-every-cycles 1" "$SRC/handoffd.bb"'

if [[ "$fail" -eq 0 ]]; then
  echo "BL-675 daemon-log-freshness: ALL CHECKS PASSED"
else
  echo "BL-675 daemon-log-freshness: FAILURES"
  exit 1
fi
