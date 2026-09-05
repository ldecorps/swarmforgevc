#!/usr/bin/env bash
# BL-652: done_with_current.sh must fail fast on ANY argument with zero
# completion side effects. A --help probe previously archived the whole
# in_process batch (including unworked parcels).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

install_scripts() {
  local wt="$1"
  mkdir -p "$wt/swarmforge/scripts"
  cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$wt/swarmforge/scripts/"
  # Stub ready_for_next so argumentless completion cannot rotate live roles.
  cat > "$wt/swarmforge/scripts/ready_for_next_batch.sh" <<'EOF'
#!/usr/bin/env zsh
echo "NO_TASK"
exit 0
EOF
  cat > "$wt/swarmforge/scripts/ready_for_next_task.sh" <<'EOF'
#!/usr/bin/env zsh
echo "NO_TASK"
exit 0
EOF
  chmod +x "$wt/swarmforge/scripts/"*.sh
}

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

BATCH_WT="$ROOT/.worktrees/batchrole"
TASK_WT="$ROOT/.worktrees/taskrole"
git -C "$ROOT" worktree add -q -b batchrole "$BATCH_WT"
git -C "$ROOT" worktree add -q -b taskrole "$TASK_WT"
install_scripts "$BATCH_WT"
install_scripts "$TASK_WT"

DONE_BATCH="$BATCH_WT/swarmforge/scripts/done_with_current.sh"
DONE_TASK="$TASK_WT/swarmforge/scripts/done_with_current.sh"

ROLES="batchrole\tbatchrole\t$BATCH_WT\tswarmforge-batchrole\tBatchrole\tclaude\tbatch
taskrole\ttaskrole\t$TASK_WT\tswarmforge-taskrole\tTaskrole\tclaude\ttask
"
mkdir -p "$ROOT/.swarmforge" "$BATCH_WT/.swarmforge" "$TASK_WT/.swarmforge"
printf "$ROLES" > "$ROOT/.swarmforge/roles.tsv"
printf "$ROLES" > "$BATCH_WT/.swarmforge/roles.tsv"
printf "$ROLES" > "$TASK_WT/.swarmforge/roles.tsv"

write_handoff() {
  local path="$1" id="$2" recipient="$3"
  mkdir -p "$(dirname "$path")"
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 50\ntype: note\nmessage: body\ndequeued_at: 2026-08-25T00:00:00Z\n\nbody\n' \
    "$id" "$recipient" "$recipient" > "$path"
}

setup_batch() {
  local ip="$BATCH_WT/.swarmforge/handoffs/inbox/in_process"
  local batch="$ip/batch_20260825T000000Z"
  rm -rf "$ip"
  mkdir -p "$batch" "$BATCH_WT/.swarmforge/handoffs/inbox/completed"
  write_handoff "$batch/50_a.handoff" a batchrole
  write_handoff "$batch/50_b.handoff" b batchrole
}

setup_task() {
  local ip="$TASK_WT/.swarmforge/handoffs/inbox/in_process"
  rm -rf "$ip"
  mkdir -p "$ip" "$TASK_WT/.swarmforge/handoffs/inbox/completed"
  write_handoff "$ip/50_t.handoff" t taskrole
}

assert_batch_untouched() {
  local ip="$BATCH_WT/.swarmforge/handoffs/inbox/in_process"
  local completed="$BATCH_WT/.swarmforge/handoffs/inbox/completed"
  [[ -f "$ip/batch_20260825T000000Z/50_a.handoff" ]] || fail "$1: a missing from in_process"
  [[ -f "$ip/batch_20260825T000000Z/50_b.handoff" ]] || fail "$1: b missing from in_process"
  ! grep -q '^completed_at:' "$ip/batch_20260825T000000Z/50_a.handoff" \
    || fail "$1: completed_at stamped on a"
  ! grep -q '^completed_at:' "$ip/batch_20260825T000000Z/50_b.handoff" \
    || fail "$1: completed_at stamped on b"
  [[ -z "$(find "$completed" -mindepth 1 -maxdepth 1 2>/dev/null)" ]] \
    || fail "$1: completed dir not empty"
}

# ── 01: any argument fails fast in batch mode ──────────────────────────────
for ARG in --help -h now; do
  setup_batch
  set +e
  OUT="$(cd "$BATCH_WT" && SWARMFORGE_ROLE=batchrole "$DONE_BATCH" "$ARG" 2>&1)"
  STATUS=$?
  set -e
  [[ "$STATUS" -ne 0 ]] || fail "01 ($ARG): expected non-zero, got 0; out=$OUT"
  echo "$OUT" | grep -qi 'no argument' || fail "01 ($ARG): expected no-argument usage text; got: $OUT"
  echo "$OUT" | grep -q 'COMPLETED_BATCH:' && fail "01 ($ARG): completion ran; got: $OUT"
  echo "$OUT" | grep -q 'NO_TASK' && fail "01 ($ARG): ready_for_next chained; got: $OUT"
  assert_batch_untouched "01 ($ARG)"
  pass "01: batch mode rejects '$ARG' with no side effects"
done

# ── 02: --help fails fast in task mode ─────────────────────────────────────
setup_task
set +e
OUT="$(cd "$TASK_WT" && SWARMFORGE_ROLE=taskrole "$DONE_TASK" --help 2>&1)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "02: expected non-zero, got 0; out=$OUT"
echo "$OUT" | grep -qi 'no argument' || fail "02: expected no-argument usage text; got: $OUT"
[[ -f "$TASK_WT/.swarmforge/handoffs/inbox/in_process/50_t.handoff" ]] \
  || fail "02: handoff left in_process"
pass "02: task mode rejects --help with no side effects"

# ── 03: argumentless batch invocation still completes ──────────────────────
setup_batch
OUT="$(cd "$BATCH_WT" && SWARMFORGE_ROLE=batchrole "$DONE_BATCH" 2>&1)"
echo "$OUT" | grep -q 'COMPLETED_BATCH:' || fail "03: expected COMPLETED_BATCH; got: $OUT"
[[ -d "$BATCH_WT/.swarmforge/handoffs/inbox/completed/batch_20260825T000000Z" ]] \
  || fail "03: completed batch dir missing"
grep -q '^completed_at:' \
  "$BATCH_WT/.swarmforge/handoffs/inbox/completed/batch_20260825T000000Z/50_a.handoff" \
  || fail "03: completed_at not stamped on a"
grep -q '^completed_at:' \
  "$BATCH_WT/.swarmforge/handoffs/inbox/completed/batch_20260825T000000Z/50_b.handoff" \
  || fail "03: completed_at not stamped on b"
pass "03: argumentless batch completion still works"

# ── 04: BL-1422's one exception - bad --no-work shapes still fail fast ─────
# (a bare --no-work with no reason at all, and --no-work plus extra args;
# the blank-reason shape is test_done_with_current_work_note_evidence.sh's
# own scenario 03b, since a literal "" argv element cannot survive an
# unquoted word-split loop like this one).
run_bad_no_work() {
  setup_task
  set +e
  OUT="$(cd "$TASK_WT" && SWARMFORGE_ROLE=taskrole "$DONE_TASK" "$@" 2>&1)"
  STATUS=$?
  set -e
  [[ "$STATUS" -ne 0 ]] || fail "04 ($*): expected non-zero, got 0; out=$OUT"
  echo "$OUT" | grep -qi 'no argument' || fail "04 ($*): expected no-argument usage text; got: $OUT"
  [[ -f "$TASK_WT/.swarmforge/handoffs/inbox/in_process/50_t.handoff" ]] \
    || fail "04 ($*): handoff left in_process"
  pass "04: task mode rejects bad --no-work shape '$*' with no side effects"
}
run_bad_no_work --no-work
run_bad_no_work --no-work x extra

# ── 05: --no-work "<reason>" is accepted at the argv layer (BL-1422) - this
#    fixture's item is a plain note (message: body), not a Work dispatch,
#    so the semantic use of the reason (stamping no_work_reason) is
#    test_done_with_current_work_note_evidence.sh's own scope; this only
#    proves refuse-unexpected-args! itself lets the shape through. ────────
setup_task
OUT="$(cd "$TASK_WT" && SWARMFORGE_ROLE=taskrole "$DONE_TASK" --no-work "not a work note anyway" 2>&1)"
echo "$OUT" | grep -q 'COMPLETED:' || fail "05: expected COMPLETED, got: $OUT"
pass "05: --no-work \"<reason>\" is accepted at the argv layer and completes"

echo "ALL PASS: done_with_current arg rejection (BL-652)"
