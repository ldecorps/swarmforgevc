#!/usr/bin/env bash
# BL-897: handoffd.bb now also ensures the shared lifecycle snapshot is
# fresh before the briefing sweeps below it run, sharing the same cadence
# as chase-sweep!/dispatch-gap-sweep! (ensure-lifecycle-snapshot!). The
# snapshot's own read/write/freshness contract is exhaustively covered by
# lifecycleSnapshot.test.js/lifecycleSnapshot.property.test.js and
# emitLifecycleSnapshotCli.test.js; this test only proves the real daemon
# actually reaches and fires the sweep against the compiled CLI's own path,
# with the right cwd, each poll cycle - same "stub the compiled JS entry
# point under the fixture root" technique
# test_handoffd_resource_sample_wiring.sh already uses, so no real git
# history walk or tmux pane is ever needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
source "$SCRIPT_DIR/../portable_daemon_spawn_lib.sh"

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

SOCK="$ROOT/fake.sock"
touch "$SOCK"

mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coordinator\tcoordinator\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
# Deliberately no docs/briefings/<today>.md fixture file - briefing-email-
# sweep! then finds no unsent briefing to send, so it never reaches (and
# this test never needs to stub) briefing-digest-line.js/
# render-briefing-burndown.js, the two OTHER --snapshot-taking CLIs.

# Stub the compiled CLI ensure-lifecycle-snapshot! shells to - proves the
# real path/cwd/invocation, never a real git history walk.
mkdir -p "$ROOT/extension/out/tools"
cat > "$ROOT/extension/out/tools/emit-lifecycle-snapshot.js" <<'EOF'
const fs = require('fs');
const path = require('path');
fs.appendFileSync(path.join(process.cwd(), 'emit-lifecycle-snapshot-calls.log'), process.cwd() + '\n');
console.log(JSON.stringify({ path: path.join(process.cwd(), '.swarmforge', 'briefing', 'lifecycle-snapshot.json'), walked: true }));
EOF

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
portable_spawn_daemon_or_fail bb \
  env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
  PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT"
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

wait_for_count() {
  local file="$1" min_count="$2" timeout_s="$3" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$file" ]] && [[ "$(wc -l < "$file")" -ge "$min_count" ]] && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

wait_for_log "lifecycle-snapshot-ensured" 30 \
  || fail "the lifecycle-snapshot-ensure sweep never logged within 30s; log: $(cat "$LOG_FILE" 2>/dev/null)"

# ── 01: the real daemon reached the CLI with the daemon's own project-root as cwd ─
[[ -f "$ROOT/emit-lifecycle-snapshot-calls.log" ]] || fail "01: expected the stub CLI to have been invoked at all"
grep -qF "$ROOT" "$ROOT/emit-lifecycle-snapshot-calls.log" \
  || fail "01: expected the CLI to run with cwd=project-root, got: $(cat "$ROOT/emit-lifecycle-snapshot-calls.log")"
pass "01: ensure-lifecycle-snapshot! shells to the compiled emit-lifecycle-snapshot.js CLI with cwd=project-root"

# ── 02: the CLI's own stdout is surfaced into the daemon log verbatim ────
grep -q 'lifecycle-snapshot-ensured.*"walked":true' "$LOG_FILE" \
  || fail "02: expected the CLI's stdout surfaced in the daemon log; got: $(cat "$LOG_FILE")"
pass "02: the CLI's own result line is logged verbatim by the sweep"

# ── 03: the sweep repeats on the shared chase-sweep cadence, not just once ─
wait_for_count "$ROOT/emit-lifecycle-snapshot-calls.log" 2 25 \
  || fail "03: expected the sweep to fire on more than one poll cycle within 25s, got $(wc -l < "$ROOT/emit-lifecycle-snapshot-calls.log" 2>/dev/null || echo 0) calls"
pass "03: the lifecycle-snapshot-ensure sweep shares the daemon's chase-sweep cadence, not a one-shot"

# ── 04: the sweep never threw ─────────────────────────────────────────────
grep -q "ensure-lifecycle-snapshot-error" "$LOG_FILE" && fail "04: the lifecycle-snapshot-ensure sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "04: the lifecycle-snapshot-ensure sweep ran without throwing"

echo "ALL PASS"
