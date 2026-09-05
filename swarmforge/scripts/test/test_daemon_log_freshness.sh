#!/usr/bin/env bash
# BL-675: unit/property tests for the POSIX daemon log-freshness checker and
# heartbeat emission. All seams injected — no real timers, no live swarm
# paths, no killing this test process.
set -euo pipefail
# A caller shell that already exports SWARMFORGE_SKIP_BABYSITTERD=1 (e.g. a
# mono-router resident pane, which never runs babysitterd standalone) leaks
# it into run_checker and silently short-circuits process_daemon's
# babysitterd branch via the launch-time-policy check, turning 02b's
# kill/restart assertions into a no-op with no failure signal beyond the
# checks that read the never-written kills/starts logs. Scenarios that mean
# to exercise the var set it explicitly per-invocation.
unset SWARMFORGE_SKIP_BABYSITTERD
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKER="$SRC/daemon_log_freshness_check.sh"
INSTALLER="$SRC/install_freshness_cron.sh"
CONF="$SCRIPT_DIR/fixtures/daemon_log_freshness.fixture.conf"
BABYSITTERD_SH="$SRC/babysitterd.sh"
LIB="$SRC/operator_path_lib.sh"
START_SCRIPT="$SRC/start_handoff_daemon.sh"

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

chmod +x "$CHECKER" "$INSTALLER" "$START_SCRIPT"

# Build a fake ~/.nvm tree (versions + optional alias) under a fresh temp
# HOME, so swarmforge_nvm_node_bin_dir has something real to resolve without
# touching this host's own nvm install.
make_fake_nvm_home() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.nvm/versions/node/v9.11.2/bin" "$d/.nvm/versions/node/v22.1.0/bin"
  printf '#!/bin/sh\nexit 0\n' > "$d/.nvm/versions/node/v9.11.2/bin/node"
  printf '#!/bin/sh\nexit 0\n' > "$d/.nvm/versions/node/v22.1.0/bin/node"
  chmod +x "$d/.nvm/versions/node/v9.11.2/bin/node" "$d/.nvm/versions/node/v22.1.0/bin/node"
  printf '%s' "$d"
}

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/daemon" "$d/.swarmforge/babysitterd" "$d/bin" "$d/announces" "$d/kills" "$d/starts"
  printf '%s' "$d"
}

# BL-1012: the contention seams are PINNED here, not left to the host. The
# effective threshold is now load-relative, so an unpinned run would compute
# a different threshold on a busy box than on a quiet one and every assertion
# below about restart-or-not would become a function of host load rather than
# of the code under test. Measured on this host mid-development: load 9.12 on
# 4 cores = factor 2, which alone would have turned 02a's 200s age from a
# restart into a no-op with no failure signal.
#
# Factor 1 reproduces the pre-BL-1012 behaviour EXACTLY, which is what keeps
# every assertion written before this ticket meaningful and unchanged.
# Scenarios that mean to exercise contention override these per-invocation.
FRESHNESS_TEST_LOAD=${FRESHNESS_TEST_LOAD:-1}
FRESHNESS_TEST_CORES=${FRESHNESS_TEST_CORES:-1}

run_checker() {
  local root=$1
  local now=${2:?run_checker needs epoch}
  FRESHNESS_ROOT="$root" \
  FRESHNESS_CONF="$CONF" \
  FRESHNESS_NOW_EPOCH="$now" \
  FRESHNESS_INCIDENT_FILE="$root/.swarmforge/daemon/freshness-incidents.log" \
  FRESHNESS_COOL_OFF_SECS=300 \
  FRESHNESS_LOAD="$FRESHNESS_TEST_LOAD" \
  FRESHNESS_CORES="$FRESHNESS_TEST_CORES" \
  FRESHNESS_ANNOUNCE_CMD="printf '%s\n' \"\$1\" >> \"$root/announces.log\"" \
  FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> \"$root/kills.log\"" \
  FRESHNESS_START_CMD="printf '%s %s\n' \"\$1\" \"\$2\" >> \"$root/starts.log\"" \
  /bin/sh "$CHECKER"
}

# ── 01: babysitterd heartbeats every tick with no work (BL-1133: 2/tick) ─
ROOT="$(make_root)"
for _ in 1 2 3; do
  bash "$BABYSITTERD_SH" "$ROOT" --tick-once >/dev/null
done
HB_COUNT="$(grep -cE '[[:space:]]heartbeat([[:space:]]|$)' "$ROOT/.swarmforge/babysitterd/babysitterd.log" || true)"
check "daemon-log-freshness-01: three ticks yield six heartbeat lines (start+end)" '[[ "$HB_COUNT" -eq 6 ]]'
pass "01: babysitterd heartbeats every tick with no work"

# ── 02a: stale handoffd heartbeat → kill + restart via start script + record + announce ─
ROOT="$(make_root)"
NOW=1700000000
# Heartbeat 200s old (> pinned fixture handoffd|120; not the live ops conf)
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
# BL-1011 moved the swarm name between the action and the daemon, so this
# asserts the new shape in full rather than being relaxed to match both: the
# announce must still name the daemon, and must now also name its swarm.
check "02a: announce after record (FRESHNESS_VIOLATION)" \
  'grep -q "FRESHNESS_VIOLATION restart swarm=primary daemon=handoffd" "$ROOT/announces.log"'
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
FRESHNESS_LOAD="$FRESHNESS_TEST_LOAD" FRESHNESS_CORES="$FRESHNESS_TEST_CORES" \
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
  'grep -q "FRESHNESS_VIOLATION escalate swarm=primary daemon=handoffd" "$ROOT/announces.log"'
# BL-1011: the escalate ANNOUNCE line above is checked verbatim (it must
# include swarm=), but the escalate DURABLE RECORD was only ever checked for
# action=escalate - never for swarm=/reason=, which is a separate string built
# a line earlier in the same branch. Hand-verified this was a real, silent
# gap: dropping swarm=/reason=/render_age from just the record (leaving the
# announce untouched) left every check in this suite green.
check "06: the escalate durable record names its swarm too, not just the announce" \
  'grep -q "action=escalate" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "swarm=primary" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "06: and states the reason instead of a raw sentinel in the record" \
  'grep "action=escalate" "$ROOT/.swarmforge/daemon/freshness-incidents.log" | grep -q "reason=stale-heartbeat"'
pass "06: cool-off escalates without hammering restarts"

# ── BL-789: SWARMFORGE_SKIP_BABYSITTERD honoured by the real checker ──────
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
SWARMFORGE_SKIP_BABYSITTERD=1 run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "BL-789: SKIP_BABYSITTERD=1 skips the restart" '[[ ! -f "$ROOT/starts.log" ]]'
check "BL-789: SKIP_BABYSITTERD=1 issues no kill" '[[ ! -f "$ROOT/kills.log" ]]'
check "BL-789: SKIP_BABYSITTERD=1 leaves no incident record" '[[ ! -s "$ROOT/.swarmforge/daemon/freshness-incidents.log" ]]'
check "BL-789: SKIP_BABYSITTERD=1 issues no announce/warning" '[[ ! -f "$ROOT/announces.log" ]]'
pass "BL-789: a deliberately-skipped babysitterd is never restarted"

ROOT="$(make_root)"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/babysitterd/babysitterd.pid"
SWARMFORGE_SKIP_BABYSITTERD=0 run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "BL-789: SKIP_BABYSITTERD=0 still restarts babysitterd" \
  'grep -q "start_babysitterd.sh" "$ROOT/starts.log"'
pass "BL-789: SKIP_BABYSITTERD=0 leaves the restart path unchanged"

# The skip must be readable from .swarmforge/swarm.env (a normal swarm
# start's own env file), not only an already-exported var — cron starts
# with none of this operator's shell env.
ROOT="$(make_root)"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
printf 'SWARMFORGE_SKIP_BABYSITTERD=1\n' > "$ROOT/.swarmforge/swarm.env"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/babysitterd/babysitterd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "BL-789: SKIP_BABYSITTERD read from .swarmforge/swarm.env skips the restart" \
  '[[ ! -f "$ROOT/starts.log" ]]'
pass "BL-789: swarm.env's own SKIP_BABYSITTERD is honoured with no exported var"

# ── BL-789: the checker resolves its own interpreter, not the caller's PATH ─
ROOT="$(make_root)"
STUB_DIR="$ROOT/stub-interpreter-dir"
mkdir -p "$STUB_DIR"
cat > "$STUB_DIR/bb" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$STUB_DIR/bb"
STALE_TS2="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS2" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
PATH=/usr/bin:/bin \
FRESHNESS_EXTRA_PATH_DIRS="$STUB_DIR" \
FRESHNESS_ROOT="$ROOT" \
FRESHNESS_CONF="$CONF" \
FRESHNESS_NOW_EPOCH="$NOW" \
FRESHNESS_LOAD="$FRESHNESS_TEST_LOAD" FRESHNESS_CORES="$FRESHNESS_TEST_CORES" \
FRESHNESS_INCIDENT_FILE="$ROOT/.swarmforge/daemon/freshness-incidents.log" \
FRESHNESS_ANNOUNCE_CMD="true" \
FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> \"$ROOT/kills.log\"" \
FRESHNESS_START_CMD="command -v bb >> \"$ROOT/resolved-bb.log\" 2>&1 || true" \
  /bin/sh "$CHECKER"
kill "$FAKE_PID" 2>/dev/null || true
check "BL-789: interpreter resolved under a minimal cron PATH via the checker's own PATH" \
  'grep -qF "$STUB_DIR/bb" "$ROOT/resolved-bb.log"'
pass "BL-789: the freshness path resolves bb from a PATH it establishes itself"

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

# ── BL-789: the installed crontab line carries its own PATH ───────────────
ROOT="$(make_root)"
PATH_CRON="$ROOT/bin"
mkdir -p "$PATH_CRON"
PATH_STORE="$ROOT/path-crontab.txt"
: > "$PATH_STORE"
cat > "$PATH_CRON/crontab" <<'EOF'
#!/usr/bin/env bash
store="${CRONTAB_STORE:?}"
if [[ "${1:-}" == "-l" ]]; then
  cat "$store" 2>/dev/null || true
  exit 0
fi
cat > "$store"
EOF
chmod +x "$PATH_CRON/crontab"
# A fake bb sitting in a dir the installer can only see because it's on ITS
# OWN PATH at install time (never baked in blind) - proves "the
# interpreter's directory" in the crontab PATH= is genuinely resolved, not
# a hardcoded guess.
INTERP_DIR="$ROOT/interpreter-dir"
mkdir -p "$INTERP_DIR"
cat > "$INTERP_DIR/bb" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$INTERP_DIR/bb"
PATH="$PATH_CRON:$INTERP_DIR:$PATH" CRONTAB_STORE="$PATH_STORE" bash "$INSTALLER" "$ROOT" >/dev/null
check "BL-789: crontab line sets a PATH=" 'grep -qE "PATH=[^ ]*" "$PATH_STORE"'
check "BL-789: crontab PATH contains the resolved interpreter's directory" \
  "grep -qF \"$INTERP_DIR\" \"\$PATH_STORE\""
check "BL-789: crontab line still names the project root" \
  "grep -qF \"FRESHNESS_ROOT=$ROOT \" \"\$PATH_STORE\""
pass "BL-789: the installed crontab line carries its own PATH, including the interpreter's directory"

# ── BL-783: two roots on one host must not clobber each other's line ──────
ROOT_A="$(make_root)"
ROOT_B="$(make_root)"
MULTI_CRON="$ROOT_A/bin"
mkdir -p "$MULTI_CRON"
MULTI_STORE="$ROOT_A/multi-crontab.txt"
: > "$MULTI_STORE"
cat > "$MULTI_CRON/crontab" <<'EOF'
#!/usr/bin/env bash
store="${CRONTAB_STORE:?}"
if [[ "${1:-}" == "-l" ]]; then
  cat "$store" 2>/dev/null || true
  exit 0
fi
cat > "$store"
EOF
chmod +x "$MULTI_CRON/crontab"
PATH="$MULTI_CRON:$PATH" CRONTAB_STORE="$MULTI_STORE" bash "$INSTALLER" "$ROOT_A" >/dev/null
PATH="$MULTI_CRON:$PATH" CRONTAB_STORE="$MULTI_STORE" bash "$INSTALLER" "$ROOT_B" >/dev/null
check "BL-783: root A's line survives installing root B" \
  "grep -qF \"FRESHNESS_ROOT=$ROOT_A \" \"\$MULTI_STORE\""
check "BL-783: root B's line is present too" \
  "grep -qF \"FRESHNESS_ROOT=$ROOT_B \" \"\$MULTI_STORE\""
check "BL-783: exactly two freshness lines total (no cross-root clobber)" \
  '[[ "$(grep -c "swarmforge-BL-675-freshness-check" "$MULTI_STORE" || true)" -eq 2 ]]'
# Re-installing root A must replace only root A's own line, not root B's.
PATH="$MULTI_CRON:$PATH" CRONTAB_STORE="$MULTI_STORE" bash "$INSTALLER" "$ROOT_A" >/dev/null
check "BL-783: re-installing root A leaves root B's line intact" \
  "grep -qF \"FRESHNESS_ROOT=$ROOT_B \" \"\$MULTI_STORE\""
check "BL-783: re-installing root A still yields exactly two lines total" \
  '[[ "$(grep -c "swarmforge-BL-675-freshness-check" "$MULTI_STORE" || true)" -eq 2 ]]'
pass "BL-783: multi-root crontab install does not clobber a sibling root's line"

# ── BL-783: no crontab command → loud, non-zero, names what won't be watched ─
ROOT="$(make_root)"
BASH_BIN="$(command -v bash)"
NO_CRONTAB_BIN="$ROOT/no-crontab-bin"
mkdir -p "$NO_CRONTAB_BIN"
for tool in dirname chmod; do
  ln -sf "$(command -v "$tool")" "$NO_CRONTAB_BIN/$tool"
done
set +e
NO_CRONTAB_OUT="$(PATH="$NO_CRONTAB_BIN" "$BASH_BIN" "$INSTALLER" "$ROOT" 2>&1)"
NO_CRONTAB_RC=$?
set -e
check "BL-783: missing crontab command exits non-zero" '[[ "$NO_CRONTAB_RC" -ne 0 ]]'
check "BL-783: missing crontab command names the root that will not be watched" \
  "printf '%s' \"\$NO_CRONTAB_OUT\" | grep -qF \"$ROOT\""
check "BL-783: missing crontab command says the watchdog will NOT run" \
  'printf "%s" "$NO_CRONTAB_OUT" | grep -q "will NOT run"'
pass "BL-783: absent crontab command fails loud and names what is unwatched"

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
FRESHNESS_LOAD="$FRESHNESS_TEST_LOAD" FRESHNESS_CORES="$FRESHNESS_TEST_CORES" \
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
FRESHNESS_LOAD="$FRESHNESS_TEST_LOAD" FRESHNESS_CORES="$FRESHNESS_TEST_CORES" \
FRESHNESS_INCIDENT_FILE="$ROOT/.swarmforge/daemon/freshness-incidents.log" \
FRESHNESS_ANNOUNCE_CMD="true" \
FRESHNESS_START_CMD="printf started\\\\n >> \"$ROOT/starts.log\"" \
  /bin/sh "$CHECKER" 2>"$ROOT/stderr.log" || true
check "harden: refuses to kill pid 1" 'grep -q "refusing to kill protected pid=1" "$ROOT/stderr.log"'
pass "harden: protected-pid guard"

# ── BL-796: nvm-node-path-follow-up-adopt ──────────────────────────────────
# operator_path_lib.sh is adopted (tracked) with two corrections: version-
# order (not lexicographic) newest-version fallback, and ONE nvm resolver
# shared by the runtime prepend and the install-time crontab bake.

# ── BL-796 scenario 01: a freshness restart hands the daemon a PATH that
#    resolves node (nvm-only, PATH=/usr/bin:/bin) ─────────────────────────
ROOT="$(make_root)"
FAKE_HOME="$(make_fake_nvm_home)"
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
RESOLVED_NODE_LOG="$ROOT/resolved-node.log"
PATH=/usr/bin:/bin \
HOME="$FAKE_HOME" \
FRESHNESS_ROOT="$ROOT" \
FRESHNESS_CONF="$CONF" \
FRESHNESS_NOW_EPOCH="$NOW" \
FRESHNESS_LOAD="$FRESHNESS_TEST_LOAD" FRESHNESS_CORES="$FRESHNESS_TEST_CORES" \
FRESHNESS_INCIDENT_FILE="$ROOT/.swarmforge/daemon/freshness-incidents.log" \
FRESHNESS_ANNOUNCE_CMD="true" \
FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> \"$ROOT/kills.log\"" \
FRESHNESS_START_CMD="command -v node >> \"$RESOLVED_NODE_LOG\" 2>&1 || true" \
  /bin/sh "$CHECKER"
kill "$FAKE_PID" 2>/dev/null || true
check "BL-796-01: freshness restart resolves node from the nvm-only fake HOME" \
  'grep -qF "$FAKE_HOME/.nvm/versions/node" "$RESOLVED_NODE_LOG"'
pass "BL-796-01: a freshness restart hands the daemon a PATH that resolves node"

# ── BL-796 scenario 02: the daemon start script pins node before launching
#    the daemon (PATH resolves bb but not real node) ──────────────────────
ROOT="$(make_root)"
FAKE_HOME="$(make_fake_nvm_home)"
FAKE_BB_DIR="$ROOT/fake-bb"
mkdir -p "$FAKE_BB_DIR"
cat > "$FAKE_BB_DIR/bb" <<'FAKEBB'
#!/bin/sh
script="$1"
root="$2"
daemon_dir="$root/.swarmforge/daemon"
case "$script" in
  *supervisor*)
    echo $$ > "$daemon_dir/handoffd-supervisor.pid"
    ;;
  *)
    command -v node > "$root/resolved-node-start.log" 2>&1 || true
    echo $$ > "$daemon_dir/handoffd.pid"
    ;;
esac
sleep 3
FAKEBB
chmod +x "$FAKE_BB_DIR/bb"
PATH="$FAKE_BB_DIR:/usr/bin:/bin" \
HOME="$FAKE_HOME" \
HANDOFFD_BB="$ROOT/fake-handoffd.bb" \
HANDOFFD_SUPERVISOR_BB="$ROOT/fake-handoffd-supervisor.bb" \
  bash "$START_SCRIPT" "$ROOT" > "$ROOT/start-out.log" 2>&1
check "BL-796-02: start_handoff_daemon.sh claims the handoffd pid file" \
  '[[ -f "$ROOT/.swarmforge/daemon/handoffd.pid" ]]'
check "BL-796-02: the launched daemon resolves node from the nvm-only fake HOME" \
  'grep -qF "$FAKE_HOME/.nvm/versions/node" "$ROOT/resolved-node-start.log"'
pass "BL-796-02: the daemon start script pins node before launching the daemon"
[[ -f "$ROOT/.swarmforge/daemon/handoffd.pid" ]] && kill "$(cat "$ROOT/.swarmforge/daemon/handoffd.pid")" 2>/dev/null || true
[[ -f "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid" ]] && kill "$(cat "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid")" 2>/dev/null || true

# ── BL-796 scenario 03: the installed crontab line bakes a node directory
#    when node is nvm-only ─────────────────────────────────────────────────
ROOT="$(make_root)"
FAKE_HOME="$(make_fake_nvm_home)"
NVM_CRON="$ROOT/bin"
mkdir -p "$NVM_CRON"
NVM_STORE="$ROOT/nvm-crontab.txt"
: > "$NVM_STORE"
cat > "$NVM_CRON/crontab" <<'EOF'
#!/usr/bin/env bash
store="${CRONTAB_STORE:?}"
if [[ "${1:-}" == "-l" ]]; then
  cat "$store" 2>/dev/null || true
  exit 0
fi
cat > "$store"
EOF
chmod +x "$NVM_CRON/crontab"
PATH="$NVM_CRON:/usr/bin:/bin" HOME="$FAKE_HOME" CRONTAB_STORE="$NVM_STORE" bash "$INSTALLER" "$ROOT" >/dev/null
check "BL-796-03: crontab PATH bakes the resolved nvm node bin directory" \
  "grep -qF \"$FAKE_HOME/.nvm/versions/node\" \"\$NVM_STORE\""
pass "BL-796-03: the installed crontab line bakes a node directory when node is nvm-only"

# ── BL-796 scenario 04: the nvm default alias wins over a newer installed
#    version ─────────────────────────────────────────────────────────────
FAKE_HOME="$(make_fake_nvm_home)"
mkdir -p "$FAKE_HOME/.nvm/alias"
printf 'v9.11.2\n' > "$FAKE_HOME/.nvm/alias/default"
ALIAS_RESULT="$(HOME="$FAKE_HOME" sh -c ". \"$LIB\"; swarmforge_nvm_node_bin_dir")"
check "BL-796-04: the alias-pinned version (v9.11.2) wins over the newer v22.1.0" \
  '[[ "$ALIAS_RESULT" == "$FAKE_HOME/.nvm/versions/node/v9.11.2/bin" ]]'
pass "BL-796-04: the nvm default alias wins over a newer installed version"

# ── BL-796 scenario 05: without an alias the newest version wins BY VERSION
#    ORDER, not lexicographically (v22.1.0 over v9.11.2) ──────────────────
FAKE_HOME="$(make_fake_nvm_home)"
NO_ALIAS_RESULT="$(HOME="$FAKE_HOME" sh -c ". \"$LIB\"; swarmforge_nvm_node_bin_dir")"
check "BL-796-05: no alias picks the newest version BY VERSION ORDER (v22.1.0, not the lexicographically-last v9.11.2)" \
  '[[ "$NO_ALIAS_RESULT" == "$FAKE_HOME/.nvm/versions/node/v22.1.0/bin" ]]'
pass "BL-796-05: without an alias the newest version wins by version order"

# ── BL-796 scenario 06: a node already on the caller's PATH is never
#    shadowed by the nvm fallback ──────────────────────────────────────────
FAKE_HOME="$(make_fake_nvm_home)"
REAL_NODE_DIR="$(mktemp -d)"
register_tmp_dir "$REAL_NODE_DIR"
printf '#!/bin/sh\nexit 0\n' > "$REAL_NODE_DIR/node"
chmod +x "$REAL_NODE_DIR/node"
SHADOW_RESULT="$(HOME="$FAKE_HOME" PATH="$REAL_NODE_DIR:/usr/bin:/bin" sh -c ". \"$LIB\"; swarmforge_prepend_operator_bins; command -v node")"
check "BL-796-06: the caller's own node wins, the nvm fallback is never consulted" \
  '[[ "$SHADOW_RESULT" == "$REAL_NODE_DIR/node" ]]'
pass "BL-796-06: a node already on the caller PATH is never shadowed by the nvm fallback"

# ── BL-796 invariant 2: sourcing the lib changes nothing but PATH ─────────
# Both snapshots taken inside the SAME `sh -c` process, so the diff reflects
# only what sourcing the lib changed - comparing against the outer bash's
# own `env` would also pick up bash-vs-sh environment noise (SHLVL, etc.)
# that has nothing to do with the lib.
INV2_TMP="$(mktemp -d)"
register_tmp_dir "$INV2_TMP"
sh -c '
env | sort | grep -v "^PATH=" > "'"$INV2_TMP"'/before.env"
pwd > "'"$INV2_TMP"'/before.pwd"
. "'"$LIB"'"
swarmforge_prepend_operator_bins
env | sort | grep -v "^PATH=" > "'"$INV2_TMP"'/after.env"
pwd > "'"$INV2_TMP"'/after.pwd"
'
check "BL-796: sourcing the lib and prepending mutates no env var but PATH" \
  'diff -q "$INV2_TMP/before.env" "$INV2_TMP/after.env" >/dev/null'
check "BL-796: sourcing the lib and prepending leaves the working directory unchanged" \
  'diff -q "$INV2_TMP/before.pwd" "$INV2_TMP/after.pwd" >/dev/null'
pass "BL-796: sourcing the PATH lib changes nothing but PATH"

# ── BL-796 wiring: each caller literally invokes the shared resolver ──────
check "required_wiring: start_handoff_daemon.sh sources operator_path_lib.sh" \
  'grep -q "operator_path_lib.sh" "$START_SCRIPT"'
check "required_wiring: daemon_log_freshness_check.sh calls swarmforge_prepend_operator_bins" \
  'grep -q "swarmforge_prepend_operator_bins" "$CHECKER"'
check "required_wiring: install_freshness_cron.sh calls swarmforge_nvm_node_bin_dir" \
  'grep -q "swarmforge_nvm_node_bin_dir" "$INSTALLER"'
pass "BL-796: each of the three callers wires through the shared PATH lib"

# ── wiring: handoffd + babysitterd emit heartbeat ────────────────────────
check "required_wiring: handoffd.bb mentions heartbeat" \
  'grep -q "heartbeat" "$SRC/handoffd.bb"'
check "required_wiring: babysitterd.sh emits a heartbeat line every tick" \
  'grep -q "heartbeat" "$SRC/babysitterd.sh"'
check "required_wiring: handoffd logs heartbeat every cycle (every-cycles=1)" \
  'grep -q "heartbeat-log-every-cycles 1" "$SRC/handoffd.bb"'

# ── BL-789: heartbeat emitted at cycle START, not only at cycle end ───────
# A slow Mac cycle (140-232s observed) must never be indistinguishable from
# a wedged one: the heartbeat write must land BEFORE poll-once!/the sweeps
# run, in addition to the existing end-of-cycle write. Positional (not just
# "heartbeat is mentioned somewhere") - a regression that keeps a single
# end-of-cycle-only write would still pass a mere grep for the token.
LOOP_LINE="$(grep -n '(loop \[cycle 0\]' "$SRC/handoffd.bb" | head -n1 | cut -d: -f1)"
HB_FIRST_LINE="$(tail -n "+$LOOP_LINE" "$SRC/handoffd.bb" | grep -n '(spit (str heartbeat-file)' | head -n1 | cut -d: -f1)"
POLL_ONCE_LINE="$(tail -n "+$LOOP_LINE" "$SRC/handoffd.bb" | grep -n '(poll-once!)' | head -n1 | cut -d: -f1)"
check "BL-789: within the main cycle loop, a heartbeat write appears before poll-once!" \
  '[[ -n "$LOOP_LINE" && -n "$HB_FIRST_LINE" && -n "$POLL_ONCE_LINE" && "$HB_FIRST_LINE" -lt "$POLL_ONCE_LINE" ]]'
HB_WRITE_COUNT="$(grep -c '(spit (str heartbeat-file)' "$SRC/handoffd.bb" || true)"
check "BL-789: heartbeat is written twice per cycle (start AND end), not just once" \
  '[[ "$HB_WRITE_COUNT" -ge 2 ]]'

# ── fleet telegram.json fills cron announce when *.env has no TELEGRAM_* ─
unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID || true
ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
printf "swarm_name\tfleet-test-swarm\n" > "$ROOT/.swarmforge/swarm-identity"
FLEET_HOME="$(mktemp -d)"
register_tmp_dir "$FLEET_HOME"
mkdir -p "$FLEET_HOME/.swarmforge/fleet/fleet-test-swarm"
printf '{"botToken":"test-token-not-a-secret","chatId":"4242","bridgePort":8765}\n' \
  > "$FLEET_HOME/.swarmforge/fleet/fleet-test-swarm/telegram.json"
mkdir -p "$ROOT/bin"
CURL_LOG="$ROOT/curl-args.log"
cat > "$ROOT/bin/curl" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$CURL_LOG"
exit 0
EOF
chmod +x "$ROOT/bin/curl"
ERRF="$ROOT/checker.err"
PATH="$ROOT/bin:$PATH" \
HOME="$FLEET_HOME" SWARMFORGE_FLEET_HOME="$FLEET_HOME" \
FRESHNESS_ROOT="$ROOT" FRESHNESS_CONF="$CONF" FRESHNESS_NOW_EPOCH="$NOW" \
FRESHNESS_LOAD="$FRESHNESS_TEST_LOAD" FRESHNESS_CORES="$FRESHNESS_TEST_CORES" \
FRESHNESS_INCIDENT_FILE="$ROOT/.swarmforge/daemon/freshness-incidents.log" \
FRESHNESS_COOL_OFF_SECS=300 \
FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> \"$ROOT/kills.log\"" \
FRESHNESS_START_CMD="printf '%s %s\n' \"\$1\" \"\$2\" >> \"$ROOT/starts.log\"" \
/bin/sh "$CHECKER" 2>"$ERRF" || true
check "fleet-telegram: default announce invoked curl (creds came from fleet json)" \
  'grep -q "sendMessage" "$CURL_LOG"'
check "fleet-telegram: announce was not skipped" \
  '! grep -q "announce skipped" "$ERRF"'
pass "fleet telegram.json is used for freshness announces when TELEGRAM_* is unset"

# Negative: empty fleet home, no env files → still skip (no curl against the real API).
ROOT="$(make_root)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
EMPTY_HOME="$(mktemp -d)"
register_tmp_dir "$EMPTY_HOME"
ERRF="$ROOT/checker.err"
PATH="$ROOT/bin:$PATH" \
HOME="$EMPTY_HOME" SWARMFORGE_FLEET_HOME="$EMPTY_HOME" \
FRESHNESS_ROOT="$ROOT" FRESHNESS_CONF="$CONF" FRESHNESS_NOW_EPOCH="$NOW" \
FRESHNESS_LOAD="$FRESHNESS_TEST_LOAD" FRESHNESS_CORES="$FRESHNESS_TEST_CORES" \
FRESHNESS_INCIDENT_FILE="$ROOT/.swarmforge/daemon/freshness-incidents.log" \
FRESHNESS_COOL_OFF_SECS=300 \
FRESHNESS_KILL_CMD="true" FRESHNESS_START_CMD="true" \
/bin/sh "$CHECKER" 2>"$ERRF" || true
check "fleet-telegram-empty: announce skipped when neither env files nor fleet json exist" \
  'grep -Fq "announce skipped (TELEGRAM_* unset)" "$ERRF"'
pass "missing fleet json still skips announce (never hits the real API)"

# ── BL-1012: contention-relative threshold, bounded, with a post-restart grace ─
# The watchdog restart-stormed a merely-slow handoffd: a fixed 120s against
# load 80 on four cores, ages of 132-350s recorded as violations, 694 rotated
# logs in a day - and each restart rotates away the log the next check reads.

# ts_at <epoch> — an ISO heartbeat stamp, portable across GNU/BSD date.
ts_at() {
  date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ
}

# One handoffd run at a chosen contention, with babysitterd kept fresh so only
# handoffd can trip. age_secs<0 means "no log at all" (the rotated-away case).
run_at_contention() {
  local age=$1 load=$2 cores=$3
  ROOT="$(make_root)"
  NOW=1700000000
  if [[ "$age" -ge 0 ]]; then
    printf '%s heartbeat\n' "$(ts_at $((NOW - age)))" > "$ROOT/.swarmforge/daemon/handoffd.log"
  fi
  printf '%s heartbeat\n' "$(ts_at "$NOW")" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
  FRESHNESS_TEST_LOAD="$load" FRESHNESS_TEST_CORES="$cores" run_checker "$ROOT" "$NOW"
}

# qa step 1 - factor 1 preserves today's behaviour EXACTLY. This is the check
# that keeps the operator's "do not make these green by raising the budget"
# constraint honest: on a quiet box nothing was relaxed.
run_at_contention 300 1 1
check "BL-1012: at factor 1 a 300s age still restarts (120s threshold unchanged on a quiet host)" \
  'grep -q "action=restart" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "BL-1012: the factor-1 record names an effective threshold equal to the base" \
  'grep -q "effective_threshold=120 contention_factor=1" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'

# qa step 2 - the same fixture on a 4x-contended host is late, not hung.
run_at_contention 300 4 1
check "BL-1012: at factor 4 the same 300s age does NOT restart (effective 480)" \
  '[[ ! -s "$ROOT/starts.log" ]] || ! grep -q "start_handoff_daemon.sh" "$ROOT/starts.log"'
check "BL-1012: at factor 4 nothing is announced for handoffd" \
  '[[ ! -f "$ROOT/announces.log" ]] || ! grep -q "daemon=handoffd" "$ROOT/announces.log"'

# qa step 3 - invariant 1: the ceiling still catches a genuinely dead daemon
# on the busiest host. 120 x 20 would be 2400s; the cap holds it at 600.
run_at_contention 900 20 1
check "BL-1012 invariant 1: at factor 20 a 900s age still restarts - the ceiling bounds the window" \
  'grep -q "action=restart" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "BL-1012 invariant 1: the effective threshold is capped at 600, never base x factor" \
  'grep -q "effective_threshold=600 contention_factor=20" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'

# A 599s age at factor 20 is UNDER the ceiling and must be left alone - the
# cap is a ceiling on the window, not a floor on the age.
run_at_contention 599 20 1
check "BL-1012: at factor 20 an age just under the ceiling does not restart" \
  '[[ ! -s "$ROOT/starts.log" ]] || ! grep -q "start_handoff_daemon.sh" "$ROOT/starts.log"'

# An unreadable contention signal falls back to factor 1 - never to a longer
# window. A signal we cannot read must not buy leniency.
#
# "unreadable" is injected as a NON-NUMERIC value, not as an empty string:
# empty means "seam not set" and correctly falls through to reading the real
# host, which would make this check a function of this machine's load rather
# than of the code. That is not hypothetical - it flipped this very check
# between runs during development.
run_at_contention 300 "unreadable" "unreadable"
check "BL-1012: an unreadable contention signal falls back to factor 1, not to a longer window" \
  'grep -q "contention_factor=1" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "action=restart" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'

# qa step 4 - invariant 2: within the grace window an absent log is OUR OWN
# restart's footprint, not evidence of a hung daemon.
grace_run() {
  local since=$1
  ROOT="$(make_root)"
  NOW=1700000000
  printf '%s heartbeat\n' "$(ts_at "$NOW")" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
  # No handoffd.log at all - exactly what start_handoff_daemon.sh's rotation leaves.
  printf 'epoch=%s daemon=handoffd age_secs=999999999 threshold=120 action=restart\n' \
    "$((NOW - since))" > "$ROOT/.swarmforge/daemon/freshness-incidents.log"
  FRESHNESS_TEST_LOAD=1 FRESHNESS_TEST_CORES=1 run_checker "$ROOT" "$NOW"
}

grace_run 10
check "BL-1012 invariant 2: an absent log 10s after our own restart is not a violation" \
  '[[ ! -f "$ROOT/announces.log" ]] || ! grep -q "daemon=handoffd" "$ROOT/announces.log"'
check "BL-1012 invariant 2: and no second restart is issued from the evidence we destroyed" \
  '[[ ! -s "$ROOT/starts.log" ]] || ! grep -q "start_handoff_daemon.sh" "$ROOT/starts.log"'
check "BL-1012 invariant 2: the suppression is still recorded, never silent" \
  'grep -q "action=grace" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
# BL-1011: the grace record is written by append_incident with no announce at
# all (grace never calls do_announce), so it was the one action path this
# ticket's own BL-1011 test cases never drove - every other case above goes
# through do_announce, which is what all the reason=/swarm=/no-raw-sentinel
# checks above actually inspect. Hand-verified this was a real, silent gap:
# reverting the grace record's swarm=/reason=/render_age to the pre-BL-1011
# raw "age_secs=${age}" shape left every check in this suite green.
check "BL-1011: the grace record names its swarm too, not just the restart/escalate records" \
  'grep -q "action=grace" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "swarm=primary" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "BL-1011: and states the reason instead of a raw sentinel - the log is absent here, by construction" \
  'grep -q "action=grace" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "reason=log-absent" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "BL-1011: the grace record itself contains no raw 999999999, even though its own condition IS the sentinel" \
  '! (grep "action=grace" "$ROOT/.swarmforge/daemon/freshness-incidents.log" | grep -q "999999999")'

# qa step 5 - past the grace window the same absent log IS a violation again.
grace_run 600
check "BL-1012: an absent log 600s after the last restart announces again" \
  'grep -q "daemon=handoffd" "$ROOT/announces.log"'

# The grace window is scoped to the file-absent SENTINEL only. A daemon that
# came back up and then went stale inside the window is a REAL violation and
# must still fire - otherwise the grace becomes a blanket mute.
ROOT="$(make_root)"
NOW=1700000000
printf '%s heartbeat\n' "$(ts_at $((NOW - 300)))" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$(ts_at "$NOW")" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
printf 'epoch=%s daemon=handoffd age_secs=999999999 threshold=120 action=restart\n' \
  "$((NOW - 10))" > "$ROOT/.swarmforge/daemon/freshness-incidents.log"
FRESHNESS_TEST_LOAD=1 FRESHNESS_TEST_CORES=1 run_checker "$ROOT" "$NOW"
check "BL-1012: a REAL stale age inside the grace window is still a violation (grace is not a blanket mute)" \
  'grep -q "daemon=handoffd" "$ROOT/announces.log"'

# qa step 6 - invariant 3: attributable. Both numbers on every record.
run_at_contention 600 4 1
check "BL-1012 invariant 3: the record names both the effective threshold and the contention factor that produced it" \
  'grep -q "effective_threshold=480" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "contention_factor=4" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "BL-1012 invariant 3: the base threshold is still recorded too, so existing readers keep working" \
  'grep -q "threshold=120 " "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
pass "BL-1012: contention-relative threshold, bounded, with a post-restart grace"

# ── BL-1011: an alarm names its swarm and why it fired ────────────────────
# 999999999 was returned for THREE different conditions and interpolated into
# the announced text as though it were an age, so the operator got a number
# where a reason belongs. And the swarm name was resolved only inside the
# branch that FILLS IN missing Telegram credentials, so a checkout whose
# credentials were already exported never computed it - which is why five
# alarms on 2026-08-21 could not be attributed to a host at all.

write_identity() {
  local root=$1 name=$2
  printf 'swarm_name\t%s\nswarm_mode\tautonomous\n' "$name" > "$root/.swarmforge/swarm-identity"
}

# Each row: log state -> the reason that must be reported. The age is a
# sentinel in all three, so none may render a number.
for case_spec in "absent::log-absent" "noheartbeat::no-heartbeat-line" "badtime::unparseable-timestamp"; do
  CASE="${case_spec%%::*}"
  WANT_REASON="${case_spec##*::}"
  ROOT="$(make_root)"
  write_identity "$ROOT" "second"
  case "$CASE" in
    absent)      : ;;  # no handoffd.log at all
    noheartbeat) printf '2026-08-21T10:00:00Z some other line\n' > "$ROOT/.swarmforge/daemon/handoffd.log" ;;
    badtime)     printf 'not-a-timestamp heartbeat\n' > "$ROOT/.swarmforge/daemon/handoffd.log" ;;
  esac
  run_checker "$ROOT" 1800000000 >/dev/null 2>&1 || true
  ANN="$ROOT/announces.log"
  INC="$ROOT/.swarmforge/daemon/freshness-incidents.log"
  check "BL-1011 ($CASE): the announced text states reason=$WANT_REASON" \
    'grep -q "reason='"$WANT_REASON"'" "$ANN"'
  check "BL-1011 ($CASE): the announced text contains no raw sentinel" \
    '! grep -q "999999999" "$ANN"'
  check "BL-1011 ($CASE): the durable incident record carries the same reason" \
    'grep -q "reason='"$WANT_REASON"'" "$INC"'
  check "BL-1011 ($CASE): the incident record contains no raw sentinel either" \
    '! grep -q "999999999" "$INC"'
  check "BL-1011 ($CASE): the announced text names the swarm it came from" \
    'grep -q "swarm=second" "$ANN"'
  check "BL-1011 ($CASE): so does the durable incident record" \
    'grep -q "swarm=second" "$INC"'
done
pass "BL-1011: each sentinel condition reports its own named reason, never a number"

# A REAL age must still be reported as a number - the sentinel fix must not
# swallow the measurement that works.
ROOT="$(make_root)"
write_identity "$ROOT" "primary"
printf '2026-08-21T10:00:00Z handoffd heartbeat\n' > "$ROOT/.swarmforge/daemon/handoffd.log"
STALE_NOW=$(( $(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' '2026-08-21T10:00:00Z' +%s 2>/dev/null || date -u -d '2026-08-21T10:00:00Z' +%s) + 300 ))
run_checker "$ROOT" "$STALE_NOW" >/dev/null 2>&1 || true
check "BL-1011: a stale but readable heartbeat reports its REAL age, not a sentinel" \
  'grep -q "age_secs=300" "$ROOT/announces.log"'
check "BL-1011: and names the stale-heartbeat condition" \
  'grep -q "reason=stale-heartbeat" "$ROOT/announces.log"'
pass "BL-1011: a measurable age is still reported as a number"

# Every swarm name reaches the text, not just a hardcoded one.
for SW in primary second; do
  ROOT="$(make_root)"
  write_identity "$ROOT" "$SW"
  run_checker "$ROOT" 1800000000 >/dev/null 2>&1 || true
  check "BL-1011: an alarm from swarm $SW names swarm $SW" \
    'grep -q "swarm='"$SW"'" "$ROOT/announces.log"'
done
pass "BL-1011: the announced swarm follows the checkout's identity"

# THE REGRESSION THAT MATTERS. With credentials already exported the checker
# skipped the whole branch that resolved the swarm name, so the alarm went out
# anonymous. This is the live 2026-08-21 path.
ROOT="$(make_root)"
write_identity "$ROOT" "second"
TELEGRAM_BOT_TOKEN=already-set TELEGRAM_CHAT_ID=12345 \
  run_checker "$ROOT" 1800000000 >/dev/null 2>&1 || true
check "BL-1011: the swarm is named even when TELEGRAM credentials are already in the environment" \
  'grep -q "swarm=second" "$ROOT/announces.log"'
check "BL-1011: and the incident record is attributable on that same path" \
  'grep -q "swarm=second" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
pass "BL-1011: swarm resolution no longer hides inside the credential-fallback branch"

# A checkout with no identity file at all must still be attributable rather
# than anonymous - it falls back to the same default the rest of the system uses.
ROOT="$(make_root)"
run_checker "$ROOT" 1800000000 >/dev/null 2>&1 || true
check "BL-1011: a checkout with no identity file still names a swarm rather than none" \
  'grep -q "swarm=primary" "$ROOT/announces.log"'
pass "BL-1011: attribution never degrades to silence"

# BL-1011: SWARMFORGE_SWARM_NAME is the FIRST source resolve_swarm_name checks
# - ahead of the identity file - and this whole resolver now runs
# unconditionally (it used to run only inside the credential-fallback branch,
# which is this ticket's own fix). No case above ever sets this var, so
# dropping it entirely from the resolver was a silent gap: hand-verified by
# clearing it to always-empty, which left every other BL-1011 check green.
ROOT="$(make_root)"
write_identity "$ROOT" "second"
SWARMFORGE_SWARM_NAME=env-override \
  run_checker "$ROOT" 1800000000 >/dev/null 2>&1 || true
check "BL-1011: SWARMFORGE_SWARM_NAME overrides the identity file, not just supplements it" \
  'grep -q "swarm=env-override" "$ROOT/announces.log"'
pass "BL-1011: the env-var swarm-name source is still consulted first"

# ── BL-1110: in-flight sweep-marker suppresses stale-log restart ───────────
ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
# Marker started 50s ago — well under 225s budget; log heartbeat is 200s old.
started_ms=$((NOW * 1000 - 50000))
printf '{"sweep":"chase-sweep","started_at_ms":%s}\n' "$started_ms" \
  > "$ROOT/.swarmforge/daemon/handoffd.sweep-marker"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "BL-1110: in-sweep progress does not kill handoffd" \
  '! test -f "$ROOT/kills.log" || ! grep -q . "$ROOT/kills.log"'
check "BL-1110: suppress-in-sweep is recorded" \
  'grep -q "action=suppress-in-sweep" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "BL-1110: conf still pins handoffd at 120" \
  'grep -q "^handoffd|120|" "$CONF"'
pass "BL-1110: progressing sweep-marker suppresses log-stale restart"

# Over-budget marker must still restart (genuine wedge).
ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
started_ms=$((NOW * 1000 - 300000)) # 300s > 225s budget
printf '{"sweep":"chase-sweep","started_at_ms":%s}\n' "$started_ms" \
  > "$ROOT/.swarmforge/daemon/handoffd.sweep-marker"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "BL-1110: over-budget in-flight still restarts" \
  'grep -q "action=restart" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
pass "BL-1110: over-budget marker does not forge liveness"

# Cool-off after claim-style restart: second stale within cool-off escalates, no second kill.
ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$STALE_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
printf 'epoch=%s swarm=primary daemon=handoffd action=restart\n' "$((NOW - 60))" \
  > "$ROOT/.swarmforge/daemon/freshness-incidents.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "BL-1110: cool-off escalates instead of unbounded restart flap" \
  'grep -q "action=escalate" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && { ! test -f "$ROOT/kills.log" || ! grep -q . "$ROOT/kills.log"; }'
pass "BL-1110: pid-claim/cool-off path does not unbounded-flap"

# ── BL-784: registry guard ───────────────────────────────────────────────────
GUARD="$SRC/daemon_log_freshness_registry_guard.sh"
REQUIRED="$SRC/daemon_log_freshness_required.conf"

check "BL-784: registry guard passes on shipped fixture conf" \
  'FRESHNESS_CONF="$CONF" FRESHNESS_REQUIRED="$REQUIRED" /bin/sh "$GUARD"'

TMP_REQ=$(mktemp)
printf '%s\n' handoffd babysitterd fixture_unregistered_daemon > "$TMP_REQ"
GUARD_FAIL_OUT=$(FRESHNESS_CONF="$CONF" FRESHNESS_REQUIRED="$TMP_REQ" /bin/sh "$GUARD" 2>&1 || true)
rm -f "$TMP_REQ"
check "BL-784: guard fails when required daemon lacks conf row" \
  'grep -q "fixture_unregistered_daemon" <<< "$GUARD_FAIL_OUT"'

# ── BL-784: quiet supervisor tick heartbeats, healthy process not restarted ─
ROOT="$(make_root)"
NOW=1700000000
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/daemon/handoffd-supervisor.log"
sleep 120 &
FAKE_SUP_PID=$!
echo "$FAKE_SUP_PID" > "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_SUP_PID" 2>/dev/null || true
check "BL-784: fresh handoffd_supervisor heartbeat is not restarted" '[[ ! -f "$ROOT/kills.log" ]]'
pass "BL-784: healthy quiet supervisor is not restarted by freshness checker"

# ── BL-1413: the freshness check reads past a NUL byte ──────────────────────
BL1413_PROBE="$SCRIPT_DIR/lib/bl1413_heartbeat_age_probe.sh"
BL1413_FIXTURES="$SCRIPT_DIR/fixtures/bl1413"

# 01: a NUL-filled line older than the newest heartbeat does not change the
# measured age. Direct function probe (never observable through run_checker
# alone, since a healthy run leaves no external trace of the exact age) AND
# a full checker run proving no restart/announce follows from it.
ROOT="$(make_root)"
NOW=1700000000
OLD_TS="$(date -u -d "@$((NOW - 500))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 500)) +%Y-%m-%dT%H:%M:%SZ)"
RECENT_TS="$(date -u -d "@$((NOW - 10))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 10)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
{
  printf '%s heartbeat\n' "$OLD_TS"
  printf '\0\0\0'
  printf '\n'
  printf '%s heartbeat\n' "$RECENT_TS"
} > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
PROBED_AGE="$(NOW=$NOW /bin/sh "$BL1413_PROBE" "$CHECKER" "$ROOT/.swarmforge/daemon/handoffd.log" | awk '{print $1}')"
check "BL-1413-01: measured age is 10 seconds despite the older NUL-filled line" '[[ "$PROBED_AGE" -eq 10 ]]'
run_checker "$ROOT" "$NOW"
check "BL-1413-01: no restart across the NUL byte" '[[ ! -f "$ROOT/kills.log" ]]'
check "BL-1413-01: no announce" '[[ ! -f "$ROOT/announces.log" ]]'
pass "BL-1413-01: a NUL-filled line older than the newest heartbeat does not change the measured age"

# 02: a NUL-filled line with NO heartbeat after it leaves the age at the
# last real (pre-NUL) heartbeat - the NUL line itself never matches the
# heartbeat token, so it simply never becomes a candidate.
ROOT="$(make_root)"
NOW=1700000000
RECENT_TS="$(date -u -d "@$((NOW - 20))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 20)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
{
  printf '%s heartbeat\n' "$RECENT_TS"
  printf '\0\0\0'
} > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
PROBED_AGE="$(NOW=$NOW /bin/sh "$BL1413_PROBE" "$CHECKER" "$ROOT/.swarmforge/daemon/handoffd.log" | awk '{print $1}')"
check "BL-1413-02: measured age is 20 seconds - the trailing NUL line is not a heartbeat candidate" '[[ "$PROBED_AGE" -eq 20 ]]'
run_checker "$ROOT" "$NOW"
check "BL-1413-02: no restart" '[[ ! -f "$ROOT/kills.log" ]]'
check "BL-1413-02: no announce" '[[ ! -f "$ROOT/announces.log" ]]'
pass "BL-1413-02: a NUL-filled line with no heartbeat after it leaves the age at the last real heartbeat"

# 03 (regression guard): a log whose newest heartbeat is genuinely past the
# threshold, with a NUL-filled line before it, still restarts and announces
# with the real age - the fix must never turn a genuine stale-heartbeat
# into a false negative.
ROOT="$(make_root)"
NOW=1700000000
STALE_TS="$(date -u -d "@$((NOW - 200))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 200)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
{
  printf '\0\0\0'
  printf '\n'
  printf '%s heartbeat\n' "$STALE_TS"
} > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
sleep 120 &
FAKE_PID=$!
echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE_PID" 2>/dev/null || true
check "BL-1413-03: a genuinely stale heartbeat (NUL line before it) still restarts" \
  'grep -qx "$FAKE_PID" "$ROOT/kills.log"'
check "BL-1413-03: durable record names the real age (200), not the NUL sentinel" \
  'grep -q "daemon=handoffd" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "age_secs=200" "$ROOT/.swarmforge/daemon/freshness-incidents.log" && grep -q "action=restart" "$ROOT/.swarmforge/daemon/freshness-incidents.log"'
check "BL-1413-03: announced with the real age" \
  'grep -q "FRESHNESS_VIOLATION restart swarm=primary daemon=handoffd" "$ROOT/announces.log"'
pass "BL-1413-03: a genuinely stale log with a NUL-filled line before it still restarts and announces the real age"

# 03b: the torn-line fallback specifically - the NEWEST matching line's OWN
# timestamp is corrupt (not hidden by a NUL byte truncation), and an OLDER
# line is fresh and parseable. Distinct failure mode from 01-03: proves the
# fallback loop itself, not just the -a flag.
ROOT="$(make_root)"
NOW=1700000000
RECENT_TS="$(date -u -d "@$((NOW - 15))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 15)) +%Y-%m-%dT%H:%M:%SZ)"
FRESH_TS="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"
{
  printf '%s heartbeat\n' "$RECENT_TS"
  printf 'not-a-timestamp heartbeat\n'
} > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$FRESH_TS" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
PROBED="$(NOW=$NOW /bin/sh "$BL1413_PROBE" "$CHECKER" "$ROOT/.swarmforge/daemon/handoffd.log")"
check "BL-1413-03b: a torn newest line falls back to the older parseable one (age 15)" '[[ "$(printf "%s" "$PROBED" | awk "{print \$1}")" -eq 15 ]]'
check "BL-1413-03b: falls back with reason stale-heartbeat, not unparseable-timestamp" '[[ "$(printf "%s" "$PROBED" | awk "{print \$2}")" == "stale-heartbeat" ]]'
run_checker "$ROOT" "$NOW"
check "BL-1413-03b: no restart - the fallback found a fresh heartbeat" '[[ ! -f "$ROOT/kills.log" ]]'
pass "BL-1413-03b: a torn newest heartbeat line falls back to the newest parseable one"

# 04: the check over the real (trimmed) 2026-09-05 supervisor logs reports
# every supervisor fresh. Each fixture is a real excerpt around that
# supervisor's actual NUL-filled crash line (BL-1413's own incident); a
# synthetic recent heartbeat is appended at test time (never baked into the
# committed fixture) so the scenario stays deterministic forever rather than
# drifting against wall-clock time.
ROOT="$(make_root)"
NOW=1700000000
RECENT_TS="$(date -u -d "@$((NOW - 10))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -r $((NOW - 10)) +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$ROOT/.swarmforge/daemon" "$ROOT/.swarmforge/operator"
FAKE_SUP_PIDS=()
for pair in \
  "handoffd-supervisor.trimmed.log:.swarmforge/daemon/handoffd-supervisor.log:.swarmforge/daemon/handoffd-supervisor.pid" \
  "front-desk-supervisor.trimmed.log:.swarmforge/operator/front-desk-supervisor.log:.swarmforge/operator/front-desk-supervisor.pid" \
  "cursor-bridge-supervisor.trimmed.log:.swarmforge/operator/cursor-bridge-supervisor.log:.swarmforge/operator/cursor-bridge-supervisor.pid" \
  "onboarder-supervisor.trimmed.log:.swarmforge/operator/onboarder-supervisor.log:.swarmforge/operator/onboarder-supervisor.pid" \
  "operator-runtime-supervisor.trimmed.log:.swarmforge/operator/operator-runtime-supervisor.log:.swarmforge/operator/operator-runtime-supervisor.pid"
do
  src="${pair%%:*}"
  rest="${pair#*:}"
  dst="${rest%%:*}"
  pid_dst="${rest#*:}"
  cp "$BL1413_FIXTURES/$src" "$ROOT/$dst"
  printf '%s heartbeat\n' "$RECENT_TS" >> "$ROOT/$dst"
  # A pid file naming a REAL live process - *_supervisor rows are skipped
  # entirely when their pid file is absent (BL-784), which would make this
  # scenario pass trivially without ever exercising heartbeat_age_secs.
  sleep 120 &
  fake_pid=$!
  FAKE_SUP_PIDS+=("$fake_pid")
  echo "$fake_pid" > "$ROOT/$pid_dst"
done
printf '%s heartbeat\n' "$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)" > "$ROOT/.swarmforge/daemon/handoffd.log"
printf '%s heartbeat\n' "$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
run_checker "$ROOT" "$NOW"
for fake_pid in "${FAKE_SUP_PIDS[@]}"; do
  kill "$fake_pid" 2>/dev/null || true
done
check "BL-1413-04: no supervisor was killed despite its real NUL-filled line" '[[ ! -f "$ROOT/kills.log" ]]'
check "BL-1413-04: no supervisor was restarted" '[[ ! -f "$ROOT/starts.log" ]] || ! grep -q . "$ROOT/starts.log"'
check "BL-1413-04: nothing was announced" '[[ ! -f "$ROOT/announces.log" ]]'
pass "BL-1413-04: the real 2026-09-05 supervisor logs, NUL line and all, all report fresh"

if [[ "$fail" -eq 0 ]]; then
  echo "BL-675 daemon-log-freshness: ALL CHECKS PASSED"
else
  echo "BL-675 daemon-log-freshness: FAILURES"
  exit 1
fi
