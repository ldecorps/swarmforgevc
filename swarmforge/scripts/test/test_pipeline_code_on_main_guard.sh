#!/usr/bin/env bash
# BL-632: a commit-time hook refuses pipeline code on `main` from any role
# but QA - the only layer that stops a bad `main` tip from existing (BL-629,
# BL-630, BL-631 all react to one that already does). Covers
# specs/features/BL-632-commit-time-guard-refuses-pipeline-code-on-main.feature
# scenarios 01-07. Follows the BL-105 fixture pattern (test_commit_size_guard.sh):
# a real throwaway repo, hooks installed via core.hooksPath, real `git
# commit`/`git merge --no-ff` attempts - never a parallel reimplementation
# of the guard's logic.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_pipeline_code_on_main.sh"
SIZE_GUARD="$SCRIPT_DIR/../check_commit_size.sh"
TICKET_GUARD="$SCRIPT_DIR/../check_ticket_deletion.sh"
PRE_COMMIT_HOOK="$SCRIPT_DIR/../../git-hooks/pre-commit"
PRE_MERGE_COMMIT_HOOK="$SCRIPT_DIR/../../git-hooks/pre-merge-commit"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/swarmforge/git-hooks"
cp "$GUARD" "$ROOT/swarmforge/scripts/check_pipeline_code_on_main.sh"
cp "$SIZE_GUARD" "$ROOT/swarmforge/scripts/check_commit_size.sh"
cp "$TICKET_GUARD" "$ROOT/swarmforge/scripts/check_ticket_deletion.sh"
cp "$PRE_COMMIT_HOOK" "$ROOT/swarmforge/git-hooks/pre-commit"
cp "$PRE_MERGE_COMMIT_HOOK" "$ROOT/swarmforge/git-hooks/pre-merge-commit"
chmod +x "$ROOT"/swarmforge/scripts/*.sh "$ROOT"/swarmforge/git-hooks/*
git -C "$ROOT" add -A
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "seed hooks"
git -C "$ROOT" config core.hooksPath swarmforge/git-hooks

commit_as() {
  # commit_as <role-or-empty>  - stages nothing itself; caller stages first.
  local role="$1"
  if [[ -n "$role" ]]; then
    (cd "$ROOT" && SWARMFORGE_ROLE="$role" git -c user.email=test@test -c user.name=test commit -q -m "change")
  else
    (cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test commit -q -m "change")
  fi
}

# ── 01: non-QA commit touching pipeline code on main is refused ───────────
mkdir -p "$ROOT/extension/src"
echo "code" > "$ROOT/extension/src/thing.ts"
git -C "$ROOT" add extension/src/thing.ts
set +e
OUT01="$(commit_as "" 2>&1)"
STATUS01=$?
set -e
[[ "$STATUS01" -ne 0 ]] || fail "01: expected refusal for non-QA commit touching extension/src/ on main"
echo "$OUT01" | grep -q "extension/src/thing.ts" || fail "01: message must name the offending path, got: $OUT01"
pass "01: a non-QA commit touching pipeline code on main is refused"
git -C "$ROOT" reset -q extension/src/thing.ts
rm -f "$ROOT/extension/src/thing.ts"

# ── 02: the same change is allowed under the QA role ───────────────────────
mkdir -p "$ROOT/extension/src"
echo "code" > "$ROOT/extension/src/thing.ts"
git -C "$ROOT" add extension/src/thing.ts
commit_as "QA" || fail "02: expected the QA role to be allowed to commit extension/src/ on main"
pass "02: the same change is allowed under the QA role"

# ── 03: a bookkeeping-only commit on main is allowed with no role set ─────
for bpath in backlog docs "specs/features" swarmforge; do
  mkdir -p "$ROOT/$bpath"
  fname="$ROOT/$bpath/bookkeeping-$(echo "$bpath" | tr '/' '-').txt"
  echo "note" > "$fname"
  git -C "$ROOT" add "$fname"
  commit_as "" || fail "03: expected a bookkeeping-only commit touching $bpath to succeed with no role set"
done
pass "03: a bookkeeping-only commit on main is allowed with no role set"

# ── 04: a commit on any branch other than main is never refused ───────────
git -C "$ROOT" checkout -q -b swarmforge-cleaner
mkdir -p "$ROOT/extension/src"
echo "code" > "$ROOT/extension/src/other.ts"
git -C "$ROOT" add extension/src/other.ts
commit_as "" || fail "04: expected extension/src/ commit to succeed on a non-main branch"
pass "04: a commit on any branch other than main is never refused by this guard"
git -C "$ROOT" checkout -q main

# ── 05: a --no-ff merge of pipeline code into main is refused ─────────────
git -C "$ROOT" checkout -q -b feature-branch
mkdir -p "$ROOT/extension/src"
echo "code" > "$ROOT/extension/src/feature.ts"
git -C "$ROOT" add extension/src/feature.ts
commit_as "" || fail "05 setup: expected the feature-branch commit itself to succeed"
git -C "$ROOT" checkout -q main
set +e
OUT05="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-ff -q -m "merge feature" feature-branch 2>&1)"
STATUS05=$?
set -e
[[ "$STATUS05" -ne 0 ]] || fail "05: expected the --no-ff merge to be refused"
echo "$OUT05" | grep -q "extension/src/feature.ts" || fail "05: merge refusal must name the offending path, got: $OUT05"
pass "05: a --no-ff merge of pipeline code into main is refused by pre-merge-commit"
git -C "$ROOT" merge --abort 2>/dev/null || true

# ── 06: the existing commit-size guard keeps firing independently ─────────
# 06a: branch guard passes on a backlog-only change; size guard still fires.
dd if=/dev/zero of="$ROOT/backlog/oversized.bin" bs=1024 count=2 >/dev/null 2>&1
git -C "$ROOT" add backlog/oversized.bin
set +e
OUT06A="$(cd "$ROOT" && env -u SWARMFORGE_ROLE bash "$ROOT/swarmforge/scripts/check_commit_size.sh" 0 2>&1)"
STATUS06A=$?
set -e
[[ "$STATUS06A" -ne 0 ]] || fail "06a: expected size guard to still refuse an oversized backlog-only file"
pass "06a: size guard still fires when the branch guard passes a backlog-only change"
git -C "$ROOT" reset -q backlog/oversized.bin
rm -f "$ROOT/backlog/oversized.bin"

# 06b: branch guard passes under QA + extension/src/; size guard still fires.
dd if=/dev/zero of="$ROOT/extension/src/oversized.ts" bs=1024 count=2 >/dev/null 2>&1
git -C "$ROOT" add extension/src/oversized.ts
set +e
OUT06B="$(cd "$ROOT" && SWARMFORGE_ROLE=QA bash "$ROOT/swarmforge/scripts/check_commit_size.sh" 0 2>&1)"
STATUS06B=$?
set -e
[[ "$STATUS06B" -ne 0 ]] || fail "06b: expected size guard to still refuse an oversized file under QA + extension/src/"
pass "06b: size guard still fires when the branch guard passes QA + extension/src/"
git -C "$ROOT" reset -q extension/src/oversized.ts
rm -f "$ROOT/extension/src/oversized.ts"

# ── 07: the refusal message states the remedy ──────────────────────────────
mkdir -p "$ROOT/specs/pipeline/steps"
echo "step" > "$ROOT/specs/pipeline/steps/thing.js"
git -C "$ROOT" add specs/pipeline/steps/thing.js
set +e
OUT07="$(commit_as "" 2>&1)"
STATUS07=$?
set -e
[[ "$STATUS07" -ne 0 ]] || fail "07: expected refusal for specs/pipeline/steps/ on main"
echo "$OUT07" | grep -qi "worktree" || fail "07: refusal message must state committing in your own worktree as the remedy, got: $OUT07"
echo "$OUT07" | grep -qi "hand" || fail "07: refusal message must state handing off through the pipeline as the remedy, got: $OUT07"
pass "07: the refusal message states the remedy"
git -C "$ROOT" reset -q specs/pipeline/steps/thing.js
rm -f "$ROOT/specs/pipeline/steps/thing.js"

# ── BL-925: importing an already-QA-published tip is not a non-QA landing ──
# CONTENT PROVENANCE, not merge-in-progress, decides the exemption - being
# mid-merge is never on its own enough (a writer could stage fresh pipeline
# edits on top of a legitimate merge and ride through on its coat-tails).
# Reuses this SAME $ROOT/main checkout (already past the BL-632 scenarios
# above, clean and on main) rather than a second fixture.
QA_REF="swarmforge-QA"
git -C "$ROOT" checkout -q main
git -C "$ROOT" tag -f bl925-checkpoint main >/dev/null

reset_bl925_fixture() {
  (cd "$ROOT" && git merge --abort 2>/dev/null) || true
  git -C "$ROOT" checkout -q main
  git -C "$ROOT" reset -q --hard bl925-checkpoint
  git -C "$ROOT" branch -D published-tip >/dev/null 2>&1 || true
  git -C "$ROOT" branch -D "$QA_REF" >/dev/null 2>&1 || true
  git -C "$ROOT" clean -fdq -- extension specs/pipeline backlog >/dev/null 2>&1 || true
}

# Standing in for origin/main: one commit, touching BOTH QA-exclusive paths
# this guard protects, with swarmforge-QA pointed at that same tip - trivially
# its own ancestor (git merge-base --is-ancestor considers a commit its own
# ancestor).
make_published_tip() {
  git -C "$ROOT" branch -f published-tip main >/dev/null
  git -C "$ROOT" checkout -q published-tip
  mkdir -p "$ROOT/extension/src" "$ROOT/specs/pipeline/steps"
  echo "published code" > "$ROOT/extension/src/published.ts"
  echo "published step" > "$ROOT/specs/pipeline/steps/published.js"
  git -C "$ROOT" add extension/src/published.ts specs/pipeline/steps/published.js
  git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "QA lands published tip"
  git -C "$ROOT" branch -f "$QA_REF" published-tip >/dev/null
  git -C "$ROOT" checkout -q main
}

make_ahead_bookkeeping_commit() {
  local n="$1"
  mkdir -p "$ROOT/backlog"
  echo "bookkeeping $n" > "$ROOT/backlog/bookkeeping-$n.txt"
  git -C "$ROOT" add "backlog/bookkeeping-$n.txt"
  commit_as ""
}

# ── BL-925 provenance-01a: unchanged import of an already-QA-published tip
#    is allowed ─────────────────────────────────────────────────────────────
reset_bl925_fixture
make_published_tip
make_ahead_bookkeeping_commit "925a"
set +e
OUT925A="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-edit published-tip 2>&1)"
STATUS925A=$?
set -e
[[ "$STATUS925A" -eq 0 ]] || fail "BL-925 provenance-01a: expected the merge of an already-QA-published tip to succeed, got: $OUT925A"
[[ -f "$ROOT/extension/src/published.ts" ]] || fail "BL-925 provenance-01a: expected the published file to land on main after the merge"
pass "BL-925 provenance-01a: a merge that only imports an already-QA-published tip, unchanged, is allowed"

# ── BL-925 provenance-01b: newly-authored pipeline content (no merge at
#    all) is still refused exactly as before - the guard's original
#    behaviour is untouched outside the merge-import case ─────────────────
reset_bl925_fixture
make_ahead_bookkeeping_commit "925b"
mkdir -p "$ROOT/extension/src"
echo "freshly authored, not from any merge" > "$ROOT/extension/src/fresh.ts"
git -C "$ROOT" add extension/src/fresh.ts
set +e
OUT925B="$(commit_as "" 2>&1)"
STATUS925B=$?
set -e
[[ "$STATUS925B" -ne 0 ]] || fail "BL-925 provenance-01b: expected freshly-authored pipeline content with no merge in progress to be refused"
echo "$OUT925B" | grep -q "extension/src/fresh.ts" || fail "BL-925 provenance-01b: refusal must name the offending path, got: $OUT925B"
git -C "$ROOT" reset -q extension/src/fresh.ts
rm -f "$ROOT/extension/src/fresh.ts"
pass "BL-925 provenance-01b: newly-authored pipeline content with no merge in progress is still refused"

# ── BL-925 provenance-01c (invariant 1, most important negative): an edit
#    staged ON TOP OF a legitimate merge of a published tip - content that
#    differs from what the published parent holds - is still refused. Being
#    mid-merge is never on its own sufficient. ──────────────────────────────
reset_bl925_fixture
make_published_tip
make_ahead_bookkeeping_commit "925c"
(cd "$ROOT" && env -u SWARMFORGE_ROLE git merge --no-commit --no-ff -q published-tip)
echo "extra edit riding the merge's coat-tails" > "$ROOT/extension/src/published.ts"
git -C "$ROOT" add extension/src/published.ts
set +e
OUT925C="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test commit -q -m "merge + extra edit" 2>&1)"
STATUS925C=$?
set -e
[[ "$STATUS925C" -ne 0 ]] || fail "BL-925 provenance-01c: expected an edit riding the merge's coat-tails to be refused"
echo "$OUT925C" | grep -q "extension/src/published.ts" || fail "BL-925 provenance-01c: refusal must name the offending path, got: $OUT925C"
(cd "$ROOT" && git merge --abort 2>/dev/null) || true
pass "BL-925 provenance-01c: an edit staged on top of the merge (content differs from the published parent) is still refused"

# ── BL-925 both-hooks-agree-02: the merge completes whichever hook fires ───
reset_bl925_fixture
make_published_tip
make_ahead_bookkeeping_commit "925d"
set +e
OUT925D="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-edit published-tip 2>&1)"
STATUS925D=$?
set -e
[[ "$STATUS925D" -eq 0 ]] || fail "BL-925 both-hooks-agree-02 (merge --no-edit / pre-merge-commit): expected success, got: $OUT925D"
pass "BL-925 both-hooks-agree-02: completing the merge via 'git merge --no-edit' (pre-merge-commit hook path) is allowed"

reset_bl925_fixture
make_published_tip
make_ahead_bookkeeping_commit "925e"
(cd "$ROOT" && env -u SWARMFORGE_ROLE git merge --no-commit --no-ff -q published-tip)
set +e
OUT925E="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test commit --no-edit -q 2>&1)"
STATUS925E=$?
set -e
[[ "$STATUS925E" -eq 0 ]] || fail "BL-925 both-hooks-agree-02 (commit --no-edit / pre-commit): expected success, got: $OUT925E"
pass "BL-925 both-hooks-agree-02: completing the merge via 'git commit --no-edit' (pre-commit hook path) is also allowed"

# ── BL-925 real-conflict-still-aborts-03: a genuine content conflict still
#    fails the merge and leaves no half-finished merge behind - BL-891's own
#    invariant is unchanged by anything here ───────────────────────────────
reset_bl925_fixture
mkdir -p "$ROOT/backlog"
echo "shared original" > "$ROOT/backlog/shared.txt"
git -C "$ROOT" add backlog/shared.txt
commit_as ""
git -C "$ROOT" branch -f published-tip main >/dev/null
git -C "$ROOT" checkout -q published-tip
echo "QA changed this line" > "$ROOT/backlog/shared.txt"
git -C "$ROOT" add backlog/shared.txt
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "QA edits shared.txt"
git -C "$ROOT" branch -f "$QA_REF" published-tip >/dev/null
git -C "$ROOT" checkout -q main
echo "local checkout also changed this line" > "$ROOT/backlog/shared.txt"
git -C "$ROOT" add backlog/shared.txt
commit_as ""
set +e
OUT925F="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-edit published-tip 2>&1)"
STATUS925F=$?
set -e
[[ "$STATUS925F" -ne 0 ]] || fail "BL-925 real-conflict-still-aborts-03: expected a genuine content conflict to fail the merge"
(cd "$ROOT" && git merge --abort 2>/dev/null) || true
CLEAN925F="$(git -C "$ROOT" status --porcelain)"
[[ -z "$CLEAN925F" ]] || fail "BL-925 real-conflict-still-aborts-03: expected a clean working tree after abort, got: $CLEAN925F"
[[ ! -f "$ROOT/.git/MERGE_HEAD" ]] || fail "BL-925 real-conflict-still-aborts-03: expected no merge in progress after abort"
pass "BL-925 real-conflict-still-aborts-03: a real conflict still fails the merge and leaves no half-finished merge after abort"

# ── BL-925 unpublished-tip-is-not-waved-through-05: a merge parent QA has
#    not published (not an ancestor of swarmforge-QA) is refused ─────────
reset_bl925_fixture
git -C "$ROOT" branch -f published-tip main >/dev/null
git -C "$ROOT" checkout -q published-tip
mkdir -p "$ROOT/extension/src"
echo "not yet QA-approved" > "$ROOT/extension/src/unpublished.ts"
git -C "$ROOT" add extension/src/unpublished.ts
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "not yet QA-approved"
git -C "$ROOT" checkout -q main
make_ahead_bookkeeping_commit "925g"
set +e
OUT925G="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-edit published-tip 2>&1)"
STATUS925G=$?
set -e
[[ "$STATUS925G" -ne 0 ]] || fail "BL-925 unpublished-tip-is-not-waved-through-05: expected a merge of a non-QA-ancestor pipeline-code tip to be refused"
echo "$OUT925G" | grep -q "extension/src/unpublished.ts" || fail "BL-925 unpublished-tip-is-not-waved-through-05: refusal must name the offending path, got: $OUT925G"
(cd "$ROOT" && git merge --abort 2>/dev/null) || true
pass "BL-925 unpublished-tip-is-not-waved-through-05: a merge parent that is NOT an ancestor of swarmforge-QA is refused, naming the offending paths"

reset_bl925_fixture

# ── extra: --list-paths surface, for a future consumer to read the same
#           QA-exclusive set instead of hand-copying the literals ─────────
LIST_OUT="$(bash "$GUARD" --list-paths)"
echo "$LIST_OUT" | grep -qx "extension/src/" || fail "list-paths: expected extension/src/ in output"
echo "$LIST_OUT" | grep -qx "extension/test/" || fail "list-paths: expected extension/test/ in output"
echo "$LIST_OUT" | grep -qx "specs/pipeline/steps/" || fail "list-paths: expected specs/pipeline/steps/ in output"
pass "extra: --list-paths publishes the QA-exclusive path set for external consumers"

echo "ALL PASS"
