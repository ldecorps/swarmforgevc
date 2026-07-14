#!/usr/bin/env bash
# BL-214: handoffd.bb now also sweeps docs/briefings/ for a newly committed
# briefing and emails it via daemon_alarm_lib.bb's send-alarm-email!, on the
# same cadence as chase-sweep!/dispatch-gap-sweep!. This is a light wiring
# smoke test - the scanning/marker/subject DECISION logic itself is
# exhaustively covered by briefing_email_test_runner.bb's fake-adapter
# scenarios; this test only proves the real daemon actually fires the
# sweep against a real fixture, using the real (repo) swarmforge.conf the
# same way the BL-215 supervisor wiring test does. Explicitly unsets
# RESEND_API_KEY so this never risks a real network call regardless of the
# ambient shell's env - the skip path is what gets end-to-end verified here;
# a real successful send is covered by the fake-adapter unit tests.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'Headline: BL-214 wiring smoke test\n\nBody.\n' > "$ROOT/docs/briefings/2026-07-09.md"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

DUTIES_FILE="$ROOT/.swarmforge/daemon/handoffd-duties.json"

env -u RESEND_API_KEY PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
for _ in $(seq 1 40); do
  [[ -f "$LOG_FILE" ]] && grep -q "briefing-skip" "$LOG_FILE" 2>/dev/null && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

# ── 01: the real daemon ran the sweep and logged the (safe, no-network) skip ─
grep -q "briefing-skip" "$LOG_FILE" || fail "01: expected the daemon's own briefing-email sweep to log a skip (RESEND_API_KEY unset); got: $(cat "$LOG_FILE" 2>/dev/null)"
pass "01: the consolidated daemon itself ran the briefing-email sweep"

# ── 02: an unconfigured/failed attempt never marks the briefing sent - retried next sweep ─
[[ -f "$ROOT/docs/briefings/.sent.json" ]] && fail "02: the briefing must not be marked sent when the send was skipped"
pass "02: the briefing is not marked sent, so an unconfigured sweep retries it next cycle"

# ── 03: the sweep itself never threw (a caught briefing-email-sweep-error
#     would mean the wiring is broken, not just gracefully unconfigured) ───
grep -q "briefing-email-sweep-error" "$LOG_FILE" && fail "03: the briefing-email sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "03: the briefing-email sweep ran without throwing"

echo "ALL PASS"
