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

echo "ALL PASS"
