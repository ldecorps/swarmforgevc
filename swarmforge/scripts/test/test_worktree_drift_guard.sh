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

echo "ALL PASS"
