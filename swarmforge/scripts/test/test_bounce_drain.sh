#!/usr/bin/env bash
# BL-069: graceful bounce drain gate. While a bounce-drain sentinel exists at
# the target root, ready_for_next_task.bb/ready_for_next_batch.bb must refuse
# to dequeue NEW inbox/new items (printing DRAINING, not a lying NO_TASK)
# while leaving already-in_process work (single file OR batch directory)
# completely unaffected, and leaving queued items untouched in inbox/new.
# Covers BL-069 graceful-bounce-01.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"
READY_BATCH="$SCRIPT_DIR/../ready_for_next_batch.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture: git repo with a coder worktree ──────────────────────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one

CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q -b coder "$CODER_WT"

mkdir -p "$ROOT/.swarmforge" \
         "$CODER_WT/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$CODER_WT/.swarmforge/handoffs/inbox/completed"

drop_handoff() {  # dir name recipient
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 00\ntype: git_handoff\ntask: demo-task\ncommit: 0123456789\n\nbody\n' \
    "$2" "$3" "$3" > "$1/00_$2.handoff"
}

# ── baseline: no sentinel means the normal NO_TASK path is untouched ────────
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"
[[ "$OUT" == "NO_TASK" ]] || fail "baseline: expected NO_TASK with no sentinel and empty inbox, got: $OUT"
pass "baseline: NO_TASK is unaffected when no drain sentinel exists"

# ── 01: DRAINING replaces NO_TASK once the sentinel exists ──────────────────
printf '{"bounceType":"swarm","startedAt":"2026-07-02T09:00:00Z","timeoutSeconds":900}' \
  > "$ROOT/.swarmforge/bounce-drain.json"

OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"
[[ "$OUT" == "DRAINING" ]] || fail "01: expected DRAINING while sentinel exists, got: $OUT"
pass "01: ready_for_next_task.bb reports DRAINING, not a lying NO_TASK, while draining"

OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_BATCH")"
[[ "$OUT" == "DRAINING" ]] || fail "01-batch: expected DRAINING while sentinel exists, got: $OUT"
pass "01-batch: ready_for_next_batch.bb reports DRAINING too"

# ── queued items stay untouched in inbox/new while draining ────────────────
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/new" "queued1" "coder"
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"
[[ "$OUT" == "DRAINING" ]] || fail "queued: expected DRAINING with a queued item present, got: $OUT"
[[ -f "$CODER_WT/.swarmforge/handoffs/inbox/new/00_queued1.handoff" ]] \
  || fail "queued: the queued handoff must remain untouched in inbox/new"
[[ -z "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/in_process" 2>/dev/null)" ]] \
  || fail "queued: nothing should have been dequeued into in_process while draining"
pass "queued: items in inbox/new stay durable and untouched while draining"
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/new/00_queued1.handoff"

# ── queued items stay untouched (batch variant) while draining ──────────────
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/new" "queued2" "coder"
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_BATCH")"
[[ "$OUT" == "DRAINING" ]] || fail "queued-batch: expected DRAINING with a queued item present, got: $OUT"
[[ -f "$CODER_WT/.swarmforge/handoffs/inbox/new/00_queued2.handoff" ]] \
  || fail "queued-batch: the queued handoff must remain untouched in inbox/new"
[[ -z "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/in_process" 2>/dev/null)" ]] \
  || fail "queued-batch: nothing should have been batched into in_process while draining"
pass "queued-batch: items in inbox/new stay durable and untouched while draining (batch helper)"
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/new/00_queued2.handoff"

# ── an already in_process single task is resumed normally despite draining ──
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/in_process" "inflight" "coder"
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"
grep -q "^TASK: " <<< "$OUT" || fail "in-process: expected the in-process task to resume despite draining, got: $OUT"
pass "in-process: an already in_process single task resumes normally while draining"
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/in_process/00_inflight.handoff"

# ── an already in_process BATCH is resumed normally despite draining ────────
BATCH_DIR="$CODER_WT/.swarmforge/handoffs/inbox/in_process/batch_20260702T090000_000001"
mkdir -p "$BATCH_DIR"
drop_handoff "$BATCH_DIR" "item1" "coder"
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_BATCH")"
grep -q "^BATCH: " <<< "$OUT" || fail "in-process-batch: expected the in-process batch to resume despite draining, got: $OUT"
pass "in-process-batch: an already in_process batch directory resumes normally while draining"
rm -rf "$BATCH_DIR"

# ── sentinel cleared: normal dequeue behavior returns ────────────────────────
rm -f "$ROOT/.swarmforge/bounce-drain.json"
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/new" "afterdrain" "coder"
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"
grep -q "^TASK: " <<< "$OUT" || fail "cleared: expected normal dequeue once the sentinel is gone, got: $OUT"
pass "cleared: clearing the sentinel restores normal dequeue behavior"

echo "ALL PASS"
