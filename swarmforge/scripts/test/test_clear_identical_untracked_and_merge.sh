#!/usr/bin/env bash
# BL-924: proves clear_identical_untracked_and_merge.bb against REAL
# throwaway git fixture repos - the whole defect (git refusing to overwrite
# an untracked file even when it is byte-identical to the incoming tracked
# content) only exists inside a real git index, never a mock. The pure
# plan-untracked-collision-clear decision is unit-tested directly in
# untracked_collision_clear_lib_test_runner.bb; this file proves the real
# git-untracked-vs-tracked wiring end to end, same shape as BL-373's own
# test_sync_worktree_scripts_never_clobbers.sh.
#
# Fixture discipline (per the ticket's own notes): every fixture lives
# under this test's own mktemp root, never a live .worktrees/ path - the
# defect being reproduced requires deleting files to recover from, and a
# fixture reaching a live worktree could delete real work.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOL="$SWARM_SCRIPTS/clear_identical_untracked_and_merge.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

git_c() { git -c user.email=t@t -c user.name=t "$@"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

mk_repo_with_diverged_role() {
  # main tracks foo.sh from the start; a role branch diverges before main
  # later adds bar.sh and baz.sh - the exact "role branch is behind main"
  # shape a real relaunch's sync_worktree_scripts() then hot-syncs
  # untracked copies of bar.sh/baz.sh into (BL-373's own mechanism).
  local root="$1"
  mkdir -p "$root/swarmforge/scripts"
  echo "echo foo" > "$root/swarmforge/scripts/foo.sh"
  (cd "$root" && git init -q -b main && git_c add -A && git_c commit -q -m init)
  # The role branch's pointer is created now, at the init commit - before
  # main gets bar.sh/baz.sh - but not checked out into a worktree yet: a
  # linked worktree's own .git FILE would otherwise be picked up by the
  # next `git add -A` at the top level as a spurious "embedded git
  # repository" (harmless, but noisy). The actual worktree checkout is
  # deferred to the end of this function, after every top-level commit.
  (cd "$root" && git branch role)
  echo "echo bar" > "$root/swarmforge/scripts/bar.sh"
  echo "echo baz" > "$root/swarmforge/scripts/baz.sh"
  (cd "$root" && git_c add -A && git_c commit -q -m "main: add bar.sh and baz.sh")
  (cd "$root" && git worktree add -q .worktrees/role role)
}

# ═══════════════════════════════════════════════════════════════════════
# Scenario 01 (identical): every collision matches main's tracked bytes -
# the merge completes with no manual clearing.
# ═══════════════════════════════════════════════════════════════════════

mk_repo_with_diverged_role "$ROOT"
WT="$ROOT/.worktrees/role"
# Hot-sync simulation: untracked copies, byte-identical to main's tracked content.
(cd "$ROOT" && git show main:swarmforge/scripts/bar.sh) > "$WT/swarmforge/scripts/bar.sh"
(cd "$ROOT" && git show main:swarmforge/scripts/baz.sh) > "$WT/swarmforge/scripts/baz.sh"

RAW_MERGE_OUT="$(cd "$WT" && git merge main --no-edit 2>&1)" && fail "01: expected the RAW git merge to be refused (sanity check on the fixture), it succeeded: $RAW_MERGE_OUT" || true
echo "$RAW_MERGE_OUT" | grep -q "would be overwritten by merge" \
  || fail "01: expected the raw merge's own refusal message, got: $RAW_MERGE_OUT"
pass "01 sanity: the raw git merge is refused by identical untracked copies, reproducing the defect"

OUT="$(bb "$TOOL" "$WT" main 2>&1)" || fail "01: expected the tool to succeed on all-identical collisions, got: $OUT"
echo "$OUT" | grep -q "cleared (byte-identical to main): swarmforge/scripts/bar.sh" \
  || fail "01: expected bar.sh reported cleared, got: $OUT"
echo "$OUT" | grep -q "cleared (byte-identical to main): swarmforge/scripts/baz.sh" \
  || fail "01: expected baz.sh reported cleared, got: $OUT"
pass "01: identical untracked copies are cleared and the merge completes with no manual clearing"

# ── Scenario "02" (qa_e2e step 2): merged content matches main exactly ──
[[ "$(cat "$WT/swarmforge/scripts/bar.sh")" == "echo bar" ]] || fail "02: expected bar.sh to match main's content after the merge"
[[ "$(cat "$WT/swarmforge/scripts/baz.sh")" == "echo baz" ]] || fail "02: expected baz.sh to match main's content after the merge"
[[ -z "$(cd "$WT" && git status --short)" ]] || fail "02: expected a clean worktree after the merge, got: $(cd "$WT" && git status --short)"
pass "02: the merged worktree's file contents match main exactly, and the worktree is clean"

# ═══════════════════════════════════════════════════════════════════════
# Scenario 03/04 (differs): one modified untracked copy refuses the merge,
# nothing is cleared, nothing is merged, the modified content survives.
# ═══════════════════════════════════════════════════════════════════════

ROOT2="$(mktemp -d)"
trap 'rm -rf "$ROOT" "$ROOT2"' EXIT
mk_repo_with_diverged_role "$ROOT2"
WT2="$ROOT2/.worktrees/role"
(cd "$ROOT2" && git show main:swarmforge/scripts/bar.sh) > "$WT2/swarmforge/scripts/bar.sh"
echo "echo baz LOCALLY MODIFIED" > "$WT2/swarmforge/scripts/baz.sh"
BEFORE_HEAD="$(cd "$WT2" && git rev-parse HEAD)"

OUT2="$(bb "$TOOL" "$WT2" main 2>&1)" && fail "03: expected the tool to refuse when a copy differs, it exited 0: $OUT2" || true
echo "$OUT2" | grep -q "swarmforge/scripts/baz.sh" \
  || fail "03: expected the refusal to name baz.sh, got: $OUT2"
echo "$OUT2" | grep -q "swarmforge/scripts/bar.sh" \
  && fail "03: expected the refusal to NOT name bar.sh (it is identical, not the blocker), got: $OUT2" || true
pass "03: a differing untracked copy refuses the merge rather than overwriting it"

[[ "$(cat "$WT2/swarmforge/scripts/baz.sh")" == "echo baz LOCALLY MODIFIED" ]] \
  || fail "03: expected the modified content to still be there after the refusal"
[[ "$(cd "$WT2" && git rev-parse HEAD)" == "$BEFORE_HEAD" ]] \
  || fail "03: expected no merge to have happened (HEAD unchanged) after the refusal"
[[ -f "$WT2/swarmforge/scripts/bar.sh" ]] \
  || fail "03: expected bar.sh (the identical one) to be untouched, not pre-emptively cleared, on refusal"
pass "03: the modified content and the identical copy both survive the refusal - nothing was cleared, nothing was merged"

# ═══════════════════════════════════════════════════════════════════════
# Scenario 04 (several differ): one report names EVERY colliding path,
# never an iterative "... N more" discovery loop.
# ═══════════════════════════════════════════════════════════════════════

ROOT3="$(mktemp -d)"
trap 'rm -rf "$ROOT" "$ROOT2" "$ROOT3"' EXIT
mk_repo_with_diverged_role "$ROOT3"
WT3="$ROOT3/.worktrees/role"
echo "echo bar LOCALLY MODIFIED" > "$WT3/swarmforge/scripts/bar.sh"
echo "echo baz LOCALLY MODIFIED" > "$WT3/swarmforge/scripts/baz.sh"

OUT3="$(bb "$TOOL" "$WT3" main 2>&1)" && fail "04: expected the tool to refuse, it exited 0: $OUT3" || true
echo "$OUT3" | grep -q "swarmforge/scripts/bar.sh" || fail "04: expected bar.sh named in the one refusal, got: $OUT3"
echo "$OUT3" | grep -q "swarmforge/scripts/baz.sh" || fail "04: expected baz.sh named in the SAME refusal (not a second round), got: $OUT3"
pass "04: a single refusal names every colliding path at once, no elision, no second discovery round"

# ═══════════════════════════════════════════════════════════════════════
# Scenario 05/invariant 2: an untracked file whose content is on no
# branch at all is never touched - it is not even a candidate.
# ═══════════════════════════════════════════════════════════════════════

ROOT4="$(mktemp -d)"
trap 'rm -rf "$ROOT" "$ROOT2" "$ROOT3" "$ROOT4"' EXIT
mk_repo_with_diverged_role "$ROOT4"
WT4="$ROOT4/.worktrees/role"
(cd "$ROOT4" && git show main:swarmforge/scripts/bar.sh) > "$WT4/swarmforge/scripts/bar.sh"
(cd "$ROOT4" && git show main:swarmforge/scripts/baz.sh) > "$WT4/swarmforge/scripts/baz.sh"
echo "irreplaceable scratch notes, on no branch" > "$WT4/swarmforge/scripts/my_local_notes.txt"

OUT4="$(bb "$TOOL" "$WT4" main 2>&1)" || fail "05: expected the tool to succeed (the notes file is not a collision), got: $OUT4"
[[ "$(cat "$WT4/swarmforge/scripts/my_local_notes.txt")" == "irreplaceable scratch notes, on no branch" ]] \
  || fail "05: expected the no-branch-content file to survive untouched"
echo "$OUT4" | grep -q "my_local_notes.txt" && fail "05: expected the notes file to never even be mentioned - it was never a candidate" || true
pass "05: an untracked file whose content is on no branch is left in place, untouched - invariant 2"

echo "ALL PASS"
