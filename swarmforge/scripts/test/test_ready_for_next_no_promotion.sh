#!/usr/bin/env bash
# BL-226: ready_for_next.bb's promote-next-paused-item-if-needed (and its
# post-dispatch call) is dead code - run-dispatch! always execs the mode's
# helper (process/exec, replaces the process image) or exits (System/exit),
# so nothing after it ever ran - and does not belong in a receive helper at
# all (promotion is the coordinator's exclusive duty, constitution Articles
# 1.1/3.3). This test covers the removal directly against the real script:
# a grep guard that the symbol is gone, that dispatch itself is unchanged
# for both receive modes (BL-226 dispatch-unchanged-01), and that no paused
# item is ever moved into backlog/active/ by this helper (BL-226
# no-helper-promotion-02).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
READY_DISPATCH="$SCRIPT_DIR/../ready_for_next.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── symbol removed ────────────────────────────────────────────────────────
grep -q "promote-next-paused-item-if-needed" "$READY_DISPATCH" \
  && fail "grep-guard: promote-next-paused-item-if-needed must no longer appear in ready_for_next.bb"
pass "grep-guard: promote-next-paused-item-if-needed is gone from ready_for_next.bb"

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

TASK_WT="$ROOT/.worktrees/taskrole"
BATCH_WT="$ROOT/.worktrees/batchrole"
git -C "$ROOT" worktree add -q -b taskrole "$TASK_WT"
git -C "$ROOT" worktree add -q -b batchrole "$BATCH_WT"

ROLES="taskrole\ttaskrole\t$TASK_WT\tswarmforge-taskrole\tTaskrole\tclaude\ttask
batchrole\tbatchrole\t$BATCH_WT\tswarmforge-batchrole\tBatchrole\tclaude\tbatch
"
mkdir -p "$ROOT/.swarmforge" "$TASK_WT/.swarmforge" "$BATCH_WT/.swarmforge"
printf "$ROLES" > "$ROOT/.swarmforge/roles.tsv"
printf "$ROLES" > "$TASK_WT/.swarmforge/roles.tsv"
printf "$ROLES" > "$BATCH_WT/.swarmforge/roles.tsv"

queue_inbox_task() {
  local inbox_new="$1" name="$2" recipient="$3"
  mkdir -p "$inbox_new"
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 50\ntype: git_handoff\ntask: BL-226-dispatch-test\ncommit: %s\n\npayload for %s\n' \
    "$name" "$recipient" "$recipient" "$COMMIT" "$name" > "$inbox_new/50_${name}.handoff"
}

# ── dispatch-unchanged-01 (Scenario Outline: task, batch) ────────────────
TASK_INBOX="$TASK_WT/.swarmforge/handoffs/inbox"
queue_inbox_task "$TASK_INBOX/new" "item1" "taskrole"
OUT="$(cd "$TASK_WT" && SWARMFORGE_ROLE=taskrole bb "$READY_DISPATCH")"
echo "$OUT" | grep -q "^TASK:" || fail "dispatch-unchanged-01 (task): expected the task-mode helper's own output (got: $OUT)"
pass "dispatch-unchanged-01: task-mode role still execs ready_for_next_task.sh"

BATCH_INBOX="$BATCH_WT/.swarmforge/handoffs/inbox"
queue_inbox_task "$BATCH_INBOX/new" "item2" "batchrole"
OUT="$(cd "$BATCH_WT" && SWARMFORGE_ROLE=batchrole bb "$READY_DISPATCH")"
echo "$OUT" | grep -q '^BATCH:' || fail "dispatch-unchanged-01 (batch): expected the batch-mode helper's own output (got: $OUT)"
pass "dispatch-unchanged-01: batch-mode role still execs ready_for_next_batch.sh"

# ── no-helper-promotion-02 ────────────────────────────────────────────────
# A paused item, active/ well below any depth cap, then a normal dispatch -
# the paused item must still be sitting untouched in backlog/paused/
# afterward; nothing in this helper ever moves it.
mkdir -p "$TASK_WT/backlog/active" "$TASK_WT/backlog/paused" "$TASK_WT/swarmforge"
printf 'id: BL-9001\ntitle: "demo"\nstatus: paused\n' > "$TASK_WT/backlog/paused/BL-9001-demo.yaml"
printf 'config active_backlog_max_depth 10\n' > "$TASK_WT/swarmforge/swarmforge.conf"
queue_inbox_task "$TASK_INBOX/new" "item3" "taskrole"
(cd "$TASK_WT" && SWARMFORGE_ROLE=taskrole bb "$READY_DISPATCH" >/dev/null)

[[ -f "$TASK_WT/backlog/paused/BL-9001-demo.yaml" ]] \
  || fail "no-helper-promotion-02: the paused item must not have been moved out of backlog/paused/"
[[ ! -e "$TASK_WT/backlog/active/BL-9001-demo.yaml" ]] \
  || fail "no-helper-promotion-02: the paused item must not have appeared in backlog/active/"
pass "no-helper-promotion-02: ready_for_next moves no paused item into active/ (below-depth-cap fixture)"

echo "ALL PASS"
