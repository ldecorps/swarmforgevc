#!/usr/bin/env bash
# BL-577: flow watchdog sweep wiring smoke test. The DECISION logic itself
# (tier/verb/age/state/conf-fallback) is exhaustively covered by
# flow_watchdog_test_runner.bb's fake-clock/fixture scenarios; this test only
# proves the REAL handoffd.bb daemon actually fires the sweep on its own
# cadence and produces the real, observable side effects: a Telegram
# OPERATOR-topic alarm line and a durable flow-watchdog-state.json entry.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1
DAEMON_PID=""
cleanup() {
  [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"

# A tiny warn threshold so a real-wall-clock test doesn't need to wait 15
# minutes (the documented default) - proves the conf is actually read live,
# not just a hardcoded constant in handoffd.bb's own wiring.
printf 'config flow_watchdog_warn_ms 100\nconfig flow_watchdog_escalate_ms 200000\n' > "$ROOT/swarmforge/swarmforge.conf"

INBOX_NEW="$ROOT/.swarmforge/handoffs/inbox/new"
HANDOFF_FILE="$INBOX_NEW/00_20260701T000000Z_000001_from_specifier_to_cleaner.handoff"
ENQUEUED_AT="$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=5)).strftime('%Y-%m-%dT%H:%M:%S.%fZ'))")"
printf 'id: flow-watchdog-wiring-t1\nfrom: specifier\nto: cleaner\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\nenqueued_at: %s\n\nhi\n' \
  "$ENQUEUED_AT" > "$HANDOFF_FILE"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
# No live session for "cleaner" ever exists in this fixture - has-session
# always fails, so the watchdog's verb table resolves to :rotate.
if [[ "$3" == "has-session" ]]; then
  exit 1
fi
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

STATE_FILE="$ROOT/.swarmforge/daemon/flow-watchdog-state.json"
OUTBOX_FILE="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

for _ in $(seq 1 60); do
  [[ -f "$STATE_FILE" ]] && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

# ── 01: the real daemon's own sweep produced the durable state entry ───────
[[ -f "$STATE_FILE" ]] || fail "01: flow-watchdog-state.json was never written - the daemon's sweep did not run"
python3 - "$STATE_FILE" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
entry = data.get("flow-watchdog-wiring-t1")
assert entry, f"no state entry for the fixture parcel: {data!r}"
assert entry.get("tier") == "warn", f"expected warn tier, got: {entry!r}"
PY
pass "01: the real daemon's flow-watchdog sweep recorded a warn-tier state entry"

# ── 02: the alarm landed in the SAME durable Telegram outbox the endless-loop/claim-progress halts use ──
[[ -f "$OUTBOX_FILE" ]] || fail "02: telegram-reply-outbox.jsonl was never written"
python3 - "$OUTBOX_FILE" <<'PY'
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
alarms = [l for l in lines if l.get("threadId") == "OPERATOR" and "flow-watchdog-wiring-t1" in l.get("text", "")]
assert alarms, f"no flow-watchdog alarm line for the fixture parcel: {lines!r}"
text = alarms[0]["text"]
assert "cleaner" in text, f"alarm text missing holding role: {text!r}"
assert "rotate" in text, f"alarm text missing unblock verb (no live session -> rotate): {text!r}"
PY
pass "02: the real daemon emitted a Telegram OPERATOR-topic alarm naming the role and the rotate verb"
