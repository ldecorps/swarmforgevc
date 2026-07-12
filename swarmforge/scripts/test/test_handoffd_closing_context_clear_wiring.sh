#!/usr/bin/env bash
# BL-309: handoffd.bb now also sweeps for "the coordinator just finished a
# ticket's bookkeeping close and is idle" and, when so, injects /clear into
# the coordinator's real tmux pane immediately followed by the startup
# re-read instruction. The DECISION logic itself is exhaustively covered by
# closing_context_clear_test_runner.bb's fake-adapter assertions; this test
# only proves the real daemon reaches and fires the sweep against a real
# fixture (real master-resident coordinator mailbox, real backlog/done/,
# fake tmux so no real pane is ever touched).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/new" "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
# Master-resident coordinator: worktree-name "master", worktree-path == ROOT
# (same physical checkout), matching handoff-protocol.md's mailbox split.
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"

printf 'id: BL-401\nstatus: done\n' > "$ROOT/backlog/done/BL-401.yaml"

# Neutralize the (unrelated) briefing-generation sweep regardless of real
# time-of-day when this test happens to run - already-generated today means
# morning-trigger-due? is false, so it never touches tmux itself.
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

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
  [[ -f "$LOG_FILE" ]] && grep -q "closing-context-clear-fired" "$LOG_FILE" 2>/dev/null && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

# ── 01: the real daemon fired the closing-context-clear sweep and logged it ─
grep -q "closing-context-clear-fired BL-401" "$LOG_FILE" || fail "01: expected the daemon to fire and log a clear for BL-401; got: $(cat "$LOG_FILE" 2>/dev/null)"
pass "01: the consolidated daemon fired the closing-context-clear sweep for BL-401"

# ── 02: /clear was sent to the coordinator's own tmux session, then the
#     startup re-read instruction immediately after (in that order) ────────
grep -c "send-keys -t swarmforge-coordinator -l /clear" "$CALL_LOG" | grep -q '^1$' \
  || fail "02: expected exactly one /clear literal sent to the coordinator's session, got: $(cat "$CALL_LOG" 2>/dev/null)"
grep -q "send-keys -t swarmforge-coordinator -l Re-read swarmforge/constitution.prompt" "$CALL_LOG" \
  || fail "02: expected the startup re-read instruction sent to the coordinator's session"
CLEAR_LINE="$(grep -n "send-keys -t swarmforge-coordinator -l /clear" "$CALL_LOG" | head -1 | cut -d: -f1)"
REREAD_LINE="$(grep -n "send-keys -t swarmforge-coordinator -l Re-read swarmforge/constitution.prompt" "$CALL_LOG" | head -1 | cut -d: -f1)"
[[ "$CLEAR_LINE" -lt "$REREAD_LINE" ]] || fail "02: expected /clear to be sent BEFORE the startup re-read instruction"
pass "02: /clear was injected, then the startup re-read instruction immediately after"

# ── 03: the marker records the cleared ticket, so a restart never re-clears ──
grep -q '"last_cleared_ticket_id":"BL-401"' "$ROOT/.swarmforge/coordinator-context-clear.json" \
  || fail "03: expected the marker to record BL-401 as the cleared ticket, got: $(cat "$ROOT/.swarmforge/coordinator-context-clear.json" 2>/dev/null)"
pass "03: the durable marker recorded BL-401 as cleared"

# ── 04: the sweep itself never threw ─────────────────────────────────────
grep -q "closing-context-clear-sweep-error" "$LOG_FILE" && fail "04: the closing-context-clear sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "04: the closing-context-clear sweep ran without throwing"

# ── 05: BL-309 bounce regression - SWARMFORGE_MAILBOX_ONLY=1 must never
#     record a clear when nothing was actually injected (QA repro, fixed by
#     skipping the WHOLE sweep, not just the individual tmux calls, while
#     tmux injection is disabled) ────────────────────────────────────────
ROOT2="$(cd "$(mktemp -d)" && pwd -P)"
SOCK2="$ROOT2/fake.sock"
touch "$SOCK2"
mkdir -p "$ROOT2/.swarmforge" "$ROOT2/.swarmforge/handoffs/inbox/new" "$ROOT2/docs/briefings" \
  "$ROOT2/backlog/active" "$ROOT2/backlog/paused" "$ROOT2/backlog/done" \
  "$ROOT2/.swarmforge/handoffs/coordinator/inbox/new" "$ROOT2/.swarmforge/handoffs/coordinator/inbox/in_process"
echo "$SOCK2" > "$ROOT2/.swarmforge/tmux-socket"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT2" > "$ROOT2/.swarmforge/roles.tsv"
printf 'id: BL-401\nstatus: done\n' > "$ROOT2/backlog/done/BL-401.yaml"
printf 'Headline: unrelated\n' > "$ROOT2/docs/briefings/${TODAY_DAY_KEY}.md"
FAKE_BIN2="$ROOT2/bin"
mkdir -p "$FAKE_BIN2"
CALL_LOG2="$ROOT2/tmux-calls.log"
cat > "$FAKE_BIN2/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "$CALL_LOG2"
exit 0
TMUX
chmod +x "$FAKE_BIN2/tmux"

LOG_FILE2="$ROOT2/.swarmforge/daemon/handoffd.log"
env -u RESEND_API_KEY SWARMFORGE_MAILBOX_ONLY=1 PATH="$FAKE_BIN2:$PATH" bb "$HANDOFFD" "$ROOT2" &
DAEMON_PID2=$!

for _ in $(seq 1 40); do
  [[ -f "$LOG_FILE2" ]] && grep -q "closing-context-clear-skip-mailbox-only" "$LOG_FILE2" 2>/dev/null && break
  sleep 0.25
done
mkdir -p "$ROOT2/.swarmforge/daemon"
touch "$ROOT2/.swarmforge/daemon/stop"
wait "$DAEMON_PID2" 2>/dev/null || true

grep -q "closing-context-clear-skip-mailbox-only" "$LOG_FILE2" || fail "05: expected the sweep to log a mailbox-only skip; got: $(cat "$LOG_FILE2" 2>/dev/null)"
grep -q "closing-context-clear-fired" "$LOG_FILE2" && fail "05: expected NO clear to be recorded under SWARMFORGE_MAILBOX_ONLY=1; got: $(cat "$LOG_FILE2")"
[[ -f "$ROOT2/.swarmforge/coordinator-context-clear.json" ]] && fail "05: expected the marker to NEVER be written when nothing was actually injected"
pass "05: SWARMFORGE_MAILBOX_ONLY=1 skips the whole sweep - no clear recorded when nothing was injected"

rm -rf "$ROOT2"

echo "ALL PASS"
