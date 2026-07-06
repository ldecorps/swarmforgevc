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

# ── 02: status file advertises both duties with a pid and per-duty timestamp ─
STATUS_FILE="$ROOT/.swarmforge/daemon/handoffd.status.json"
[[ -f "$STATUS_FILE" ]] || fail "02: handoffd.status.json was never written"
python3 - "$STATUS_FILE" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
assert isinstance(data.get("pid"), int), f"pid missing/not int: {data.get('pid')!r}"
assert data.get("delivery", {}).get("last_sweep_at"), "delivery.last_sweep_at missing"
assert data.get("chase", {}).get("last_sweep_at"), "chase.last_sweep_at missing"
PY
pass "02: status file reports the daemon pid and a last-sweep timestamp for delivery and chase"

echo "ALL PASS"
