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
CONF="$SRC/daemon_log_freshness.conf"
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

if [[ "$fail" -eq 0 ]]; then
  echo "BL-675 daemon-log-freshness: ALL CHECKS PASSED"
else
  echo "BL-675 daemon-log-freshness: FAILURES"
  exit 1
fi
