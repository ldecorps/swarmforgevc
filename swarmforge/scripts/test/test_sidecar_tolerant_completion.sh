#!/usr/bin/env bash
# BL-119: chaser sidecars (.nudge, .chase.json) left next to a handoff must
# never wedge completion. done_with_current_task.bb / done_with_current_batch.bb
# treat them as disposable metadata: cleaned up on completion, never the
# reason a role gets stuck. Unknown files still abort loudly.
#
# Covers acceptance scenarios BL-119 sidecar-tolerant-completion-01..03.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DONE_TASK="$SCRIPT_DIR/../done_with_current_task.bb"
DONE_BATCH="$SCRIPT_DIR/../done_with_current_batch.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  git -C "$root" init -q
  git -C "$root" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
  echo "$root"
}

make_handoff() {
  local dir="$1" name="$2"
  mkdir -p "$dir"
  printf 'id: %s\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 50\ntype: git_handoff\ntask: BL-119-test\n\npayload\n' \
    "$name" > "$dir/00_${name}.handoff"
  echo "$dir/00_${name}.handoff"
}

# ── 02: task completion cleans sidecars of the completed handoff ───────────
ROOT2="$(mk_root)"
IN_PROCESS2="$ROOT2/.swarmforge/handoffs/inbox/in_process"
HANDOFF2="$(make_handoff "$IN_PROCESS2" "task-a")"
touch "${HANDOFF2}.nudge" "${HANDOFF2}.chase.json"

OUT="$(cd "$ROOT2" && SWARMFORGE_ROLE=coder bb "$DONE_TASK")"
grep -q "^COMPLETED:" <<< "$OUT" || fail "02: task completion did not report COMPLETED; got: $OUT"
[[ ! -e "${HANDOFF2}.nudge" ]] || fail "02: .nudge sidecar survived task completion"
[[ ! -e "${HANDOFF2}.chase.json" ]] || fail "02: .chase.json sidecar survived task completion"
COMPLETED_HANDOFF="$ROOT2/.swarmforge/handoffs/inbox/completed/00_task-a.handoff"
[[ -f "$COMPLETED_HANDOFF" ]] || fail "02: handoff itself did not move to completed/"
pass "02: task completion removes both sidecars of the completed handoff"

# ── 01: batch completion cleans an orphaned nudge sidecar and deletes the dir ─
ROOT1="$(mk_root)"
BATCH_DIR="$ROOT1/.swarmforge/handoffs/inbox/in_process/batch_20260706T000000Z"
HANDOFF1="$(make_handoff "$BATCH_DIR" "batch-a")"
# Simulate the observed bug: the handoff itself already moved out (e.g. a
# prior partial run), leaving only its orphaned sidecar behind.
touch "${HANDOFF1}.nudge"
rm -f "$HANDOFF1"
mkdir -p "$ROOT1/.swarmforge/handoffs/inbox/completed"

OUT="$(cd "$ROOT1" && SWARMFORGE_ROLE=coder bb "$DONE_BATCH" 2>&1)" && RC=0 || RC=$?
if [[ "$RC" != 0 ]]; then
  fail "01: batch completion aborted on an orphaned sidecar-only batch; got: $OUT"
fi
[[ ! -d "$BATCH_DIR" ]] || fail "01: batch directory was not deleted"
pass "01: batch completion tolerates and removes an orphaned nudge sidecar, deletes the batch dir"

# ── 01b: batch completion also cleans a sidecar left behind after moving the
#         real handoff out (the more common ordering) ──────────────────────
ROOT1B="$(mk_root)"
BATCH_DIR_B="$ROOT1B/.swarmforge/handoffs/inbox/in_process/batch_20260706T000001Z"
HANDOFF1B="$(make_handoff "$BATCH_DIR_B" "batch-b")"
touch "${HANDOFF1B}.nudge" "${HANDOFF1B}.chase.json"
mkdir -p "$ROOT1B/.swarmforge/handoffs/inbox/completed"

OUT="$(cd "$ROOT1B" && SWARMFORGE_ROLE=coder bb "$DONE_BATCH" 2>&1)" && RC=0 || RC=$?
[[ "$RC" == 0 ]] || fail "01b: batch completion failed with real handoff + sidecars present; got: $OUT"
[[ ! -d "$BATCH_DIR_B" ]] || fail "01b: batch directory was not deleted"
[[ -f "$ROOT1B/.swarmforge/handoffs/inbox/completed/batch_20260706T000001Z/00_batch-b.handoff" ]] \
  || fail "01b: completed batch handoff file is missing"
pass "01b: batch completion moves the handoff and discards its sidecars, deletes the batch dir"

# ── 03: unknown files still abort completion, and are not deleted ──────────
# NOTE: scope decision - the ticket's own example list also names a stray
# *.handoff file, but nothing records batch membership (ready_for_next_batch
# just lists whatever's in the directory), so an extra *.handoff file is
# indistinguishable from a legitimately queued one without a manifest this
# fix does not add. Only genuinely non-handoff, non-sidecar junk (notes.txt)
# is covered here; a stray *.handoff detector is a separate, larger change
# left for a follow-on if that stronger guarantee is wanted.
for file in notes.txt; do
  ROOT3="$(mk_root)"
  BATCH_DIR3="$ROOT3/.swarmforge/handoffs/inbox/in_process/batch_20260706T000002Z"
  HANDOFF3="$(make_handoff "$BATCH_DIR3" "batch-c")"
  touch "$BATCH_DIR3/$file"
  mkdir -p "$ROOT3/.swarmforge/handoffs/inbox/completed"

  set +e
  OUT="$(cd "$ROOT3" && SWARMFORGE_ROLE=coder bb "$DONE_BATCH" 2>&1)"
  RC=$?
  set -e
  [[ "$RC" != 0 ]] || fail "03 ($file): batch completion did not abort on an unexpected file; got: $OUT"
  grep -q "$file" <<< "$OUT" || fail "03 ($file): abort message did not name the offending file; got: $OUT"
  [[ -f "$BATCH_DIR3/$file" ]] || fail "03 ($file): unexpected file was deleted despite the abort"
  pass "03 ($file): batch completion aborts naming the unexpected file, does not delete it"
done

echo "ALL PASS"
