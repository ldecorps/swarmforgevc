#!/usr/bin/env bash
# BL-1422: a Work dispatch note leaves in_process only with evidence of
# work since its dequeue (a commit naming the ticket, or a git_handoff
# naming it) or an explicit --no-work reason - never silently, the way
# BL-1384 was blind-completed four times in one day by a role clearing a
# queue of chase notes with back-to-back done_with_current.sh calls.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

TASK_WT="$ROOT/.worktrees/taskrole"
git -C "$ROOT" worktree add -q -b taskrole "$TASK_WT"

mkdir -p "$TASK_WT/swarmforge/scripts"
cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$TASK_WT/swarmforge/scripts/"
# Stub ready_for_next so a completion cannot rotate/dequeue live roles.
cat > "$TASK_WT/swarmforge/scripts/ready_for_next_task.sh" <<'EOF'
#!/usr/bin/env zsh
echo "NO_TASK"
exit 0
EOF
chmod +x "$TASK_WT/swarmforge/scripts/"*.sh

DONE="$TASK_WT/swarmforge/scripts/done_with_current.sh"

mkdir -p "$ROOT/.swarmforge" "$TASK_WT/.swarmforge"
printf 'taskrole\ttaskrole\t%s\tswarmforge-taskrole\tTaskrole\tclaude\ttask\n' "$TASK_WT" \
  > "$ROOT/.swarmforge/roles.tsv"
cp "$ROOT/.swarmforge/roles.tsv" "$TASK_WT/.swarmforge/roles.tsv"

IN_PROCESS="$TASK_WT/.swarmforge/handoffs/inbox/in_process"
COMPLETED="$TASK_WT/.swarmforge/handoffs/inbox/completed"
SENT="$TASK_WT/.swarmforge/handoffs/sent"
OUTBOX="$TASK_WT/.swarmforge/handoffs/outbox"

# The role's git history accumulates across scenarios in this ONE fixture
# worktree (a real commit is never undone), so a fixed dequeued_at would let
# an EARLIER scenario's own "BL-9001: ..." commit satisfy a LATER
# scenario's evidence check. Each scenario instead captures its own
# dequeued_at fresh, strictly after every commit any prior scenario made -
# the 1s sleep guarantees that separation at git's own commit-time
# resolution (whole seconds).
fresh_dequeued_at() {
  sleep 1
  date -u +%Y-%m-%dT%H:%M:%SZ
}
DEQUEUED_AT="$(fresh_dequeued_at)"

reset_mailbox() {
  rm -rf "$IN_PROCESS" "$COMPLETED" "$SENT" "$OUTBOX"
  mkdir -p "$IN_PROCESS" "$COMPLETED" "$SENT" "$OUTBOX"
}

write_work_note() {
  local ticket="$1" dir="${2:-$IN_PROCESS}"
  printf 'id: x\nfrom: coordinator\nto: taskrole\nrecipient: taskrole\npriority: 10\ntype: note\nmessage: Work %s-some-slug: read file in backlog/active\ndequeued_at: %s\n\nWork %s-some-slug: read file in backlog/active\n' \
    "$ticket" "$DEQUEUED_AT" "$ticket" > "$dir/10_work.handoff"
}

write_chase_note() {
  local n="$1" sha="$2" dir="${3:-$IN_PROCESS}"
  printf 'id: x%s\nfrom: coordinator\nto: taskrole\nrecipient: taskrole\npriority: 10\ntype: note\nmessage: branch behind %s: dirty worktree - merge up\ndequeued_at: %s\n\nbranch behind %s: dirty worktree - merge up\n' \
    "$n" "$sha" "$DEQUEUED_AT" "$sha" > "$dir/10_chase_$(printf '%03d' "$n").handoff"
}

write_git_handoff() {
  printf 'id: x\nfrom: coordinator\nto: taskrole\nrecipient: taskrole\npriority: 00\ntype: git_handoff\nrole: coordinator\ntask: BL-9001-some-slug\ncommit: 0000000000\ndequeued_at: %s\n\nmerge_and_process coordinator 0000000000\n' \
    "$DEQUEUED_AT" > "$IN_PROCESS/00_handoff.handoff"
}

write_sent_handoff_for() {
  local ticket="$1" created_at="$2"
  printf 'id: y\nfrom: taskrole\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: taskrole\ntask: %s-some-slug\ncommit: 1111111111\ncreated_at: %s\n\nmerge_and_process taskrole 1111111111\n' \
    "$ticket" "$created_at" > "$SENT/50_sent.handoff"
}

write_outbox_handoff_for() {
  local ticket="$1" created_at="$2"
  printf 'id: z\nfrom: taskrole\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: taskrole\ntask: %s-some-slug\ncommit: 2222222222\ncreated_at: %s\n\nmerge_and_process taskrole 2222222222\n' \
    "$ticket" "$created_at" > "$OUTBOX/50_outbox.handoff"
}

run_done() {
  (cd "$TASK_WT" && SWARMFORGE_ROLE=taskrole "$DONE" "$@")
}

# ── 01: a Work note with no evidence since dequeue is refused ─────────────
DEQUEUED_AT="$(fresh_dequeued_at)"
reset_mailbox
write_work_note BL-9001
set +e
OUT="$(run_done 2>&1)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "01: expected non-zero, got 0; out=$OUT"
echo "$OUT" | grep -q 'WORK_NOT_EVIDENCED' || fail "01: expected WORK_NOT_EVIDENCED, got: $OUT"
echo "$OUT" | grep -q 'BL-9001' || fail "01: refusal must name BL-9001, got: $OUT"
[[ -f "$IN_PROCESS/10_work.handoff" ]] || fail "01: Work note must still be in_process"
! grep -q '^completed_at:' "$IN_PROCESS/10_work.handoff" || fail "01: completed_at must not be stamped"
[[ -z "$(find "$COMPLETED" -mindepth 1 2>/dev/null)" ]] || fail "01: nothing should have completed"
pass "01: a Work note with no evidence since dequeue is refused, stays in_process"

# ── 02a: a commit naming the ticket completes as today ────────────────────
DEQUEUED_AT="$(fresh_dequeued_at)"
reset_mailbox
write_work_note BL-9001
git -C "$TASK_WT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m "BL-9001: did the work"
OUT="$(run_done 2>&1)"
echo "$OUT" | grep -q 'COMPLETED:' || fail "02a: expected COMPLETED, got: $OUT"
[[ -f "$COMPLETED/10_work.handoff" ]] || fail "02a: expected the Work note in completed/"
grep -q '^completed_at:' "$COMPLETED/10_work.handoff" || fail "02a: completed_at not stamped"
! grep -q '^no_work_reason:' "$COMPLETED/10_work.handoff" || fail "02a: no_work_reason must not appear on a real completion"
pass "02a: a commit naming the ticket since dequeue completes the Work note as today"

# ── 02b: a git_handoff naming the ticket (sent/) completes as today ───────
DEQUEUED_AT="$(fresh_dequeued_at)"
reset_mailbox
write_work_note BL-9001
sleep 1
write_sent_handoff_for BL-9001 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="$(run_done 2>&1)"
echo "$OUT" | grep -q 'COMPLETED:' || fail "02b: expected COMPLETED, got: $OUT"
[[ -f "$COMPLETED/10_work.handoff" ]] || fail "02b: expected the Work note in completed/"
pass "02b: a git_handoff naming the ticket since dequeue completes the Work note as today"

# ── 02c: a git_handoff naming the ticket, still in outbox/ (not yet moved
#    to sent/ by handoffd's delivery sweep), ALSO completes as today - the
#    ticket's own direction says "outbox/sent", and handoffd.bb's deliver!
#    only moves a file to sent/ AFTER real delivery, so a role that just
#    sent its parcel and completes within that window must not be
#    false-refused. ──────────────────────────────────────────────────────
DEQUEUED_AT="$(fresh_dequeued_at)"
reset_mailbox
write_work_note BL-9001
sleep 1
write_outbox_handoff_for BL-9001 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="$(run_done 2>&1)"
echo "$OUT" | grep -q 'COMPLETED:' || fail "02c: expected COMPLETED, got: $OUT"
[[ -f "$COMPLETED/10_work.handoff" ]] || fail "02c: expected the Work note in completed/"
pass "02c: a git_handoff naming the ticket still pending in outbox/ also completes the Work note as today"

# ── 03: --no-work records the reason on the completed file ────────────────
DEQUEUED_AT="$(fresh_dequeued_at)"
reset_mailbox
write_work_note BL-9001
OUT="$(run_done --no-work "waiting on BL-9000" 2>&1)"
echo "$OUT" | grep -q 'COMPLETED:' || fail "03: expected COMPLETED, got: $OUT"
grep -q '^no_work_reason: waiting on BL-9000$' "$COMPLETED/10_work.handoff" \
  || fail "03: expected no_work_reason on the completed file: $(cat "$COMPLETED/10_work.handoff")"
grep -q '^no_work_at:' "$COMPLETED/10_work.handoff" || fail "03: expected no_work_at on the completed file"
pass "03: --no-work \"<reason>\" completes the Work note and records the reason"

# ── 03b: --no-work with a blank reason is refused (BL-652 family contract) ─
DEQUEUED_AT="$(fresh_dequeued_at)"
reset_mailbox
write_work_note BL-9001
set +e
OUT="$(run_done --no-work "" 2>&1)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "03b: expected non-zero for a blank --no-work reason, got 0"
[[ -f "$IN_PROCESS/10_work.handoff" ]] || fail "03b: Work note must still be in_process"
pass "03b: a blank --no-work reason is refused like any other bad argv"

# ── 04a: a non-Work note (chase) completes exactly as today, no gate ──────
reset_mailbox
write_chase_note 1 abc1234567
OUT="$(run_done 2>&1)"
echo "$OUT" | grep -q 'COMPLETED:' || fail "04a: expected COMPLETED, got: $OUT"
pass "04a: a non-Work note completes exactly as today"

# ── 04b: a git_handoff item completes exactly as today, no gate ───────────
reset_mailbox
write_git_handoff
OUT="$(run_done 2>&1)"
echo "$OUT" | grep -q 'COMPLETED:' || fail "04b: expected COMPLETED, got: $OUT"
pass "04b: a git_handoff completes exactly as today"

# ── 05: a burst over 28 chase notes plus a Work note stops at the Work note ─
# done_with_current_task.bb requires exactly ONE file in in_process/ at a
# time (AMBIGUOUS_TASK_STATE otherwise) - the real queue helper moves the
# next item from inbox/new/ into in_process/ one at a time, which the
# stubbed ready_for_next_task.sh above deliberately no-ops (so a completion
# cannot rotate live roles). This scenario reproduces exactly that one-at-
# a-time claim step itself, in dequeue (filename) order, so each
# done_with_current.sh call sees exactly one current task, same as live.
DEQUEUED_AT="$(fresh_dequeued_at)"
reset_mailbox
QUEUE_DIR="$(mktemp -d)"
for i in $(seq 1 28); do
  write_chase_note "$i" "$(printf 'sha%07d' "$i")" "$QUEUE_DIR"
done
write_work_note BL-9001 "$QUEUE_DIR"
COMPLETED_COUNT=0
for QUEUED in "$QUEUE_DIR"/*.handoff; do
  cp "$QUEUED" "$IN_PROCESS/$(basename "$QUEUED")"
  set +e
  OUT="$(run_done 2>&1)"
  STATUS=$?
  set -e
  if [[ "$STATUS" -ne 0 ]]; then
    echo "$OUT" | grep -q 'WORK_NOT_EVIDENCED' || fail "05: expected the burst to stop with WORK_NOT_EVIDENCED, got: $OUT"
    break
  fi
  COMPLETED_COUNT=$((COMPLETED_COUNT + 1))
done
rm -rf "$QUEUE_DIR"
[[ "$COMPLETED_COUNT" -eq 28 ]] || fail "05: expected exactly 28 chase notes completed before the stop, got $COMPLETED_COUNT"
[[ -f "$IN_PROCESS/10_work.handoff" ]] || fail "05: the Work note must still be in_process after the burst stops"
[[ "$(find "$COMPLETED" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')" -eq 28 ]] \
  || fail "05: expected exactly 28 completed files"
pass "05: a burst over 28 chase notes plus a Work note completes the chase notes and stops at the Work note"

echo "ALL PASS: done_with_current Work-note evidence gate (BL-1422)"
