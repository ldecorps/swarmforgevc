#!/usr/bin/env bash
# BL-146: single-daemon consolidation. handoffd.bb now also runs the
# chase/nudge sweep (chase_sweep_lib.bb) on its own cadence, sharing the
# same process/thread that already owns handoff delivery. This is a light
# wiring smoke test - the sweep DECISION logic itself is exhaustively
# covered by test_chase_sweep.sh's fake-clock/fake-adapter scenarios; this
# test only proves the real daemon actually fires the tick and updates the
# status file, using a real (but fake) tmux on PATH.
#
# Covers acceptance scenarios BL-146 single-daemon-01 and single-daemon-02.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
SUPERVISOR="$SCRIPT_DIR/../handoffd_supervisor.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coder\tmaster\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"

INBOX_NEW="$ROOT/.swarmforge/handoffs/inbox/new"
HANDOFF_FILE="$INBOX_NEW/00_20260701T000000Z_000001_from_specifier_to_coder.handoff"
printf 'id: t\nfrom: specifier\nto: coder\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' \
  > "$HANDOFF_FILE"
# Old enough to clear chaseTimeoutSeconds (30s) against real wall-clock time.
python3 -c "import os,time; os.utime('$HANDOFF_FILE', (time.time()-45, time.time()-45))"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
if [[ "$1 $2 $3" == "-S "*"capture-pane" ]]; then
  exit 0
fi
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

for _ in $(seq 1 40); do
  [[ -f "$HANDOFF_FILE.chase.json" ]] && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

# ── 01: the daemon itself performed the chase (no extension-host process exists here) ─
[[ -f "$HANDOFF_FILE.chase.json" ]] || fail "01: chase sidecar was never written - the daemon's sweep did not run"
CHASE_COUNT="$(python3 -c "import json; print(json.load(open('$HANDOFF_FILE.chase.json'))['chaseCount'])")"
[[ "$CHASE_COUNT" -ge 1 ]] || fail "01: chaseCount not incremented (got $CHASE_COUNT)"
grep -q "send-keys" "$TMUX_LOG" || fail "01: no wake-up (send-keys) was sent for the chased item"
pass "01: the consolidated daemon itself performed the chase sweep"

# ── 01b (BL-098): the same chase decision durably logs a telemetry event ────
MONTH="$(date -u +%Y-%m)"
TELEMETRY_FILE="$ROOT/.swarmforge/telemetry/chaser-$MONTH.jsonl"
[[ -f "$TELEMETRY_FILE" ]] || fail "01b: chaser telemetry log was never written"
python3 - "$TELEMETRY_FILE" <<'PY'
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
chase_events = [l for l in lines if l.get("type") == "chase" and l.get("role") == "coder"]
assert chase_events, f"no chase telemetry event for role coder: {lines!r}"
event = chase_events[0]
assert event.get("handoffId"), f"telemetry event missing handoffId: {event!r}"
assert isinstance(event.get("count"), int) and event["count"] >= 1, f"telemetry event missing/bad count: {event!r}"
assert event.get("at"), f"telemetry event missing timestamp: {event!r}"
PY
pass "01b (BL-098 telemetry-01): the daemon's own chase decision durably logs a telemetry event"

# ── 02: duties file advertises both duties with a pid and per-duty timestamp ─
# A dedicated file, not handoffd.status.json - that file is exclusively
# owned by handoffd_supervisor.bb, which runs CONCURRENTLY with handoffd.bb
# in a real launched swarm; a second read-modify-write onto the same file
# would race it (whichever process wrote last would silently clobber the
# other's fields, since neither locks the file).
DUTIES_FILE="$ROOT/.swarmforge/daemon/handoffd-duties.json"
[[ -f "$DUTIES_FILE" ]] || fail "02: handoffd-duties.json was never written"
python3 - "$DUTIES_FILE" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
assert isinstance(data.get("pid"), int), f"pid missing/not int: {data.get('pid')!r}"
assert data.get("delivery", {}).get("last_sweep_at"), "delivery.last_sweep_at missing"
assert data.get("chase", {}).get("last_sweep_at"), "chase.last_sweep_at missing"
PY
pass "02: duties file reports the daemon pid and a last-sweep timestamp for delivery and chase, without touching the supervisor's own handoffd.status.json"

# ── 03: handoffd.bb and handoffd_supervisor.bb writing concurrently never clobber each other ─
# This is exactly the real launched-swarm shape (swarmforge.sh starts both
# against the same project root) - the bug this dedicated duties file
# fixes was a lost-update race when both processes read-modify-wrote the
# SAME handoffd.status.json with no locking on either side.
rm -f "$ROOT/.swarmforge/daemon/stop"
PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID2=$!
for _ in $(seq 1 40); do
  [[ -s "$ROOT/.swarmforge/daemon/handoffd.pid" ]] && break
  sleep 0.25
done

for _ in $(seq 1 20); do
  SUPERVISOR_STALL_MS=60000 SUPERVISOR_RAPID_WINDOW_MS=60000 SUPERVISOR_MAX_RAPID=3 \
  SUPERVISOR_BACKOFF_MS=60000 PATH="$FAKE_BIN:$PATH" bb "$SUPERVISOR" "$ROOT" --check-once
  [[ -f "$DUTIES_FILE" ]] && grep -q '"chase"' "$DUTIES_FILE" 2>/dev/null && break
  sleep 0.25
done

touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID2" 2>/dev/null || true

STATUS_FILE="$ROOT/.swarmforge/daemon/handoffd.status.json"
[[ -f "$STATUS_FILE" ]] || fail "03: supervisor's handoffd.status.json was never written"
python3 - "$STATUS_FILE" "$DUTIES_FILE" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
duties = json.load(open(sys.argv[2]))
assert status.get("state") == "healthy", f"03: supervisor status not healthy: {status!r}"
assert isinstance(duties.get("pid"), int), f"03: duties file lost its pid field: {duties!r}"
assert duties.get("chase", {}).get("last_sweep_at"), f"03: duties file lost its chase timestamp: {duties!r}"
PY
pass "03: handoffd.bb and handoffd_supervisor.bb write concurrently without clobbering each other's status file"

echo "ALL PASS"
