#!/usr/bin/env bash
# BL-1195: pre-turn worktree-drift guard in ready_for_next.bb. A role's own
# worktree can hold tracked-file content that silently diverges from that
# worktree's own HEAD with no authoring commit (2026-08-27 incident:
# swarmforge/scripts/handoff_inject_lib.bb, handoffd.bb, and
# briefing_email_lib.bb reverted to pre-BL-1191/pre-BL-1184 content,
# uncommitted, discovered only because the coder happened to notice). This
# guard refuses the turn and reports the drift whenever no in-progress
# task explains it (scenario tracked-drift-detected-at-session-start-01);
# an in-progress task exempts everything currently modified (scenario
# genuine-wip-not-flagged-02); a clean worktree passes silently (scenario
# clean-worktree-passes-03). Covers the REAL ready_for_next.bb against a
# real git fixture (no mocked git) - same established pattern as
# test_reference_freshness_guard.sh. Prints "PASS: NN:" markers.
#
# BL-1611: scenarios 04-06 cover a BATCH role (cleaner/hardender's own
# in_process/batch_<stamp>_<seq>/ shape, BL-1313) - the flat reader this
# guard used before BL-1611 never descended into a batch_ directory, so a
# batch role mid-work always read as holding nothing and its own
# uncommitted WIP was refused as WORKTREE_DRIFT_DETECTED (the hardender hit
# this on BL-1599, 2026-09-16). The guard now reads in_process/ through the
# batch-aware reader (handoff-files-with-batches, BL-1313).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/tmp_cleanup.sh
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Same posture as test_reference_freshness_guard.sh's own install_scripts:
# give the fixture its own copy of the real scripts so ready_for_next.bb's
# git-root call resolves against the FIXTURE, never the live repo.
install_scripts() {
  local wt="$1"
  mkdir -p "$wt/swarmforge/scripts"
  cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$wt/swarmforge/scripts/"
}

DRIFT_REL="swarmforge/scripts/fixture-drift-marker.txt"

# ── fixture: a git repo with a coder worktree + swarm state ──────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir ROOT

git -C "$ROOT" init -q -b main
mkdir -p "$ROOT/swarmforge/scripts"
echo "ORIGINAL: known-good content" > "$ROOT/$DRIFT_REL"
printf '.swarmforge/\n' > "$ROOT/.gitignore"
git -C "$ROOT" add "$DRIFT_REL" .gitignore
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m base
git -C "$ROOT" branch swarmforge-coder

CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q "$CODER_WT" swarmforge-coder
install_scripts "$CODER_WT"
READY="$CODER_WT/swarmforge/scripts/ready_for_next.bb"

mkdir -p "$ROOT/.swarmforge" \
         "$CODER_WT/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$CODER_WT/.swarmforge/handoffs/inbox/completed"
# BL-640 D1's own trick, reused here: "guard-boundary-only" is not
# "task"/"batch", so dispatch_lib.bb's run-dispatch! fails closed with its
# own INVALID_RECEIVE_MODE once a turn reaches it - proof control passed
# every pre-turn guard without ever exec'ing the real dispatcher against
# this machine's live coder mailbox.
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\tguard-boundary-only\n' "$CODER_WT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'swarm_name\tprimary\nswarm_mode\tautonomous\n' > "$ROOT/.swarmforge/swarm-identity"

INBOX="$CODER_WT/.swarmforge/handoffs/inbox"

drop_handoff() {  # dir name
  printf 'id: %s\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\ntask: BL-000-demo\ncommit: 0000000000\n\nbody for %s\n' \
    "$2" "$2" > "$1/00_$2.handoff"
}

# BL-1611: a second, batch-shaped role worktree (hardender) sharing the same
# repo/fixture-drift-marker.txt.
git -C "$ROOT" branch swarmforge-hardender
HARDENDER_WT="$ROOT/.worktrees/hardender"
git -C "$ROOT" worktree add -q "$HARDENDER_WT" swarmforge-hardender
install_scripts "$HARDENDER_WT"
HARDENDER_READY="$HARDENDER_WT/swarmforge/scripts/ready_for_next.bb"
mkdir -p "$HARDENDER_WT/.swarmforge/handoffs/inbox/new" \
         "$HARDENDER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$HARDENDER_WT/.swarmforge/handoffs/inbox/completed"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\tguard-boundary-only\nhardender\thardender\t%s\tswarmforge-hardender\tHardener\tclaude\tguard-boundary-only\n' \
  "$CODER_WT" "$HARDENDER_WT" > "$ROOT/.swarmforge/roles.tsv"
# The guard resolves role-info via the WORKTREE's own toplevel (a linked
# worktree's dispatch-lib/git-root), so each worktree needs its own copy.
cp "$ROOT/.swarmforge/roles.tsv" "$CODER_WT/.swarmforge/roles.tsv"
cp "$ROOT/.swarmforge/roles.tsv" "$HARDENDER_WT/.swarmforge/roles.tsv"
HARDENDER_INBOX="$HARDENDER_WT/.swarmforge/handoffs/inbox"

drop_batch_handoff() {  # batch-dir parcel-name
  mkdir -p "$1"
  printf 'id: %s\nfrom: specifier\nto: hardender\nrecipient: hardender\npriority: 00\ntype: git_handoff\ntask: BL-000-demo\ncommit: 0000000000\n\nbody for %s\n' \
    "$2" "$2" > "$1/00_$2.handoff"
}

run_ready_hardender() {  # sets OUT, ERR, RC
  set +e
  OUT="$(cd "$HARDENDER_WT" && SWARMFORGE_ROLE=hardender bb "$HARDENDER_READY" 2>"$ROOT/stderr-hardender.txt")"
  RC=$?
  set -e
  ERR="$(cat "$ROOT/stderr-hardender.txt")"
}

run_ready() {  # sets OUT, ERR, RC
  set +e
  OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY" 2>"$ROOT/stderr.txt")"
  RC=$?
  set -e
  ERR="$(cat "$ROOT/stderr.txt")"
}

# ── scenario 03: a clean worktree passes silently ────────────────────────
run_ready
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  && fail "03: a clean worktree must never be flagged, got: $ERR"
echo "$ERR" | grep -q "INVALID_RECEIVE_MODE" \
  || fail "03: expected control to reach dispatch on a clean worktree, got rc=$RC err=$ERR"
pass "03: a worktree matching its own HEAD passes without noise"

# ── scenario 01: tracked drift, no in-progress task - refuse + report ────
echo "DRIFTED: no commit authored this" > "$CODER_WT/$DRIFT_REL"
run_ready
[[ $RC -ne 0 ]] || fail "01: expected a refusal, rc=0 out=$OUT"
echo "$OUT" | grep -q "^TASK:" && fail "01: no task may print on a refused turn: $OUT"
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  || fail "01: expected a drift report, got: $ERR"
echo "$ERR" | grep -q "$DRIFT_REL" \
  || fail "01: the report must name the drifted path, got: $ERR"
echo "$ERR" | grep -qi "stash" \
  || fail "01: the report must instruct preserving the drift via stash, got: $ERR"
[[ "$(cat "$CODER_WT/$DRIFT_REL")" == "DRIFTED: no commit authored this" ]] \
  || fail "01: the guard must never discard the drifted content itself"
pass "01: tracked drift with no in-progress task is reported, and refuses rather than proceeding"

# ── scenario 02: the SAME drift, but now with an in-progress task - the ──
# guard exempts it as that task's own presumed WIP and control still
# reaches dispatch (proven the same way scenario 03 proves it).
drop_handoff "$INBOX/in_process" "resume1"
run_ready
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  && fail "02: a role with an in-progress task must never be flagged for its own WIP, got: $ERR"
echo "$ERR" | grep -q "INVALID_RECEIVE_MODE" \
  || fail "02: expected control to reach dispatch once an in-progress task explains the drift, got rc=$RC err=$ERR"
[[ "$(cat "$CODER_WT/$DRIFT_REL")" == "DRIFTED: no commit authored this" ]] \
  || fail "02: the guard must never touch the file content either way"
pass "02: a file the role is legitimately editing for its current (in-progress) task is not flagged"

# ── BL-1611 scenario 04: a BATCH role's own uncommitted WIP, with the ────
# in-process parcel inside a batch_<stamp>_<seq>/ directory (BL-1313's own
# shape) rather than at the top level - the guard must see it, not read the
# box as empty.
echo "DRIFTED: hardender wip" > "$HARDENDER_WT/$DRIFT_REL"
drop_batch_handoff "$HARDENDER_INBOX/in_process/batch_20260917T000000Z_000001" "hardender1"
run_ready_hardender
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  && fail "04: a batch role's own uncommitted WIP with a parcel inside its batch_ directory must never be flagged, got: $ERR"
echo "$ERR" | grep -q "INVALID_RECEIVE_MODE" \
  || fail "04: expected control to reach dispatch once the batch parcel explains the drift, got rc=$RC err=$ERR"
pass "04: a batch role's in_process/batch_.../ parcel is seen by the batch-aware reader and exempts its own drift"

# ── BL-1611 scenario 05: the SAME drift, but the batch_ directory is now ──
# empty - an interrupted claim, not a held task, so nothing explains the
# drift and the guard refuses.
rm -f "$HARDENDER_INBOX/in_process/batch_20260917T000000Z_000001/00_hardender1.handoff"
run_ready_hardender
[[ $RC -ne 0 ]] || fail "05: expected a refusal, rc=0 out=$OUT"
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  || fail "05: an empty batch_ directory holds nothing, expected a drift report, got: $ERR"
pass "05: an empty batch_ directory does not count as an in-process parcel"

# ── BL-1611 scenario 06: the SAME drift, in_process holds nothing at all ──
# (no batch_ directory either) - same refusal as scenario 01, now proven
# for the batch-shaped worktree too.
rmdir "$HARDENDER_INBOX/in_process/batch_20260917T000000Z_000001"
run_ready_hardender
[[ $RC -ne 0 ]] || fail "06: expected a refusal, rc=0 out=$OUT"
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  || fail "06: an empty in_process/ holds nothing, expected a drift report, got: $ERR"
pass "06: a batch role's in_process/ with no batch_ directory at all is still judged correctly"

echo "ALL PASS"
