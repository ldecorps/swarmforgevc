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
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
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
[[ $RC -eq 0 ]] || fail "01: expected the turn to proceed after merging main, rc=$RC err=$ERR"
echo "$OUT" | grep -q "^TASK:" || fail "01: expected the claim to print, got: $OUT"
[[ -z "$ERR" ]] || fail "01: a fresh worktree must emit no staleness warning, got: $ERR"
pass "01: a role that has merged the amendment reads it and the turn proceeds untouched"

echo "ALL PASS"
