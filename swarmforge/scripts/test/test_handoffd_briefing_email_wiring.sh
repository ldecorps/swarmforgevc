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
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
DAEMON_PID=""
cleanup() {
  # BL-406: kill the daemon as a backstop even if an earlier assertion exits
  # this script before the normal stop-file+wait sequence below runs - the
  # root cause of six leaked /tmp acceptance-sandbox daemons.
  [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
# BL-821: a fixed past date would now fall outside the 2-day send window and
# be suppressed before ever reaching the :send-reason! skip path this test
# asserts on - use today (UTC), same technique as
# test_handoffd_banked_briefing_wiring.sh's TODAY_DAY_KEY.
TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"
printf 'Headline: BL-214 wiring smoke test\n\nBody.\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

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

# BL-902 warning-not-spammed-05: keep the daemon running a little longer -
# wait for at least 2 skip cycles. The sweep shares chase-sweep-every-cycles'
# cadence (10 poll-ms cycles, ~10s apart - see handoffd.bb), not poll-ms
# itself, so a 2nd cycle is ~10s out; bounded generously to absorb CI
# scheduling jitter without making a passing run wait the full bound.
for _ in $(seq 1 90); do
  SKIP_COUNT_NOW="$(grep -c "briefing-skip-missing-key" "$LOG_FILE" 2>/dev/null || true)"
  [[ "${SKIP_COUNT_NOW:-0}" -ge 2 ]] && break
  sleep 0.5
done

mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true
DAEMON_PID=""

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

# ── BL-902 warning-not-spammed-05: briefing-send-reason! (the new
#    :send-reason! adapter this ticket added) owns its own call to
#    warn-missing-key-if-needed!, wired to the SAME one-shot atom
#    send-configured-briefing-email! already used - proving that wiring
#    survived moving the warning trigger onto the early, pre-compose path
#    instead of only firing from a real send attempt. ────────────────────
SKIP_COUNT_FINAL="$(grep -c "briefing-skip-missing-key" "$LOG_FILE" 2>/dev/null || true)"
[[ "${SKIP_COUNT_FINAL:-0}" -ge 2 ]] || fail "BL-902: expected at least 2 briefing-skip-missing-key sweeps to have run, got ${SKIP_COUNT_FINAL:-0} - the daemon may not have run long enough for this assertion"
pass "BL-902: the sweep ran the early-skip path across multiple cycles (${SKIP_COUNT_FINAL} times)"

WARN_COUNT="$(grep -c "email-misconfigured" "$LOG_FILE" 2>/dev/null || true)"
[[ "${WARN_COUNT:-0}" -eq 1 ]] || fail "BL-902 warning-not-spammed-05: expected exactly 1 email-misconfigured warning across ${SKIP_COUNT_FINAL} early-skip sweeps, got ${WARN_COUNT:-0}"
pass "BL-902 warning-not-spammed-05: the missing-key warning fired exactly once across ${SKIP_COUNT_FINAL} early-skip sweeps, via the SAME one-shot dedup the real send path always used"

echo "ALL PASS"
