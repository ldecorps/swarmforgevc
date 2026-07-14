#!/usr/bin/env bash
# BL-218: mailbox intake must never resurrect an already-terminal handoff
# (completed/ or abandoned/) as fresh in_process work. Covers acceptance
# scenarios BL-218 intake-01..03. The pure dedup-new-candidates logic is
# unit-tested directly in mailbox_intake_dedup_test_runner.bb; this file
# proves the real ready_for_next_task.bb/ready_for_next_batch.bb wiring
# end-to-end, same fixture style as test_handoff_state_dir_worktree_root.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"
READY_BATCH="$SCRIPT_DIR/../ready_for_next_batch.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

write_handoff() {
  local dir="$1" id="$2" priority="${3:-50}" recipient="${4:-coder}"
  mkdir -p "$dir"
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: %s\ntype: git_handoff\ntask: BL-218-test\ncommit: 0000000000\n\npayload\n' \
    "$id" "$recipient" "$recipient" "$priority" > "$dir/${priority}_${id}.handoff"
}

# ── fixture: a project root with a coder git worktree (task mode) ──────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q -b coder "$CODER_WT"

mkdir -p "$ROOT/.swarmforge" "$CODER_WT/.swarmforge"
ROLES="coordinator\tmaster\t$ROOT\tswarmforge-coordinator\tCoordinator\tclaude\ttask
coder\tcoder\t$CODER_WT\tswarmforge-coder\tCoder\tclaude\ttask
"
printf "$ROLES" > "$ROOT/.swarmforge/roles.tsv"
printf "$ROLES" > "$CODER_WT/.swarmforge/roles.tsv"

INBOX="$CODER_WT/.swarmforge/handoffs/inbox"

# ── intake-01: a stale new/ copy of an already-completed handoff is not
#     resurrected, and a genuinely new item behind it still dequeues ───────
write_handoff "$INBOX/completed" "already-done"
write_handoff "$INBOX/new" "already-done"       # the stale duplicate
write_handoff "$INBOX/new" "genuinely-new"

OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"
grep -q "SKIPPED already-processed: 50_already-done.handoff" <<< "$OUT" \
  || fail "intake-01: stale completed duplicate was not logged as skipped; got: $OUT"
grep -q "^TASK: $INBOX/in_process/50_genuinely-new.handoff" <<< "$OUT" \
  || fail "intake-01: the genuinely-new item behind the stale duplicate was not dequeued; got: $OUT"
[[ -f "$INBOX/new/50_already-done.handoff" ]] \
  || fail "intake-01: the stale duplicate must be left in place (skipped), not deleted"
[[ ! -e "$INBOX/in_process/50_already-done.handoff" ]] \
  || fail "intake-01: the stale duplicate was resurrected into in_process/"
pass "intake-01: a stale new/ copy of an already-completed handoff is skipped, not resurrected"

rm -f "$INBOX/in_process"/*.handoff "$INBOX/new"/*.handoff "$INBOX/completed"/*.handoff

# ── intake-01 (abandoned variant) ───────────────────────────────────────────
write_handoff "$INBOX/abandoned" "already-abandoned"
write_handoff "$INBOX/new" "already-abandoned"

OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"
grep -q "NO_TASK" <<< "$OUT" \
  || fail "intake-01 (abandoned): expected NO_TASK once the only new/ item is an abandoned duplicate; got: $OUT"
grep -q "SKIPPED already-processed: 50_already-abandoned.handoff" <<< "$OUT" \
  || fail "intake-01 (abandoned): stale abandoned duplicate was not logged as skipped; got: $OUT"
pass "intake-01 (abandoned variant): a stale new/ copy of an already-abandoned handoff is skipped"

rm -f "$INBOX/new"/*.handoff "$INBOX/abandoned"/*.handoff

# ── intake-02: a genuinely new handoff (no stale duplicates at all) still
#     dequeues normally, with a fresh dequeued_at ───────────────────────────
write_handoff "$INBOX/new" "fresh"

OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"
grep -q "^TASK: $INBOX/in_process/50_fresh.handoff" <<< "$OUT" \
  || fail "intake-02: a genuinely new handoff did not dequeue; got: $OUT"
grep -q "^dequeued_at: " "$INBOX/in_process/50_fresh.handoff" \
  || fail "intake-02: dequeued file is missing a fresh dequeued_at header"
pass "intake-02: a genuinely new handoff still dequeues normally"

rm -f "$INBOX/in_process"/*.handoff

# ── batch mode: the same guard applies to ready_for_next_batch.bb ──────────
write_handoff "$INBOX/completed" "batch-already-done"
write_handoff "$INBOX/new" "batch-already-done"
write_handoff "$INBOX/new" "batch-genuinely-new"

OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_BATCH")"
grep -q "SKIPPED already-processed: 50_batch-already-done.handoff" <<< "$OUT" \
  || fail "batch: stale completed duplicate was not logged as skipped; got: $OUT"
grep -q "^BATCH: $INBOX/in_process/batch_" <<< "$OUT" \
  || fail "batch: the genuinely-new item did not form a batch; got: $OUT"
[[ ! -e "$INBOX/in_process"/batch_*/*batch-already-done* ]] \
  || fail "batch: the stale duplicate was resurrected into the in_process batch"
pass "batch: ready_for_next_batch.bb applies the same dedup guard as task mode"

rm -rf "$INBOX/in_process"/* "$INBOX/new"/* "$INBOX/completed"/*

# ── intake-03: the guard holds even under the pre-BL-128 flat-layout
#     fallback (master-resident role, roles.tsv row absent so
#     load-role-info returns nil) ───────────────────────────────────────────
ROOT2="$(cd "$(mktemp -d)" && pwd -P)"
git -C "$ROOT2" init -q
git -C "$ROOT2" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
# Deliberately no roles.tsv at all: load-role-info returns nil for
# "coordinator", forcing my-mailbox-base-dir's flat pre-BL-128 fallback -
# the exact post-merge/pre-migration window BL-218's root cause describes.
FLAT_INBOX="$ROOT2/.swarmforge/handoffs/inbox"
write_handoff "$FLAT_INBOX/completed" "flat-already-done" 50 coordinator
write_handoff "$FLAT_INBOX/new" "flat-already-done" 50 coordinator

OUT="$(cd "$ROOT2" && SWARMFORGE_ROLE=coordinator bb "$READY_TASK")"
grep -q "NO_TASK" <<< "$OUT" \
  || fail "intake-03: expected NO_TASK under the flat-layout fallback; got: $OUT"
grep -q "SKIPPED already-processed: 50_flat-already-done.handoff" <<< "$OUT" \
  || fail "intake-03: stale duplicate under the flat-layout fallback was not skipped; got: $OUT"
rm -rf "$ROOT2"
pass "intake-03: the dedup guard holds under the pre-BL-128 flat-layout fallback"

echo "ALL PASS"
