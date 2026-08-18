#!/usr/bin/env bash
# BL-640: pre-turn reference/ freshness guard in ready_for_next.bb. A role
# whose worktree has not merged an amendment to
# swarmforge/constitution/articles/reference/<file> since it landed on main
# must never silently proceed to act - the guard refuses the turn and
# reports exactly which file(s) are stale (feature scenario
# stale-read-without-merge-is-caught-02). A worktree that HAS merged the
# amendment passes through untouched and dispatch proceeds normally
# (scenario amendment-reaches-role-before-next-act-01). Covers the REAL
# ready_for_next.sh against a real git fixture (no mocked git) - same
# established pattern as test_branch_claim_guard.sh. Prints "PASS: NN:"
# markers the bl640 acceptance step handlers grep for.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# bb directly, never the ready_for_next.sh wrapper: the wrapper cd's into
# its OWN script directory before invoking bb (to fix babashka's relative
# path resolution), which would make the guard's git-root call resolve
# against the real repo instead of this fixture. Same reason
# test_branch_claim_guard.sh drives ready_for_next_task.bb directly.
READY="$SCRIPT_DIR/../ready_for_next.bb"

# shellcheck source=lib/tmp_cleanup.sh
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

REF_REL="swarmforge/constitution/articles/reference/workflow-detailed.prompt"

# ── fixture: git repo with a coder worktree + swarm state ────────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir ROOT

git -C "$ROOT" init -q -b main
mkdir -p "$ROOT/swarmforge/constitution/articles/reference"
echo "OLD: check ancestry" > "$ROOT/$REF_REL"
printf '.swarmforge/\n' > "$ROOT/.gitignore"
git -C "$ROOT" add "$REF_REL" .gitignore
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m base

# The branch the coder worktree checks out is cut BEFORE the amendment -
# exactly the "worktree has not merged main since" state.
git -C "$ROOT" branch swarmforge-coder

# main advances with the amendment; swarmforge-coder does not.
echo "NEW: verify content is gone, never ancestry" > "$ROOT/$REF_REL"
git -C "$ROOT" add "$REF_REL"
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m "amend reference/ rule"
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q "$CODER_WT" swarmforge-coder

mkdir -p "$ROOT/.swarmforge" \
         "$CODER_WT/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$CODER_WT/.swarmforge/handoffs/inbox/completed"
# BL-640 D1 (architect bounce 20260818): an intentionally unrecognized
# receive-mode. Once the guard passes a fresh worktree through, dispatch
# would exec the REAL ready_for_next_task.sh - whose wrapper cd's into the
# REAL repo's own scripts dir before invoking bb (pre-existing, unrelated
# to this guard) - which would act on THIS machine's live coder mailbox
# instead of this fixture. "guard-boundary-only" is not "task"/"batch", so
# dispatch_lib.bb's run-dispatch! fails closed with its own
# INVALID_RECEIVE_MODE error instead of ever exec'ing anything - proof
# control reached dispatch without letting a real exec touch the live repo.
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\tguard-boundary-only\n' "$CODER_WT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'swarm_name\tprimary\nswarm_mode\tautonomous\n' > "$ROOT/.swarmforge/swarm-identity"

INBOX="$CODER_WT/.swarmforge/handoffs/inbox"

drop_handoff() {  # dir name task-header(type)
  printf 'id: %s\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: %s\ntask: %s\ncommit: %s\n\nbody for %s\n' \
    "$2" "$4" "$3" "$COMMIT" "$2" > "$1/00_$2.handoff"
}

run_ready() {  # sets OUT, ERR, RC
  set +e
  OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY" 2>"$ROOT/stderr.txt")"
  RC=$?
  set -e
  ERR="$(cat "$ROOT/stderr.txt")"
}

# ── scenario 02: worktree has not merged the amendment - refuse + report ──
drop_handoff "$INBOX/in_process" "resume1" "BL-000-demo" "git_handoff"
run_ready
[[ $RC -ne 0 ]] || fail "02: expected a refusal, rc=0 out=$OUT"
echo "$OUT" | grep -q "^TASK:" && fail "02: no task may print on a refused turn: $OUT"
echo "$ERR" | grep -q "STALE_REFERENCE_ELABORATION" \
  || fail "02: expected a staleness report, got: $ERR"
echo "$ERR" | grep -q "$REF_REL" \
  || fail "02: the report must name the stale file, got: $ERR"
[[ -f "$INBOX/in_process/00_resume1.handoff" ]] \
  || fail "02: the claim must be left exactly where it was (this guard never touches mailbox state)"
pass "02: a role whose worktree has not merged the amendment refuses the turn and reports the stale file"

# refusing must never depend on WHERE the claim currently sits - a fresh
# dequeue candidate in new/ (nothing claimed yet) refuses identically.
rm -f "$INBOX/in_process"/*.handoff
drop_handoff "$INBOX/new" "queued1" "BL-000-demo" "git_handoff"
run_ready
[[ $RC -ne 0 ]] || fail "02-dequeue: expected a refusal, rc=0 out=$OUT"
echo "$ERR" | grep -q "STALE_REFERENCE_ELABORATION" \
  || fail "02-dequeue: expected a staleness report, got: $ERR"
[[ -f "$INBOX/new/00_queued1.handoff" && ! -e "$INBOX/in_process/00_queued1.handoff" ]] \
  || fail "02-dequeue: a refused turn must never dequeue - the candidate stays in new/"
pass "02: a stale worktree refuses before even dequeuing a fresh candidate"

rm -f "$INBOX/new"/*.handoff

# ── scenario 01: worktree merges main - the amended text is now what the ──
# role reads, and the turn proceeds exactly as it would have with no drift.
git -C "$CODER_WT" merge -q main
[[ "$(cat "$CODER_WT/$REF_REL")" == "NEW: verify content is gone, never ancestry" ]] \
  || fail "01: fixture sanity - merge should have delivered the amended text"

drop_handoff "$INBOX/in_process" "resume2" "BL-000-demo" "git_handoff"
run_ready
# BL-640 D1 (architect bounce backlog/evidence/BL-640-...-bounce-20260818.md):
# do NOT assert on what ready_for_next_task.sh itself prints/returns - once
# the guard passes a fresh worktree through, dispatch execs that REAL
# script against the REAL repo (see the roles.tsv comment above), so its
# output belongs to whatever this machine's live coder mailbox happens to
# hold, not this fixture. Scenario 01's contract - a fresh worktree is
# never refused by THIS guard - is fully proven by two guard-attributable
# signals: no STALE_REFERENCE_ELABORATION marker (the guard's own refusal
# signature), and INVALID_RECEIVE_MODE (dispatch's closed-failure path,
# reached only once the guard has handed the turn onward).
echo "$ERR" | grep -q "STALE_REFERENCE_ELABORATION" \
  && fail "01: a fresh worktree must never be refused by the guard, got: $ERR"
echo "$ERR" | grep -q "INVALID_RECEIVE_MODE" \
  || fail "01: expected control to reach dispatch after the guard passed through, got rc=$RC err=$ERR"
pass "01: a role that has merged the amendment is never refused by the guard, and the turn is handed to dispatch"

# ── scenario 02 (origin-ahead variant, D2): main-reference-shas must read
# whichever of `main`/`origin/main` is actually ahead, not local `main`
# alone. QA lands its approved commit by pushing HEAD:main straight to
# origin (QA's own worktree can't fast-forward the shared local main,
# checked out elsewhere), so local main can lag origin/main with a landed
# reference/ amendment. A worktree byte-identical to (stale) local main
# must still be caught, because origin/main - the actually published tip -
# has moved further. Self-contained second fixture; independent of the
# scenario 01/02 state above.
ORIGIN_ROOT2="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir ORIGIN_ROOT2
git init -q --bare -b main "$ORIGIN_ROOT2"

ROOT2="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir ROOT2
git -C "$ROOT2" init -q -b main
mkdir -p "$ROOT2/swarmforge/constitution/articles/reference"
echo "OLD: check ancestry" > "$ROOT2/$REF_REL"
printf '.swarmforge/\n' > "$ROOT2/.gitignore"
git -C "$ROOT2" add "$REF_REL" .gitignore
git -C "$ROOT2" -c user.email=t@t -c user.name=t commit -q -m base
git -C "$ROOT2" remote add origin "$ORIGIN_ROOT2"
git -C "$ROOT2" push -q origin main

git -C "$ROOT2" branch swarmforge-coder

# A second clone stands in for QA's own worktree: it pushes the amendment
# straight to origin's main, exactly as QA does - ROOT2's own local `main`
# never sees it.
QA_CLONE="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir QA_CLONE
git clone -q "$ORIGIN_ROOT2" "$QA_CLONE"
echo "NEW: verify content is gone, never ancestry" > "$QA_CLONE/$REF_REL"
git -C "$QA_CLONE" add "$REF_REL"
git -C "$QA_CLONE" -c user.email=t@t -c user.name=t commit -q -m "amend reference/ rule (landed via QA's push-to-origin path)"
git -C "$QA_CLONE" push -q origin main

git -C "$ROOT2" fetch -q origin
[[ "$(git -C "$ROOT2" rev-parse main)" != "$(git -C "$ROOT2" rev-parse origin/main)" ]] \
  || fail "02-origin-ahead: fixture sanity - local main and origin/main must have diverged"

CODER_WT2="$ROOT2/.worktrees/coder"
git -C "$ROOT2" worktree add -q "$CODER_WT2" swarmforge-coder
# The worktree's own copy matches local main (OLD) byte-for-byte - the
# defect this covers is exactly that a naive local-main-only comparison
# would call this "fresh".
[[ "$(cat "$CODER_WT2/$REF_REL")" == "OLD: check ancestry" ]] \
  || fail "02-origin-ahead: fixture sanity - worktree should still carry the pre-amendment text"

mkdir -p "$ROOT2/.swarmforge" \
         "$CODER_WT2/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT2/.swarmforge/handoffs/inbox/in_process" \
         "$CODER_WT2/.swarmforge/handoffs/inbox/completed"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\tguard-boundary-only\n' "$CODER_WT2" \
  > "$ROOT2/.swarmforge/roles.tsv"
printf 'swarm_name\tprimary\nswarm_mode\tautonomous\n' > "$ROOT2/.swarmforge/swarm-identity"

INBOX2="$CODER_WT2/.swarmforge/handoffs/inbox"
COMMIT2="$(git -C "$ROOT2" rev-parse --short=10 HEAD)"
printf 'id: resume3\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\ntask: BL-000-demo\ncommit: %s\n\nbody for resume3\n' \
  "$COMMIT2" > "$INBOX2/in_process/00_resume3.handoff"

set +e
OUT2="$(cd "$CODER_WT2" && SWARMFORGE_ROLE=coder bb "$READY" 2>"$ROOT2/stderr.txt")"
RC2=$?
set -e
ERR2="$(cat "$ROOT2/stderr.txt")"

[[ $RC2 -ne 0 ]] || fail "02-origin-ahead: expected a refusal, rc=0 out=$OUT2"
echo "$ERR2" | grep -q "STALE_REFERENCE_ELABORATION" \
  || fail "02-origin-ahead: expected a staleness report even though the worktree matches local main, got: $ERR2"
echo "$ERR2" | grep -q "$REF_REL" \
  || fail "02-origin-ahead: the report must name the stale file, got: $ERR2"
pass "02: a worktree byte-identical to local main but stale relative to a further-ahead origin/main still refuses (D2)"

echo "ALL PASS"
