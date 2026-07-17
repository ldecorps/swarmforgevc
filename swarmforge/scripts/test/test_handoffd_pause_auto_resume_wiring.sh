#!/usr/bin/env bash
# BL-423: handoffd.bb's consolidated poll loop now also sweeps for an
# EXPIRED timed pause, sharing the same cadence as every other *-sweep!
# (BL-222/BL-214/BL-258/BL-309/BL-316/BL-339/BL-353/BL-350/BL-356/BL-437/
# BL-440 above). The auto-resume decision itself is exhaustively covered
# by resumeExpiredPausesCli.test.js (unit tests against a real fixture);
# this test only proves the real daemon reaches and fires
# pause-auto-resume-sweep! against the compiled CLI's own path, with the
# right cwd, each poll cycle - same "stub the compiled JS entry point
# under the fixture root" technique test_handoffd_answer_file_drain_wiring.sh
# already uses, so no real pause marker/Telegram fixture is ever needed here.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
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

# Stub the compiled CLI pause-auto-resume-sweep! shells to - proves the
# real path/cwd/invocation, never a real pause-marker/Telegram fixture.
mkdir -p "$ROOT/extension/out/tools"
cat > "$ROOT/extension/out/tools/resume-expired-pauses.js" <<'EOF'
const fs = require('fs');
const path = require('path');
fs.appendFileSync(path.join(process.cwd(), 'resume-expired-pauses-calls.log'), process.cwd() + '\n');
console.log(JSON.stringify({ resumed: false, reason: 'not-due' }));
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

wait_for_log "pause-auto-resume " 30 \
  || fail "the pause-auto-resume sweep never logged within 30s; log: $(cat "$LOG_FILE" 2>/dev/null)"

# ── the sweep reached the CLI with the daemon's own project-root as cwd ──
[[ -f "$ROOT/resume-expired-pauses-calls.log" ]] || fail "expected the stub CLI to have been invoked at all"
grep -qF "$ROOT" "$ROOT/resume-expired-pauses-calls.log" \
  || fail "expected the CLI to run with cwd=project-root, got: $(cat "$ROOT/resume-expired-pauses-calls.log")"
pass "pause-auto-resume-sweep! shells to the compiled resume-expired-pauses.js CLI with cwd=project-root"

# ── the CLI's own stdout is surfaced into the daemon log verbatim ────────
grep -q 'pause-auto-resume {"resumed":false,"reason":"not-due"}' "$LOG_FILE" \
  || fail "expected the CLI's stdout surfaced in the daemon log; got: $(cat "$LOG_FILE")"
pass "the CLI's own result is logged verbatim by the sweep"

# ── the sweep repeats on the shared chase-sweep cadence, not just once ────
sleep 6
CALL_COUNT="$(wc -l < "$ROOT/resume-expired-pauses-calls.log")"
[[ "$CALL_COUNT" -ge 2 ]] || fail "expected the sweep to fire on more than one poll cycle, got $CALL_COUNT calls"
pass "the pause-auto-resume sweep shares the daemon's chase-sweep cadence, not a one-shot"

# ── the sweep never threw ──────────────────────────────────────────────────
grep -q "pause-auto-resume-sweep-error" "$LOG_FILE" && fail "the pause-auto-resume sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "the pause-auto-resume sweep ran without throwing"

# ── phase 2: a failing CLI is logged as an error, not swallowed, and the
# sweep keeps firing on the next cycle rather than taking the daemon down
# with it (the (catch Exception e ...) / nonzero-exit branch in
# pause-auto-resume-sweep! is otherwise never exercised by any test) ──────
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true
DAEMON_PID=""

rm -f "$LOG_FILE" "$ROOT/resume-expired-pauses-calls.log"
cat > "$ROOT/extension/out/tools/resume-expired-pauses.js" <<'EOF'
const fs = require('fs');
const path = require('path');
fs.appendFileSync(path.join(process.cwd(), 'resume-expired-pauses-calls.log'), process.cwd() + '\n');
console.error('boom: cannot resolve project root');
process.exit(1);
EOF

env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
  PATH="$FAKE_BIN:$PATH" setsid bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

wait_for_log "pause-auto-resume-sweep-error" 30 \
  || fail "expected a failing CLI to log pause-auto-resume-sweep-error; log: $(cat "$LOG_FILE" 2>/dev/null)"
grep -q "pause-auto-resume-sweep-error.*exit=1" "$LOG_FILE" \
  || fail "expected the logged error to name the nonzero exit code; got: $(cat "$LOG_FILE")"
grep -q "boom: cannot resolve project root" "$LOG_FILE" \
  || fail "expected the CLI's own stderr surfaced in the logged error; got: $(cat "$LOG_FILE")"
pass "a failing CLI's exit code and stderr are surfaced via pause-auto-resume-sweep-error, not swallowed"

sleep 6
FAIL_CALL_COUNT="$(wc -l < "$ROOT/resume-expired-pauses-calls.log")"
[[ "$FAIL_CALL_COUNT" -ge 2 ]] || fail "expected the sweep to keep firing on later cycles after a failure, got $FAIL_CALL_COUNT calls"
pass "the daemon survives a failing sweep and keeps firing it on the shared cadence"

echo "ALL PASS"
