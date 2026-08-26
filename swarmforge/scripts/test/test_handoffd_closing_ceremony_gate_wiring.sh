#!/usr/bin/env bash
# BL-658: when closure_stop_local is usable, handoffd's briefing-generation
# sweep must NOT fire the independent morning trigger — even if
# briefing_morning_time_utc is already past. Proves the ceremony gate is
# consulted at the required_wiring site (handoffd.bb).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
REAL_CONF="$SCRIPT_DIR/../../swarmforge.conf"
GATE_JS="$SCRIPT_DIR/../../../extension/out/tools/night-closing-ceremony-gate.js"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[[ -f "$GATE_JS" ]] || fail "setup: compile extension first (missing $GATE_JS)"
grep -q '^config closure_stop_local ' "$REAL_CONF" || fail "setup: expected closure_stop_local in swarmforge.conf"

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1
DAEMON_PID=""
CONF_BACKUP="$(mktemp)"
cp "$REAL_CONF" "$CONF_BACKUP"
cleanup() {
  [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  cp "$CONF_BACKUP" "$REAL_CONF"
  rm -f "$CONF_BACKUP"
  rm -rf "$ROOT"
}
trap cleanup EXIT

# Force fixed morning due NOW — if the gate failed open this would nudge.
sed -i 's/^config briefing_morning_time_utc .*/config briefing_morning_time_utc 00:00/' "$REAL_CONF"
grep -q '^config closure_stop_local ' "$REAL_CONF" || fail "setup: closure_stop_local must remain for ceremony mode"

GATE_OUT="$(node "$GATE_JS" --conf "$REAL_CONF")"
echo "$GATE_OUT" | tr -d '\n ' | grep -q '"mode":"ceremony"' || fail "gate should report ceremony mode: $GATE_OUT"
echo "$GATE_OUT" | tr -d '\n ' | grep -q '"consultFixedMorningTrigger":false' || fail "gate must suppress fixed trigger: $GATE_OUT"
pass "gate reports ceremony mode and suppresses fixed morning"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coordinator\tcoordinator\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"

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

# Give the daemon several ticks; fixed-time path must stay silent.
for _ in $(seq 1 24); do
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

if [[ -f "$LOG_FILE" ]] && grep -q "briefing-generation-nudge-sent" "$LOG_FILE"; then
  fail "ceremony mode must not fire fixed morning nudge; log=$(grep briefing-generation "$LOG_FILE" || true)"
fi
pass "handoffd skipped fixed morning trigger under closure_stop_local"
echo "test_handoffd_closing_ceremony_gate_wiring: ALL CHECKS PASSED"
