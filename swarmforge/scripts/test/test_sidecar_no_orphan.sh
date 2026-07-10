#!/usr/bin/env bash
# BL-232: a chase/nudge sidecar (.chase.json/.nudge) must never outlive its
# parent .handoff's presence in an inbox/new/ directory. Two mechanisms:
#   1. Dequeue (ready_for_next_task.bb/ready_for_next_batch.bb) drops any
#      sidecar left behind at the handoff's now-stale new/ location, reusing
#      handoff-lib/remove-sidecars-of! (no second copy of the suffix list).
#   2. The sweep (chase_sweep_lib.bb's reap-orphaned-sidecars!, wired into
#      sweep-role-inbox!) reaps a sidecar whose parent .handoff is already
#      gone from new/ - the backstop for anything that slips past dequeue
#      (e.g. a stray sidecar left over from a mailbox-layout migration).
# A non-sidecar file is never touched by either path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWEEP_RUNNER="$SCRIPT_DIR/chase_sweep_test_runner.bb"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"
READY_BATCH="$SCRIPT_DIR/../ready_for_next_batch.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

write_handoff() {
  local path="$1" recipient="${2:-taskrole}"
  printf 'id: t\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' \
    "$recipient" "$recipient" > "$path"
}

# ── dequeue fixture: a real git worktree + roles.tsv, mirroring
# test_ready_for_next_no_promotion.sh's own convention ──────────────────
make_dequeue_fixture() {
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  git -C "$ROOT" init -q
  git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

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

  TASK_NEW="$TASK_WT/.swarmforge/handoffs/inbox/new"
  TASK_IN_PROCESS="$TASK_WT/.swarmforge/handoffs/inbox/in_process"
  BATCH_NEW="$BATCH_WT/.swarmforge/handoffs/inbox/new"
  BATCH_IN_PROCESS="$BATCH_WT/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$TASK_NEW" "$TASK_IN_PROCESS" "$BATCH_NEW" "$BATCH_IN_PROCESS"
}

cleanup_dequeue_fixture() { rm -rf "$ROOT"; }

# ── sidecar-not-orphaned-on-dequeue-01 (Scenario Outline: task/.chase.json,
# task/.nudge, batch/.chase.json) ────────────────────────────────────────

make_dequeue_fixture
write_handoff "$TASK_NEW/50_item.handoff"
echo '{"chaseCount":1}' > "$TASK_NEW/50_item.handoff.chase.json"
(cd "$TASK_WT" && SWARMFORGE_ROLE=taskrole bb "$READY_TASK" >/dev/null)
[[ -f "$TASK_IN_PROCESS/50_item.handoff" ]] || fail "01 (task/.chase.json): handoff was not dequeued to in_process/"
[[ ! -e "$TASK_NEW/50_item.handoff" ]] || fail "01 (task/.chase.json): handoff still present in new/"
[[ ! -e "$TASK_NEW/50_item.handoff.chase.json" ]] || fail "01 (task/.chase.json): sidecar orphaned in new/ after dequeue"
pass "01: task-mode dequeue drops the .chase.json sidecar, no orphan left in new/"
cleanup_dequeue_fixture

make_dequeue_fixture
write_handoff "$TASK_NEW/50_item.handoff"
echo '{"nudgeCount":2}' > "$TASK_NEW/50_item.handoff.nudge"
(cd "$TASK_WT" && SWARMFORGE_ROLE=taskrole bb "$READY_TASK" >/dev/null)
[[ -f "$TASK_IN_PROCESS/50_item.handoff" ]] || fail "01 (task/.nudge): handoff was not dequeued to in_process/"
[[ ! -e "$TASK_NEW/50_item.handoff.nudge" ]] || fail "01 (task/.nudge): sidecar orphaned in new/ after dequeue"
pass "01: task-mode dequeue drops the .nudge sidecar, no orphan left in new/"
cleanup_dequeue_fixture

make_dequeue_fixture
write_handoff "$BATCH_NEW/50_item.handoff" "batchrole"
echo '{"chaseCount":1}' > "$BATCH_NEW/50_item.handoff.chase.json"
(cd "$BATCH_WT" && SWARMFORGE_ROLE=batchrole bb "$READY_BATCH" >/dev/null)
BATCH_DIR="$(find "$BATCH_IN_PROCESS" -maxdepth 1 -type d -name 'batch_*' | head -1)"
[[ -n "$BATCH_DIR" && -f "$BATCH_DIR/50_item.handoff" ]] || fail "01 (batch/.chase.json): handoff was not dequeued into a batch dir"
[[ ! -e "$BATCH_NEW/50_item.handoff.chase.json" ]] || fail "01 (batch/.chase.json): sidecar orphaned in new/ after batch dequeue"
pass "01: batch-mode dequeue drops the .chase.json sidecar, no orphan left in new/"
cleanup_dequeue_fixture

# ── non-sidecar-file-untouched-04 (dequeue half) ─────────────────────────
make_dequeue_fixture
write_handoff "$TASK_NEW/50_item.handoff"
echo 'just some notes' > "$TASK_NEW/notes.txt"
(cd "$TASK_WT" && SWARMFORGE_ROLE=taskrole bb "$READY_TASK" >/dev/null)
[[ -f "$TASK_NEW/notes.txt" ]] || fail "04 (dequeue): a non-sidecar file must never be removed by dequeue"
pass "04 (dequeue): dequeue leaves a non-sidecar file untouched and does not error on its presence"
cleanup_dequeue_fixture

# ── sweep fixture: chase_sweep_test_runner.bb's own inbox/new + inbox/in_process
# layout (mirrors test_chase_sweep.sh's make_fixture) ────────────────────
make_sweep_fixture() {
  SROOT="$(mktemp -d)"
  mkdir -p "$SROOT/inbox/new" "$SROOT/inbox/in_process"
}

NOW_MS=$((1751500000 * 1000))
CHASE_TIMEOUT_S=30
STUCK_TIMEOUT_S=60
MAX_CHASES=3

run_sweep() {
  CHASE_TIMEOUT_SECONDS="$CHASE_TIMEOUT_S" STUCK_TIMEOUT_SECONDS="$STUCK_TIMEOUT_S" MAX_CHASES="$MAX_CHASES" \
    bb "$SWEEP_RUNNER" "$SROOT" "$NOW_MS" "$1" "$2"
}

# ── orphaned-sidecar-reaped-02 (Scenario Outline: .chase.json, .nudge) ──
make_sweep_fixture
echo '{"chaseCount":1}' > "$SROOT/inbox/new/00_gone.handoff.chase.json"
run_sweep "alive" "$NOW_MS" >/dev/null
[[ ! -e "$SROOT/inbox/new/00_gone.handoff.chase.json" ]] || fail "02 (.chase.json): orphaned sidecar survived the sweep"
pass "02: an orphaned .chase.json sidecar (no matching .handoff) is reaped on the sweep"
rm -rf "$SROOT"

make_sweep_fixture
echo '{"nudgeCount":1}' > "$SROOT/inbox/new/00_gone.handoff.nudge"
run_sweep "alive" "$NOW_MS" >/dev/null
[[ ! -e "$SROOT/inbox/new/00_gone.handoff.nudge" ]] || fail "02 (.nudge): orphaned sidecar survived the sweep"
pass "02: an orphaned .nudge sidecar (no matching .handoff) is reaped on the sweep"
rm -rf "$SROOT"

# ── live-sidecar-preserved-03 ─────────────────────────────────────────────
make_sweep_fixture
write_handoff "$SROOT/inbox/new/00_item.handoff"
python3 -c "import os; os.utime('$SROOT/inbox/new/00_item.handoff', ($((NOW_MS / 1000)), $((NOW_MS / 1000))))"
echo '{"chaseCount":1}' > "$SROOT/inbox/new/00_item.handoff.chase.json"
run_sweep "alive" "$NOW_MS" >/dev/null
[[ -f "$SROOT/inbox/new/00_item.handoff" ]] || fail "03: the still-queued handoff must remain in new/"
[[ -f "$SROOT/inbox/new/00_item.handoff.chase.json" ]] || fail "03: the live sidecar must be preserved, not reaped"
pass "03: a sidecar whose parent handoff still waits in new/ is preserved by the sweep"
rm -rf "$SROOT"

# ── non-sidecar-file-untouched-04 (sweep half) ────────────────────────────
make_sweep_fixture
echo 'just some notes' > "$SROOT/inbox/new/notes.txt"
run_sweep "alive" "$NOW_MS" >/dev/null
[[ -f "$SROOT/inbox/new/notes.txt" ]] || fail "04 (sweep): a non-sidecar file must never be removed by the sweep"
pass "04 (sweep): the sweep leaves a non-sidecar file untouched"
rm -rf "$SROOT"

# ── regression-05: the dead-letter path still moves a sidecar along with
# its handoff, unchanged (chase_sweep_lib.bb's own apply-inbox-item-action!) ─
make_sweep_fixture
write_handoff "$SROOT/inbox/new/00_item.handoff"
python3 -c "import os; os.utime('$SROOT/inbox/new/00_item.handoff', ($(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 )), $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))))"
python3 -c "import json; json.dump({'chaseCount': 3}, open('$SROOT/inbox/new/00_item.handoff.chase.json','w'))"
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 )) >/dev/null
[[ -f "$SROOT/inbox/new/00_item.handoff.dead" ]] || fail "05: item was not dead-lettered"
[[ -f "$SROOT/inbox/new/00_item.handoff.dead.chase.json" ]] || fail "05: the sidecar must move to the .dead location, not be dropped"
[[ ! -e "$SROOT/inbox/new/00_item.handoff.chase.json" ]] || fail "05: the plain-suffix sidecar must not remain alongside the .dead copy"
pass "05 (regression): the dead-letter path still moves the sidecar along with its handoff, unchanged"
rm -rf "$SROOT"

echo "ALL PASS"
