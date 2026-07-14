#!/usr/bin/env bash
# BL-258: handoffd.bb now also sweeps for the configured morning briefing-
# GENERATION trigger, on the same cadence as chase-sweep!/dispatch-gap-
# sweep!/briefing-email-sweep!. This is a light wiring smoke test - the
# DECISION logic itself (is it time yet, has today's briefing already been
# generated) is exhaustively covered by
# briefing_generation_schedule_test_runner.bb's injected-clock assertions;
# this test only proves the real daemon actually reaches and fires the
# sweep against a real fixture, with a fake tmux so no real pane is ever
# touched.
#
# swarmforge.conf's briefing_morning_time_utc is a SHARED, operator-level
# setting (same file handoffd_supervisor.bb's own BL-144 alarm and BL-214's
# briefing-email sweep already read, regardless of which project-root
# launched the daemon) - not overridable per fixture root. Asserting a
# POSITIVE fire deterministically (not dependent on wall-clock luck) needs
# a value guaranteed already-past "now" - this test temporarily overrides
# that one line to 00:00 and restores the original file on exit via trap,
# same discipline as any tracked-file-mutating test must leave the tree
# clean.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
REAL_CONF="$SCRIPT_DIR/../../swarmforge.conf"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

grep -q '^config briefing_morning_time_utc ' "$REAL_CONF" || fail "setup: expected swarmforge.conf to already declare briefing_morning_time_utc"

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
CONF_BACKUP="$(mktemp)"
cp "$REAL_CONF" "$CONF_BACKUP"
cleanup() {
  cp "$CONF_BACKUP" "$REAL_CONF"
  rm -f "$CONF_BACKUP"
  rm -rf "$ROOT"
}
trap cleanup EXIT

sed -i 's/^config briefing_morning_time_utc .*/config briefing_morning_time_utc 00:00/' "$REAL_CONF"
grep -q '^config briefing_morning_time_utc 00:00$' "$REAL_CONF" || fail "setup: failed to override briefing_morning_time_utc for the test"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coordinator\tcoordinator\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
# Deliberately no docs/briefings/<today>.md fixture file - the trigger has
# something to fire on.

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
CALL_LOG="$ROOT/tmux-calls.log"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "$CALL_LOG"
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
env -u RESEND_API_KEY PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

for _ in $(seq 1 40); do
  [[ -f "$LOG_FILE" ]] && grep -q "briefing-generation-nudge-sent" "$LOG_FILE" 2>/dev/null && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

# ── 01: the real daemon fired the morning trigger and logged it ──────────
grep -q "briefing-generation-nudge-sent" "$LOG_FILE" || fail "01: expected the daemon's own briefing-generation sweep to fire and log a nudge; got: $(cat "$LOG_FILE" 2>/dev/null)"
pass "01: the consolidated daemon itself ran the briefing-generation sweep and fired"

# ── 02: the nudge actually went out via tmux, targeting the coordinator's own session ─
grep -q "swarmforge-coordinator" "$CALL_LOG" || fail "02: expected the nudge to target the coordinator's own tmux session"
grep -q "Daily briefing due" "$CALL_LOG" || fail "02: expected the daily-briefing nudge literal to be sent"
pass "02: the nudge reached the coordinator's pane via tmux with the expected instruction text"

# ── 03: the sweep itself never threw ──────────────────────────────────────
grep -q "briefing-generation-sweep-error" "$LOG_FILE" && fail "03: the briefing-generation sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "03: the briefing-generation sweep ran without throwing"

echo "ALL PASS"
