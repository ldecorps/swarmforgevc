#!/usr/bin/env bash
# BL-529: pre-turn branch/claim guard in ready_for_next_task.bb. A pipeline
# worktree role whose git branch names a DIFFERENT ticket than its
# in-process claim must not run a productive turn on it: a clean worktree is
# auto-corrected onto the role's standard branch, a dirty one has the claim
# requeued to new/ and the turn refused with a warning naming branch and
# claim. Generic branches (swarmforge-coder, main, <swarm>/<role>) and
# ticket branches matching the claim pass untouched. Covers feature
# scenarios ticket-branch-mismatch-guard-01/02/03/04 against the REAL
# script with a real git fixture (no mocked git - the checkout/requeue
# behavior IS the contract).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"

# shellcheck source=lib/tmp_cleanup.sh
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture: git repo with a coder worktree + swarm state ────────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir ROOT

# The initial branch is deliberately NEITHER main nor master nor any name a
# test case wants to put the coder worktree on - git refuses to check out
# one branch in two worktrees.
git -C "$ROOT" init -q -b fixture-root
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
echo "tracked" > "$ROOT/tracked.txt"
# .swarmforge/ is gitignored exactly like the real repo - the handoff state a
# worktree carries is runtime state, never worktree dirtiness.
printf '.swarmforge/\n' > "$ROOT/.gitignore"
git -C "$ROOT" add tracked.txt .gitignore
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m two
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

# Standard-branch refs the guard can auto-correct onto. main also exists as
# a generic-branch test target.
git -C "$ROOT" branch primary/coder
git -C "$ROOT" branch swarmforge-coder
git -C "$ROOT" branch main

CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q "$CODER_WT" swarmforge-coder

mkdir -p "$ROOT/.swarmforge" \
         "$CODER_WT/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$CODER_WT/.swarmforge/handoffs/inbox/completed"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'swarm_name\tprimary\nswarm_mode\tautonomous\n' > "$ROOT/.swarmforge/swarm-identity"

INBOX="$CODER_WT/.swarmforge/handoffs/inbox"

drop_handoff() {  # dir name task-header(type)
  printf 'id: %s\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: %s\ntask: %s\ncommit: %s\n\nbody for %s\n' \
    "$2" "$4" "$3" "$COMMIT" "$2" > "$1/00_$2.handoff"
}

drop_note() {  # dir name - a note handoff carries no task header
  printf 'id: %s\nfrom: qa\nto: coder\nrecipient: coder\npriority: 00\ntype: note\nmessage: merge up\n\nbody for %s\n' \
    "$2" "$2" > "$1/00_$2.handoff"
}

switch_branch() {  # branch
  git -C "$CODER_WT" checkout -q -B "$1" >/dev/null 2>&1
}

reset_case() {
  rm -f "$INBOX/new"/*.handoff "$INBOX/in_process"/*.handoff 2>/dev/null || true
  git -C "$CODER_WT" checkout -q -- tracked.txt 2>/dev/null || true
  rm -f "$CODER_WT/untracked-scratch.txt"
}

run_ready() {  # sets OUT, ERR, RC
  set +e
  OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK" 2>"$ROOT/stderr.txt")"
  RC=$?
  set -e
  ERR="$(cat "$ROOT/stderr.txt")"
}

current_branch() { git -C "$CODER_WT" rev-parse --abbrev-ref HEAD; }

# ── baseline: no claim at all means the guard never fires ─────────────────
reset_case
switch_branch BL-526
run_ready
[[ $RC -eq 0 && "$OUT" == "NO_TASK" ]] || fail "baseline: expected NO_TASK on an empty inbox, got rc=$RC out=$OUT"
[[ "$(current_branch)" == "BL-526" ]] || fail "baseline: with no claim the branch must be left alone, on $(current_branch)"
pass "baseline: empty inbox on a ticket branch prints NO_TASK and never fires the guard"

# ── guard-01: generic / matching branches pass (Scenario Outline) ─────────
# row: swarmforge-coder x BL-529
reset_case
switch_branch swarmforge-coder
drop_handoff "$INBOX/in_process" "resume1" "BL-529-ticket-branch-mismatch-guard" "git_handoff"
run_ready
[[ $RC -eq 0 ]] || fail "01(swarmforge-coder): expected rc=0, got $RC ($ERR)"
echo "$OUT" | grep -q "^TASK:" || fail "01(swarmforge-coder): expected the claim to print, got: $OUT"
echo "$OUT" | grep -q "^TASK_NAME: BL-529-ticket-branch-mismatch-guard$" || fail "01(swarmforge-coder): wrong task name in: $OUT"
[[ "$(current_branch)" == "swarmforge-coder" ]] || fail "01(swarmforge-coder): branch moved to $(current_branch)"
[[ -z "$ERR" ]] || fail "01(swarmforge-coder): a passing guard emits no warning, got: $ERR"
pass "guard-01: legacy role branch swarmforge-coder passes for claim BL-529"

# row: main x BL-512
reset_case
switch_branch main
drop_handoff "$INBOX/in_process" "resume2" "BL-512-some-claim" "git_handoff"
run_ready
[[ $RC -eq 0 ]] && echo "$OUT" | grep -q "^TASK:" || fail "01(main): expected the claim to print, rc=$RC out=$OUT err=$ERR"
[[ "$(current_branch)" == "main" ]] || fail "01(main): branch moved to $(current_branch)"
pass "guard-01: main passes for claim BL-512"

# row: BL-529 x BL-529 (ticket branch matching the claim)
reset_case
switch_branch BL-529
drop_handoff "$INBOX/in_process" "resume3" "BL-529-ticket-branch-mismatch-guard" "git_handoff"
run_ready
[[ $RC -eq 0 ]] && echo "$OUT" | grep -q "^TASK:" || fail "01(BL-529): expected the claim to print, rc=$RC out=$OUT err=$ERR"
[[ "$(current_branch)" == "BL-529" ]] || fail "01(BL-529): matching ticket branch must stay, on $(current_branch)"
pass "guard-01: a ticket branch matching the claim passes"

# a note handoff (no task header) never mismatches, even on a ticket branch
reset_case
switch_branch BL-526
drop_note "$INBOX/in_process" "note1"
run_ready
[[ $RC -eq 0 ]] && echo "$OUT" | grep -q "^TASK:" || fail "note: expected the note to print, rc=$RC out=$OUT err=$ERR"
[[ "$(current_branch)" == "BL-526" ]] || fail "note: a claim with no ticket must leave the branch alone, on $(current_branch)"
pass "guard-01: a note handoff (no claim ticket) passes on any branch"

# ── guard-03: clean mismatch auto-corrects onto the standard branch ───────
reset_case
switch_branch BL-526
drop_handoff "$INBOX/in_process" "resume4" "BL-512-some-claim" "git_handoff"
run_ready
[[ $RC -eq 0 ]] || fail "03: auto-correct path must still run the turn, rc=$RC err=$ERR"
echo "$OUT" | grep -q "^TASK:" || fail "03: expected the claim to print after correction, got: $OUT"
[[ "$(current_branch)" == "primary/coder" ]] || fail "03: expected auto-checkout to primary/coder, on $(current_branch)"
echo "$ERR" | grep -q 'BRANCH_CLAIM_GUARD: auto-corrected worktree off branch "BL-526" (ticket BL-526) onto "primary/coder" for claim BL-512' \
  || fail "03: expected an auto-correct notice naming branch and claim, got: $ERR"
[[ -f "$INBOX/in_process/00_resume4.handoff" ]] || fail "03: the claim must stay in_process after a correction"
pass "guard-03: clean mismatch auto-corrects BL-526 -> primary/coder and the turn proceeds"

# fallback: only the legacy swarmforge-<role> branch exists
reset_case
switch_branch BL-526
git -C "$ROOT" branch -D primary/coder >/dev/null || fail "fixture: could not delete primary/coder"
drop_handoff "$INBOX/in_process" "resume5" "BL-512-some-claim" "git_handoff"
run_ready
[[ $RC -eq 0 ]] || fail "03-fallback: rc=$RC err=$ERR"
[[ "$(current_branch)" == "swarmforge-coder" ]] || fail "03-fallback: expected legacy swarmforge-coder, on $(current_branch)"
pass "guard-03: without primary/coder the legacy swarmforge-coder branch is the correction target"

# no standard branch at all: clean but uncorrectable -> requeue + refuse
reset_case
switch_branch BL-526
git -C "$ROOT" branch -D swarmforge-coder >/dev/null 2>&1 || \
  fail "fixture: could not delete swarmforge-coder (still checked out at $(current_branch)?)"
drop_handoff "$INBOX/in_process" "resume6" "BL-512-some-claim" "git_handoff"
run_ready
[[ $RC -ne 0 ]] || fail "03-uncorrectable: expected a refusal, rc=0 out=$OUT"
echo "$OUT" | grep -q "^TASK:" && fail "03-uncorrectable: no task may print on a refused turn: $OUT"
[[ "$(current_branch)" == "BL-526" ]] || fail "03-uncorrectable: the mismatched branch must stay, on $(current_branch)"
[[ -f "$INBOX/new/00_resume6.handoff" && ! -e "$INBOX/in_process/00_resume6.handoff" ]] \
  || fail "03-uncorrectable: the claim must be requeued to new/"
echo "$ERR" | grep -q "BRANCH_CLAIM_MISMATCH" || fail "03-uncorrectable: expected a mismatch warning, got: $ERR"
pass "guard-03: a clean mismatch with no standard branch requeues and refuses"

# ── guard-04: dirty mismatch requeues the claim and refuses the turn ──────
reset_case
git -C "$ROOT" branch primary/coder  # restore a valid correction target - dirty must not use it
switch_branch BL-526
echo "in-flight edit" >> "$CODER_WT/tracked.txt"
drop_handoff "$INBOX/in_process" "resume7" "BL-512-some-claim" "git_handoff"
run_ready
[[ $RC -ne 0 ]] || fail "04: expected a refusal on a dirty mismatch, rc=0 out=$OUT"
echo "$OUT" | grep -q "^TASK:" && fail "04: no task may print on a refused turn: $OUT"
[[ "$(current_branch)" == "BL-526" ]] || fail "04: the dirty mismatched branch must stay, on $(current_branch)"
[[ -f "$INBOX/new/00_resume7.handoff" && ! -e "$INBOX/in_process/00_resume7.handoff" ]] \
  || fail "04: the in-process claim must be moved back to new/"
echo "$ERR" | grep -q 'BRANCH_CLAIM_MISMATCH: worktree branch "BL-526" names ticket BL-526 but the in-process claim is BL-512' \
  || fail "04: the warning must name the branch and the claim, got: $ERR"
pass "guard-04: dirty mismatch requeues the claim to new/, refuses, names branch + claim"

# dirty via an UNTRACKED file counts too - auto-checkout must never carry
# another ticket's uncommitted scratch across branches
reset_case
switch_branch BL-526
echo "scratch" > "$CODER_WT/untracked-scratch.txt"
drop_handoff "$INBOX/in_process" "resume8" "BL-512-some-claim" "git_handoff"
run_ready
[[ $RC -ne 0 && -f "$INBOX/new/00_resume8.handoff" ]] \
  || fail "04-untracked: an untracked-only worktree must refuse + requeue, rc=$RC"
[[ "$(current_branch)" == "BL-526" ]] || fail "04-untracked: branch moved to $(current_branch)"
pass "guard-04: untracked-only uncommitted state also refuses + requeues"

# ── fresh-dequeue path: claim waiting in new/, not yet in_process ─────────
# clean mismatch dequeued from new/ auto-corrects then prints
reset_case
switch_branch BL-526
drop_handoff "$INBOX/new" "queued1" "BL-512-some-claim" "git_handoff"
run_ready
[[ $RC -eq 0 ]] && echo "$OUT" | grep -q "^TASK:" || fail "dequeue-clean: rc=$RC out=$OUT err=$ERR"
[[ "$(current_branch)" == "primary/coder" ]] || fail "dequeue-clean: expected primary/coder, on $(current_branch)"
[[ -f "$INBOX/in_process/00_queued1.handoff" ]] || fail "dequeue-clean: the claim must land in_process after correction"
pass "guard-03: a fresh dequeue on a clean mismatched branch corrects then prints"

# dirty mismatch dequeued from new/ refuses, leaving the claim back in new/
reset_case
switch_branch BL-526
echo "in-flight edit" >> "$CODER_WT/tracked.txt"
drop_handoff "$INBOX/new" "queued2" "BL-512-some-claim" "git_handoff"
run_ready
[[ $RC -ne 0 ]] || fail "dequeue-dirty: expected a refusal, rc=0 out=$OUT"
[[ -f "$INBOX/new/00_queued2.handoff" && ! -e "$INBOX/in_process/00_queued2.handoff" ]] \
  || fail "dequeue-dirty: the claim must end up back in new/, never in_process"
pass "guard-04: a fresh dequeue on a dirty mismatched branch refuses with the claim in new/"

echo "ALL PASS"
