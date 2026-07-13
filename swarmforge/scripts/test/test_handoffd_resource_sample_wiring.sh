#!/usr/bin/env bash
# BL-350 (BL-336 finding H1): handoffd.bb's consolidated poll loop now also
# sweeps for headless resource sampling, sharing the same cadence as every
# other *-sweep! (BL-222/BL-214/BL-258/BL-309/BL-316/BL-339/BL-353 above it).
# The SAMPLING logic itself (pid resolution, append, interval gating) is
# exhaustively covered by resourceTelemetry.test.js/sampleResourcesCli.test.js
# (unit + real-subprocess-with-fake-tmux fixtures, unchanged); this test only
# proves the real daemon reaches and fires resource-sample-sweep! against the
# compiled CLI's own path, with the right cwd, each poll cycle - same
# "stub the compiled JS entry point under the fixture root" technique
# test_handoffd_dead_letter_notify_wiring.sh already uses, so no real tmux
# pane/pid resolution is ever needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON_PID=""
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    mkdir -p "$ROOT/.swarmforge/daemon" 2>/dev/null || true
    touch "$ROOT/.swarmforge/daemon/stop" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"

SOCK="$ROOT/fake.sock"
touch "$SOCK"

mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/new" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/completed"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

cat > "$ROOT/.swarmforge/roles.tsv" <<TSV
coordinator	master	$ROOT	swarmforge-coordinator	Coordinator	claude	task
TSV

# Neutralize the unrelated briefing-generation sweep (already-generated
# today means morning-trigger-due? is false).
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

# Stub the compiled CLI resource-sample-sweep! shells to - proves the real
# path/cwd/invocation, never real tmux pid resolution.
mkdir -p "$ROOT/extension/out/tools"
cat > "$ROOT/extension/out/tools/sample-resources.js" <<'EOF'
const fs = require('fs');
const path = require('path');
fs.appendFileSync(path.join(process.cwd(), 'sample-resources-calls.log'), process.cwd() + '\n');
console.log('SAMPLED 0 role(s)');
EOF

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
  PATH="$FAKE_BIN:$PATH" setsid bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

wait_for_log() {
  local pattern="$1" timeout_s="$2" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$LOG_FILE" ]] && grep -q "$pattern" "$LOG_FILE" 2>/dev/null && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

wait_for_log "resource-sample " 30 \
  || fail "the resource-sample sweep never logged within 30s; log: $(cat "$LOG_FILE" 2>/dev/null)"

# ── the sweep reached the CLI with the daemon's own project-root as cwd ──
[[ -f "$ROOT/sample-resources-calls.log" ]] || fail "expected the stub CLI to have been invoked at all"
grep -qF "$ROOT" "$ROOT/sample-resources-calls.log" \
  || fail "expected the CLI to run with cwd=project-root, got: $(cat "$ROOT/sample-resources-calls.log")"
pass "resource-sample-sweep! shells to the compiled sample-resources.js CLI with cwd=project-root"

# ── the CLI's own stdout is surfaced into the daemon log verbatim ────────
grep -q 'resource-sample.*SAMPLED 0 role(s)' "$LOG_FILE" \
  || fail "expected the CLI's stdout surfaced in the daemon log; got: $(cat "$LOG_FILE")"
pass "the CLI's own result line is logged verbatim by the sweep"

# ── the sweep repeats on the shared chase-sweep cadence, not just once ────
sleep 6
CALL_COUNT="$(wc -l < "$ROOT/sample-resources-calls.log")"
[[ "$CALL_COUNT" -ge 2 ]] || fail "expected the sweep to fire on more than one poll cycle, got $CALL_COUNT calls"
pass "the resource-sample sweep shares the daemon's chase-sweep cadence, not a one-shot"

# ── the sweep never threw ──────────────────────────────────────────────────
grep -q "resource-sample-sweep-error" "$LOG_FILE" && fail "the resource-sample sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "the resource-sample sweep ran without throwing"

echo "ALL PASS"
