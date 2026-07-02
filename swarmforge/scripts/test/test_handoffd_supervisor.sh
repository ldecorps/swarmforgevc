#!/usr/bin/env bash
# BL-061: handoffd dies or hangs silently and the whole swarm stalls. The
# supervisor must detect a dead pid OR stalled delivery, restart the daemon
# (rotating its log aside), back off instead of crash-looping, and record
# every state change in .swarmforge/daemon/handoffd.status.json.
#
# Covers acceptance scenarios BL-061 supervise-handoffd-01..05 (00 is covered
# by test_handoffd_per_recipient_delivery.sh, 06 by extension tests).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPERVISOR="$SCRIPT_DIR/../handoffd_supervisor.bb"
# Canonical (no "test/..") so it textually matches the path
# handoffd_supervisor.bb's own start-daemon! spawns with (which resolves via
# fs/canonicalize) - needed for exact ps command-line matching in the BL-081
# scenarios below.
HANDOFFD="$(cd "$SCRIPT_DIR/.." && pwd)/handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

check_once() {
  SUPERVISOR_STALL_MS=500 SUPERVISOR_RAPID_WINDOW_MS=60000 SUPERVISOR_MAX_RAPID=3 \
  SUPERVISOR_BACKOFF_MS=60000 PATH="$FAKE_BIN:$PATH" bb "$SUPERVISOR" "$ROOT" --check-once
}

status_field() {
  python3 -c "import json,sys; print(json.load(open('$DAEMON_DIR/handoffd.status.json')).get('$1',''))"
}

make_fixture() {
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  DAEMON_DIR="$ROOT/.swarmforge/daemon"
  CODER_WT="$ROOT/.worktrees/coder"
  mkdir -p "$DAEMON_DIR" "$CODER_WT/.swarmforge/handoffs/outbox"
  echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"
  touch "$ROOT/fake.sock"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
    > "$ROOT/.swarmforge/roles.tsv"

  FAKE_BIN="$ROOT/bin"
  mkdir -p "$FAKE_BIN"
  cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
  chmod +x "$FAKE_BIN/tmux"
  # macOS scans a fresh executable on first exec (several seconds); pay that
  # cost here so it does not eat into delivery wait budgets below.
  "$FAKE_BIN/tmux" >/dev/null 2>&1 || true
}

queue_outbox() {
  printf 'id: t\nfrom: coder\nto: coder\npriority: 50\ntype: note\nmessage: hello\ncreated_at: 2026-07-01T00:00:00Z\n\nhello\n' \
    > "$CODER_WT/.swarmforge/handoffs/outbox/50_supervisor_test.handoff"
}

daemon_pid() { cat "$DAEMON_DIR/handoffd.pid" 2>/dev/null || echo ""; }

wait_for() {
  local desc="$1"; shift
  for _ in $(seq 1 80); do
    if "$@"; then return 0; fi
    sleep 0.25
  done
  fail "timed out waiting for: $desc"
}

outbox_empty() {
  [[ "$(find "$CODER_WT/.swarmforge/handoffs/outbox" -maxdepth 1 -name '*.handoff' | wc -l | tr -d ' ')" == "0" ]]
}

stop_daemon() {
  local pid; pid="$(daemon_pid)"
  [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
}

# ── 01: dead daemon is detected, restarted, stranded mail delivered ──────────
make_fixture
trap 'stop_daemon; rm -rf "$ROOT"' EXIT
echo "999999" > "$DAEMON_DIR/handoffd.pid"   # dead pid
echo "old log line" > "$DAEMON_DIR/handoffd.log"
queue_outbox

check_once

[[ "$(status_field state)" == "restarting" ]] || fail "01: status not 'restarting' after dead-pid restart"
wait_for "stranded outbox delivery after restart" outbox_empty
grep -q "hello" "$CODER_WT/.swarmforge/handoffs/inbox/new/"*.handoff \
  || fail "01: stranded handoff not delivered to inbox"
pass "01: dead daemon detected, restarted, stranded mail delivered, incident recorded"

# ── healthy state is recorded once the daemon recovers ───────────────────────
wait_for "daemon heartbeat" test -f "$DAEMON_DIR/handoffd.heartbeat"
check_once
[[ "$(status_field state)" == "healthy" ]] || fail "recovered daemon not marked healthy"
pass "recovered daemon marked healthy in status file"

# ── 03: restart rotated the previous log aside ───────────────────────────────
ROTATED="$(ls "$DAEMON_DIR"/handoffd.log.* 2>/dev/null | head -1)"
[[ -n "$ROTATED" ]] || fail "03: no rotated log found"
grep -q "old log line" "$ROTATED" || fail "03: rotated log lost pre-restart content"
pass "03: previous log rotated aside with content preserved"

# ── 04: heartbeat evidence exists while running ──────────────────────────────
grep -q "heartbeat" "$DAEMON_DIR/handoffd.log" || fail "04: no heartbeat line in daemon log"
[[ -f "$DAEMON_DIR/handoffd.heartbeat" ]] || fail "04: no heartbeat file"
pass "04: heartbeat evidence present in log and heartbeat file"

# ── 02: lingering pid with stalled delivery counts as dead ───────────────────
stop_daemon
sleep 0.3
# a process that is alive but is not the daemon: simulates a hung daemon pid
sleep 300 &
HUNG_PID=$!
echo "$HUNG_PID" > "$DAEMON_DIR/handoffd.pid"
queue_outbox
touch -t 202601010000 "$CODER_WT/.swarmforge/handoffs/outbox/50_supervisor_test.handoff"
touch -t 202601010000 "$DAEMON_DIR/handoffd.heartbeat"

check_once

kill -0 "$HUNG_PID" 2>/dev/null && { kill -9 "$HUNG_PID"; fail "02: hung pid was not terminated"; }
[[ "$(status_field state)" == "restarting" ]] || fail "02: stalled daemon not marked restarting"
wait_for "stalled mail delivered after restart" outbox_empty
pass "02: stalled delivery with lingering pid declared unhealthy and restarted"

# ── 05: crash-looping daemon backs off with persistent-failure ───────────────
stop_daemon
rm -f "$ROOT/.swarmforge/tmux-socket"        # daemon now dies instantly at startup
rm -f "$DAEMON_DIR/handoffd.status.json"
echo "999999" > "$DAEMON_DIR/handoffd.pid"
queue_outbox

for i in 1 2 3 4; do
  check_once
  sleep 0.4
  echo "999999" > "$DAEMON_DIR/handoffd.pid"  # each restart died again
done

[[ "$(status_field state)" == "persistent-failure" ]] \
  || fail "05: crash loop did not surface persistent-failure (got: $(status_field state))"
BEFORE="$(ls "$DAEMON_DIR"/handoffd.log.* | wc -l | tr -d ' ')"
check_once
AFTER="$(ls "$DAEMON_DIR"/handoffd.log.* | wc -l | tr -d ' ')"
[[ "$BEFORE" == "$AFTER" ]] || fail "05: supervisor kept hot-restarting during backoff"
pass "05: bounded restarts, then persistent-failure recorded and backoff honored"

# ── BL-081: at most one handoffd process per project root ────────────────────
# Covers acceptance scenarios BL-081 singleton-handoffd-01..06.

pid_alive() { kill -0 "$1" 2>/dev/null; }

start_real_daemon() {
  PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" >/dev/null 2>&1 &
  echo $!
}

handoffd_process_count() {
  ps -eo command= | grep -F -x "bb $HANDOFFD $ROOT" | wc -l | tr -d ' '
}

now_ms() { python3 -c "import time; print(int(time.time()*1000))"; }

# Fresh, isolated fixture for the BL-081 scenarios below (the BL-061
# scenarios above leave their own daemons/log rotations in $ROOT).
stop_daemon
rm -rf "$ROOT"
make_fixture
trap 'stop_daemon; rm -rf "$ROOT"' EXIT

# ── 01: restart confirms old-daemon exit before starting the new one ────────
# A fake daemon that takes 0.8s to exit once TERM'd. bash's own `trap` does
# not reliably fire for a backgrounded script in this environment, so the
# fixture is a small python3 process with a real signal handler instead.
cat > "$FAKE_BIN/slow_daemon.py" <<'EOF'
import signal, time, sys
def handler(signum, frame):
    time.sleep(0.8)
    sys.exit(0)
signal.signal(signal.SIGTERM, handler)
while True:
    time.sleep(0.05)
EOF
python3 "$FAKE_BIN/slow_daemon.py" &
SLOW_PID=$!
echo "$SLOW_PID" > "$DAEMON_DIR/handoffd.pid"
queue_outbox
touch -t 202601010000 "$CODER_WT/.swarmforge/handoffs/outbox/50_supervisor_test.handoff"
touch -t 202601010000 "$DAEMON_DIR/handoffd.heartbeat"
rm -f "$DAEMON_DIR/handoffd.status.json"

START_MS="$(now_ms)"
check_once
END_MS="$(now_ms)"
ELAPSED=$((END_MS - START_MS))

pid_alive "$SLOW_PID" && { kill -9 "$SLOW_PID"; fail "01: old daemon (slow to die) still alive after restart"; }
[[ "$ELAPSED" -ge 700 ]] \
  || fail "01: restart returned in ${ELAPSED}ms, before the old daemon's 0.8s TERM trap could have finished - it did not wait for a confirmed exit"
[[ "$(status_field state)" == "restarting" ]] || fail "01: status not 'restarting' after restart"
wait_for_pidfile() { wait_for "new daemon wrote its pid file" test -s "$DAEMON_DIR/handoffd.pid"; }
wait_for_pidfile
pass "01: restart confirms the old daemon's exit (waited ${ELAPSED}ms) before starting the replacement"

# ── 03: a daemon that ignores TERM is force-killed and confirmed ────────────
stop_daemon
cat > "$FAKE_BIN/stubborn_daemon.py" <<'EOF'
import signal, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
while True:
    time.sleep(0.05)
EOF
python3 "$FAKE_BIN/stubborn_daemon.py" &
STUBBORN_PID=$!
echo "$STUBBORN_PID" > "$DAEMON_DIR/handoffd.pid"
queue_outbox
touch -t 202601010000 "$CODER_WT/.swarmforge/handoffs/outbox/50_supervisor_test.handoff"
touch -t 202601010000 "$DAEMON_DIR/handoffd.heartbeat"
rm -f "$DAEMON_DIR/handoffd.status.json"

SUPERVISOR_KILL_TIMEOUT_MS=500 SUPERVISOR_STALL_MS=500 SUPERVISOR_RAPID_WINDOW_MS=60000 \
SUPERVISOR_MAX_RAPID=3 SUPERVISOR_BACKOFF_MS=60000 PATH="$FAKE_BIN:$PATH" \
  bb "$SUPERVISOR" "$ROOT" --check-once

pid_alive "$STUBBORN_PID" && { kill -9 "$STUBBORN_PID"; fail "03: TERM-ignoring daemon was not force-killed"; }
[[ "$(status_field state)" == "restarting" ]] || fail "03: status not 'restarting' after force-kill restart"
wait_for_pidfile
pass "03: a daemon that ignores TERM is escalated to SIGKILL and its death confirmed before restart proceeds"

# ── 02: orphan daemons outside the pid file are reaped on restart ───────────
stop_daemon
rm -f "$DAEMON_DIR/handoffd.pid" "$DAEMON_DIR/handoffd.status.json"
PID_A="$(start_real_daemon)"
wait_for "daemon A wrote its pid file" bash -c "[[ \"\$(cat '$DAEMON_DIR/handoffd.pid' 2>/dev/null)\" == '$PID_A' ]]"

# Overwrite the pid file with an unrelated-but-alive pid (this test script's
# own pid, which is alive but is not a handoffd.bb process) so daemon B's
# singleton guard sees no live conflicting handoffd and starts normally,
# reproducing the leaked state BL-081 describes - "a pid file overwritten by
# a newer start" orphans the previous daemon - without needing an exact race.
echo "$$" > "$DAEMON_DIR/handoffd.pid"
PID_B="$(start_real_daemon)"
wait_for "daemon B wrote its pid file" bash -c "[[ \"\$(cat '$DAEMON_DIR/handoffd.pid' 2>/dev/null)\" == '$PID_B' ]]"

pid_alive "$PID_A" || fail "02 setup: orphan daemon A is not alive"
pid_alive "$PID_B" || fail "02 setup: tracked daemon B is not alive"

# Simulate B having just died (a real running daemon keeps refreshing its
# own heartbeat file, so faking a stale heartbeat to force a :stalled verdict
# would race against B's own 1s poll loop); a dead tracked pid is a
# deterministic :dead verdict and still exercises restart!'s reap-and-replace
# path exactly as a real crash would.
kill -9 "$PID_B"

check_once

pid_alive "$PID_A" && { kill -9 "$PID_A"; fail "02: orphan daemon A was not terminated"; }
pid_alive "$PID_B" && { kill -9 "$PID_B"; fail "02: old tracked daemon B was not terminated"; }
wait_for_pidfile
COUNT="$(handoffd_process_count)"
[[ "$COUNT" == "1" ]] || fail "02: expected exactly one handoffd process after restart; found $COUNT"
pass "02: every old handoffd process for the root is terminated on restart, exactly one remains"

# ── 05: reaping an orphan does not delete the survivor's pid file ───────────
stop_daemon
rm -f "$DAEMON_DIR/handoffd.pid" "$DAEMON_DIR/handoffd.status.json"
PID_A="$(start_real_daemon)"
wait_for "survivor wrote its pid file" bash -c "[[ \"\$(cat '$DAEMON_DIR/handoffd.pid' 2>/dev/null)\" == '$PID_A' ]]"
wait_for "survivor heartbeat exists" test -f "$DAEMON_DIR/handoffd.heartbeat"

echo "$$" > "$DAEMON_DIR/handoffd.pid"   # let an orphan momentarily claim the pid file
PID_B="$(start_real_daemon)"
wait_for "orphan wrote its pid file" bash -c "[[ \"\$(cat '$DAEMON_DIR/handoffd.pid' 2>/dev/null)\" == '$PID_B' ]]"
echo "$PID_A" > "$DAEMON_DIR/handoffd.pid"   # pid file names the survivor again; B is now the orphan

pid_alive "$PID_A" || fail "05 setup: survivor is not alive"
pid_alive "$PID_B" || fail "05 setup: orphan is not alive"
# no pending outbox / stale heartbeat here: the tracked survivor must read
# as healthy so reaping happens independent of any restart decision.

check_once

[[ "$(cat "$DAEMON_DIR/handoffd.pid")" == "$PID_A" ]] || fail "05: pid file no longer names the surviving daemon"
pid_alive "$PID_A" || fail "05: the surviving daemon was killed while reaping its orphan"
pid_alive "$PID_B" && { kill -9 "$PID_B"; fail "05: orphan was not reaped"; }
COUNT="$(handoffd_process_count)"
[[ "$COUNT" == "1" ]] || fail "05: expected exactly one handoffd process after reaping; found $COUNT"
pass "05: reaping an orphan leaves the survivor's pid file and process untouched, no extra daemon started"

# ── 06: a second daemon start does not orphan the running one ───────────────
stop_daemon
rm -f "$DAEMON_DIR/handoffd.pid" "$DAEMON_DIR/handoffd.status.json"
PID_FIRST="$(start_real_daemon)"
wait_for "first daemon wrote its pid file" bash -c "[[ \"\$(cat '$DAEMON_DIR/handoffd.pid' 2>/dev/null)\" == '$PID_FIRST' ]]"

SECOND_START_LOG="$(mktemp)"
set +e
PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" >"$SECOND_START_LOG" 2>&1
RC=$?
set -e
[[ $RC -ne 0 ]] || fail "06: second start did not abort (exited 0)"
grep -qi "already owns" "$SECOND_START_LOG" || fail "06: abort message did not explain the conflict; got: $(cat "$SECOND_START_LOG")"
rm -f "$SECOND_START_LOG"

[[ "$(cat "$DAEMON_DIR/handoffd.pid")" == "$PID_FIRST" ]] || fail "06: pid file was replaced by the second start"
pid_alive "$PID_FIRST" || fail "06: the first daemon was orphaned/killed by the second start attempt"
COUNT="$(handoffd_process_count)"
[[ "$COUNT" == "1" ]] || fail "06: expected exactly one handoffd process; found $COUNT"
pass "06: a second daemon start aborts cleanly, leaving the running daemon and its pid file untouched"

# ── 04: swarm startup (launcher + supervisor both starting) yields one daemon ─
stop_daemon
rm -f "$DAEMON_DIR/handoffd.pid" "$DAEMON_DIR/handoffd.status.json"
PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" >"$ROOT/launcher_start.log" 2>&1 &
PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" >"$ROOT/supervisor_start.log" 2>&1 &
wait_for "a pid file appears after the simultaneous starts" test -s "$DAEMON_DIR/handoffd.pid"
sleep 0.5   # let the losing side's abort (or the lock's loser) fully settle

COUNT="$(handoffd_process_count)"
[[ "$COUNT" == "1" ]] \
  || fail "04: expected exactly one handoffd process after simultaneous launcher+supervisor starts; found $COUNT"
pass "04: simultaneous launcher and supervisor starts still yield exactly one handoffd process"

echo "ALL PASS"
