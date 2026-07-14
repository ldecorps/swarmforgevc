#!/usr/bin/env bash
# BL-316: handoffd.bb now also sweeps EVERY non-coordinator current-roster
# role for "just finished my involvement (a fresh inbox/completed/ entry)
# and is idle", generalizing BL-309's coordinator-only sweep. The DECISION
# logic itself is exhaustively covered by closing_context_clear_test_runner.bb
# (unchanged, fully reused); this test only proves the real daemon reaches
# and fires the NEW role-context-clear-sweep! against a real fixture (real
# per-role mailboxes, fake tmux so no real pane is ever touched).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON_PID=""
# Any exit path (including a failing assertion's `exit 1`) must stop the
# daemon FIRST, before removing $ROOT - deleting a still-running daemon's
# own working directory out from under it corrupts its next filesystem
# check in undefined ways (observed: a stray "stopped" a tick later with
# no real stop-file signal, chasing a phantom daemon crash instead of the
# actual assertion failure).
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

CODER_WT="$ROOT/.worktrees/coder"
CLEANER_WT="$ROOT/.worktrees/cleaner"
ARCHITECT_WT="$ROOT/.worktrees/architect"
HARDENER_WT="$ROOT/.worktrees/hardener"

mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/new" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/completed" \
  "$CODER_WT/.swarmforge/handoffs/inbox/new" "$CODER_WT/.swarmforge/handoffs/inbox/in_process" "$CODER_WT/.swarmforge/handoffs/inbox/completed" \
  "$CLEANER_WT/.swarmforge/handoffs/inbox/new" "$CLEANER_WT/.swarmforge/handoffs/inbox/in_process" "$CLEANER_WT/.swarmforge/handoffs/inbox/completed" \
  "$ARCHITECT_WT/.swarmforge/handoffs/inbox/new" "$ARCHITECT_WT/.swarmforge/handoffs/inbox/in_process" "$ARCHITECT_WT/.swarmforge/handoffs/inbox/completed" \
  "$HARDENER_WT/.swarmforge/handoffs/inbox/new" "$HARDENER_WT/.swarmforge/handoffs/inbox/in_process" "$HARDENER_WT/.swarmforge/handoffs/inbox/completed"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

# Roster: coordinator (master-resident, its OWN clear mechanism, unaffected
# by this ticket) + coder/architect/hardener (task) + cleaner (batch).
# "documenter"/"QA" are deliberately ABSENT from this roster entirely - the
# context-clear-all-roles-05 scenario ("a role absent from the current
# roster is never watched") needs no special-casing to verify: the sweep
# only ever iterates roles.tsv's own rows, so an absent role is trivially
# never touched (nothing to assert beyond "the sweep doesn't fail/mention it").
cat > "$ROOT/.swarmforge/roles.tsv" <<TSV
coordinator	master	$ROOT	swarmforge-coordinator	Coordinator	claude	task
coder	coder	$CODER_WT	swarmforge-coder	Coder	claude	task
cleaner	cleaner	$CLEANER_WT	swarmforge-cleaner	Cleaner	claude	batch
architect	architect	$ARCHITECT_WT	swarmforge-architect	Architect	claude	task
hardener	hardener	$HARDENER_WT	swarmforge-hardener	Hardener	claude	task
TSV

# Neutralize the unrelated briefing-generation sweep (already-generated
# today means morning-trigger-due? is false).
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

write_handoff() {
  local dir="$1" name="$2"
  printf 'from: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: t\ncommit: abc\ncompleted_at: %s\n\nbody\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/$name"
}

# ── context-clear-all-roles-01: coder just completed a task, is idle ─────
write_handoff "$CODER_WT/.swarmforge/handoffs/inbox/completed" "00_a.handoff"

# ── context-clear-all-roles-04: cleaner's WHOLE batch just landed ────────
mkdir -p "$CLEANER_WT/.swarmforge/handoffs/inbox/completed/batch_20260712T000000Z_1"
write_handoff "$CLEANER_WT/.swarmforge/handoffs/inbox/completed/batch_20260712T000000Z_1" "00_b.handoff"

# ── context-clear-all-roles-03: architect ALSO has a fresh completion, but
#     a PENDING inbox item - must never clear ────────────────────────────
write_handoff "$ARCHITECT_WT/.swarmforge/handoffs/inbox/completed" "00_c.handoff"
write_handoff "$ARCHITECT_WT/.swarmforge/handoffs/inbox/new" "00_pending.handoff"

# ── context-clear-all-roles-02: hardener ALSO has a fresh completion, but
#     an IN-PROCESS task - must never clear ──────────────────────────────
write_handoff "$HARDENER_WT/.swarmforge/handoffs/inbox/completed" "00_d.handoff"
write_handoff "$HARDENER_WT/.swarmforge/handoffs/inbox/in_process" "00_current.handoff"

# The coordinator's OWN inbox/completed/ also has a fresh entry - proves
# this new sweep does NOT touch the coordinator (it stays on its own
# dedicated backlog/done/-based mechanism, unchanged from BL-309).
write_handoff "$ROOT/.swarmforge/handoffs/coordinator/inbox/completed" "00_e.handoff"

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
# setsid: give the daemon its OWN session/process group, detached from this
# script's - immune to any signal that might otherwise propagate to it from
# whatever invoked this test script (a plain shell, or a subprocess-of-a-
# subprocess harness like Node's spawnSync), which was observed to
# occasionally stop the daemon after its very first tick under some
# invocation contexts.
env -u RESEND_API_KEY PATH="$FAKE_BIN:$PATH" setsid bb "$HANDOFFD" "$ROOT" &
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

wait_for_log "role-context-clear-fired coder" 30 \
  || fail "setup: coder's initial clear never fired within 30s; log: $(cat "$LOG_FILE" 2>/dev/null)"

# Let a couple more poll cycles run (poll-ms=1000) so the dedup marker has
# a real chance to (incorrectly) fire a second time if it were broken.
sleep 2.5

# ── 01: coder (idle, fresh completion) was cleared ───────────────────────
grep -q "role-context-clear-fired coder 00_a.handoff" "$LOG_FILE" \
  || fail "01: expected a clear fired for coder's completion; got: $(cat "$LOG_FILE" 2>/dev/null)"
pass "context-clear-all-roles-01: a non-coordinator role (coder) is cleared after finishing a task while idle"

grep -c "send-keys -t swarmforge-coder -l /clear" "$CALL_LOG" | grep -q '^1$' \
  || fail "01: expected exactly one /clear sent to coder's session, got: $(cat "$CALL_LOG" 2>/dev/null)"
grep -q "send-keys -t swarmforge-coder -l Re-read swarmforge/constitution.prompt" "$CALL_LOG" \
  || fail "01: expected the startup re-read instruction sent to coder's session"
CLEAR_LINE="$(grep -n "send-keys -t swarmforge-coder -l /clear" "$CALL_LOG" | head -1 | cut -d: -f1)"
REREAD_LINE="$(grep -n "send-keys -t swarmforge-coder -l Re-read swarmforge/constitution.prompt" "$CALL_LOG" | head -1 | cut -d: -f1)"
[[ "$CLEAR_LINE" -lt "$REREAD_LINE" ]] || fail "01: expected /clear before the startup re-read instruction"
pass "context-clear-all-roles-01: /clear was injected, then the startup re-read instruction immediately after"

# ── 04: cleaner (batch role, whole batch landed, idle) was cleared ───────
grep -q "role-context-clear-fired cleaner batch_20260712T000000Z_1" "$LOG_FILE" \
  || fail "04: expected a clear fired for cleaner's whole-batch completion; got: $(cat "$LOG_FILE" 2>/dev/null)"
pass "context-clear-all-roles-04: a batch role's trigger is its whole batch landing in inbox/completed/, not a per-item event"

# ── 03: architect (pending inbox item) was never cleared ─────────────────
grep -q "role-context-clear-fired architect" "$LOG_FILE" && fail "03: architect must NOT be cleared while holding a pending inbox item"
pass "context-clear-all-roles-03: no clear is injected for a role with a pending inbox item"

# ── 02: hardener (in-process task) was never cleared ──────────────────────
grep -q "role-context-clear-fired hardener" "$LOG_FILE" && fail "02: hardener must NOT be cleared while holding an in-process task"
pass "context-clear-all-roles-02: no clear is injected for a role holding an in-process task"

# ── coordinator is untouched by this new sweep (its own mechanism/marker
#     is separate and unchanged) ─────────────────────────────────────────
grep -q "role-context-clear-fired coordinator" "$LOG_FILE" && fail "expected the NEW sweep to never touch the coordinator (BL-309's own mechanism owns it)"
[[ -f "$ROOT/.swarmforge/role-context-clear.json" ]] || fail "expected the per-role marker file to exist"
grep -q '"coordinator"' "$ROOT/.swarmforge/role-context-clear.json" && fail "expected the coordinator to never appear in the new per-role marker"
pass "the coordinator stays on its own dedicated clear mechanism, untouched by the new generalized sweep"

# ── context-clear-all-roles-06: dedup - no second clear for the SAME
#     completion across multiple poll cycles ─────────────────────────────
FIRED_COUNT="$(grep -c "role-context-clear-fired coder 00_a.handoff" "$LOG_FILE")"
[[ "$FIRED_COUNT" == "1" ]] || fail "06: expected exactly one clear for coder's completion across multiple ticks, got $FIRED_COUNT"
pass "context-clear-all-roles-06: a clear already issued for a role's completion is not repeated across ticks"

# ── context-clear-all-roles-06 (continued): a LATER completion by the SAME
#     role clears again once idle ────────────────────────────────────────
write_handoff "$CODER_WT/.swarmforge/handoffs/inbox/completed" "01_new.handoff"
wait_for_log "role-context-clear-fired coder 01_new.handoff" 30 \
  || fail "06: expected a NEW completion by coder to clear again once idle; got: $(cat "$LOG_FILE" 2>/dev/null)"
pass "context-clear-all-roles-06: a later completion by the same role triggers a clear again once idle"

# ── the sweep itself never threw ──────────────────────────────────────────
grep -q "role-context-clear-sweep-error" "$LOG_FILE" && fail "the role-context-clear sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "the role-context-clear sweep ran without throwing"

echo "ALL PASS"
