#!/usr/bin/env bash
# BL-308: while the swarm is hibernated (BL-307's hibernation.json),
# handoffd.bb's briefing-generation-sweep! now composes and writes the
# day's briefing headlessly instead of nudging a (nonexistent) coordinator.
# The DECISION/CONTENT logic itself is exhaustively covered by
# briefing_generation_schedule_test_runner.bb and
# banked_briefing_test_runner.bb's fake-adapter/pure assertions; this test
# only proves the real daemon reaches and fires the headless branch against
# a real fixture (real hibernation.json, real backlog dirs, fake tmux so no
# real pane is ever touched, and never a real nudge).
#
# Same discipline as test_handoffd_briefing_generation_wiring.sh: overrides
# swarmforge.conf's briefing_morning_time_utc to 00:00 (guaranteed already
# past "now") via a trap-restored sed, since that setting is shared/
# operator-level, not overridable per fixture root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
REAL_CONF="$SCRIPT_DIR/../../swarmforge.conf"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"

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
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings" \
  "$ROOT/.swarmforge/operator" "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
# Deliberately NO coordinator in the roster - hibernated mode has none.
printf '' > "$ROOT/.swarmforge/roles.tsv"

cat > "$ROOT/.swarmforge/operator/hibernation.json" <<JSON
{"hibernated": true, "hibernated_at_ms": 1752300000000, "config_path": "swarmforge/packs/concierge-banked.conf"}
JSON

printf 'id: BL-401\nstatus: paused\n' > "$ROOT/backlog/paused/BL-401.yaml"
printf 'id: BL-402\nstatus: paused\n' > "$ROOT/backlog/paused/BL-402.yaml"
printf 'id: BL-350\nstatus: done\n' > "$ROOT/backlog/done/BL-350.yaml"

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
# emit-cost-health-sidecar.js shells to node against the real extension/out
# build; degrade gracefully in this bare fixture root (no such build there)
# is already the adapter's own established best-effort behavior - not
# faked here, same posture as the BL-214/BL-258 wiring tests above.

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
env -u RESEND_API_KEY PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

for _ in $(seq 1 40); do
  [[ -f "$LOG_FILE" ]] && grep -q "briefing-generation-headless-composed" "$LOG_FILE" 2>/dev/null && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

BRIEFING_FILE="$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

# ── 01: the real daemon fired the headless composer and logged it ───────
grep -q "briefing-generation-headless-composed" "$LOG_FILE" || fail "01: expected the daemon's own headless composer to fire and log; got: $(cat "$LOG_FILE" 2>/dev/null)"
pass "01: the consolidated daemon fired the headless (banked) briefing composer"

# ── 02: the briefing file was actually written, labeled, and sectioned ──
[[ -f "$BRIEFING_FILE" ]] || fail "02: expected $BRIEFING_FILE to be written directly"
grep -q "Swarm parked - lightweight briefing" "$BRIEFING_FILE" || fail "02: expected the parked/lightweight label in the composed briefing"
grep -q "## Backlog counts" "$BRIEFING_FILE" || fail "02: expected a backlog counts section"
grep -q "paused: 2" "$BRIEFING_FILE" || fail "02: expected the backlog counts to reflect the fixture's 2 paused tickets"
grep -q "done: 1" "$BRIEFING_FILE" || fail "02: expected the backlog counts to reflect the fixture's 1 done ticket"
grep -q "## Parked profile" "$BRIEFING_FILE" || fail "02: expected a parked profile section"
grep -q "concierge-banked" "$BRIEFING_FILE" || fail "02: expected the parked profile name from hibernation.json's config_path"
pass "02: the composed briefing is labeled parked/lightweight and carries the expected sections"

# ── 03: no coordinator nudge was ever sent - no tmux call at all ────────
[[ -f "$CALL_LOG" ]] && fail "03: expected zero tmux invocations while hibernated (no coordinator to nudge), got: $(cat "$CALL_LOG")"
pass "03: no tmux nudge was sent while hibernated"

# ── 04: the sweep itself never threw ─────────────────────────────────────
grep -q "briefing-generation-sweep-error" "$LOG_FILE" && fail "04: the briefing-generation sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "04: the briefing-generation sweep ran without throwing"

echo "ALL PASS"
