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
IS_QA_ANCESTOR="$SCRIPT_DIR/../is_qa_ancestor.sh"
PRE_COMMIT_HOOK="$SCRIPT_DIR/../../git-hooks/pre-commit"
PRE_MERGE_COMMIT_HOOK="$SCRIPT_DIR/../../git-hooks/pre-merge-commit"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email test@test
git -C "$ROOT" config user.name test
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/swarmforge/git-hooks"
cp "$GUARD" "$ROOT/swarmforge/scripts/check_pipeline_code_on_main.sh"
cp "$SIZE_GUARD" "$ROOT/swarmforge/scripts/check_commit_size.sh"
cp "$TICKET_GUARD" "$ROOT/swarmforge/scripts/check_ticket_deletion.sh"
cp "$SCRIPT_DIR/../check_property_suite_drift.sh" "$ROOT/swarmforge/scripts/check_property_suite_drift.sh"
cp "$SCRIPT_DIR/../property_suite_shared_repo_guard.sh" "$ROOT/swarmforge/scripts/property_suite_shared_repo_guard.sh"
cp "$SCRIPT_DIR/../incoming_merge_parent_lib.sh" "$ROOT/swarmforge/scripts/incoming_merge_parent_lib.sh"
# What the hooks EXECUTE and SOURCE. BL-1252 moved pre-commit's guards behind
# run_commit_guards.sh and BL-1303 gave pre-merge-commit a chain of its own
# over the same sourced aggregation; without them the hook dies before any
# guard decides anything and every case below fails for that reason instead.
cp "$SCRIPT_DIR/../run_commit_guards.sh" "$ROOT/swarmforge/scripts/run_commit_guards.sh"
cp "$SCRIPT_DIR/../commit_guard_chain_lib.sh" "$ROOT/swarmforge/scripts/commit_guard_chain_lib.sh"
cp "$SCRIPT_DIR/../check_feature_handler_registration.sh" "$ROOT/swarmforge/scripts/check_feature_handler_registration.sh"
cp "$SCRIPT_DIR/../property_suite_standing_allowlist_lib.sh" "$ROOT/swarmforge/scripts/property_suite_standing_allowlist_lib.sh"
# An EMPTY step registry, so BL-1303's guard asks its real question here -
# nothing in this fixture is unrunnable - rather than refusing every action
# because a repo with no acceptance pipeline has no registry to read. Its
# compiled checker is resolved relative to the guard's own script dir, so
# link the real out tree beside the copied guard.
mkdir -p "$ROOT/specs/pipeline/steps" "$ROOT/extension"
printf 'module.exports = [];\n' > "$ROOT/specs/pipeline/steps/index.js"
ln -s "$SCRIPT_DIR/../../../extension/out" "$ROOT/extension/out" 2>/dev/null || true
cp "$IS_QA_ANCESTOR" "$ROOT/swarmforge/scripts/is_qa_ancestor.sh"
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

# ── BL-925 descendant-of-qa-tip-is-not-waved-through-06 (direction check):
#    a commit built ON TOP OF an already-published tip - so swarmforge-QA IS
#    an ancestor of it, but it is NOT an ancestor of swarmforge-QA - is still
#    refused. is_qa_ancestor.sh's ancestry direction is `git merge-base
#    --is-ancestor "$SHA" swarmforge-QA` (is the incoming commit AT OR BEFORE
#    the published tip); the reversed direction (is swarmforge-QA at or
#    before the incoming commit) would wrongly wave through anything newer
#    than an old approved base. unpublished-tip-05 above cannot catch a
#    swapped-argument regression here: it merges a commit unrelated to
#    swarmforge-QA, so neither direction finds an ancestor and both refuse
#    for the same (right) reason. This scenario is related by construction -
#    only the correct direction refuses it. ──────────────────────────────
reset_bl925_fixture
make_published_tip
git -C "$ROOT" checkout -q published-tip
mkdir -p "$ROOT/extension/src"
echo "built on the old approved tip, never itself approved" > "$ROOT/extension/src/unapproved-descendant.ts"
git -C "$ROOT" add extension/src/unapproved-descendant.ts
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "descendant of the published tip, not itself QA-approved"
git -C "$ROOT" branch -f unapproved-descendant HEAD >/dev/null
git -C "$ROOT" checkout -q main
make_ahead_bookkeeping_commit "925h"
set +e
OUT925H="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-edit unapproved-descendant 2>&1)"
STATUS925H=$?
set -e
[[ "$STATUS925H" -ne 0 ]] || fail "BL-925 descendant-of-qa-tip-is-not-waved-through-06: expected a commit descending from (but not itself an ancestor of) swarmforge-QA to be refused"
echo "$OUT925H" | grep -q "extension/src/unapproved-descendant.ts" || fail "BL-925 descendant-of-qa-tip-is-not-waved-through-06: refusal must name the offending path, got: $OUT925H"
(cd "$ROOT" && git merge --abort 2>/dev/null) || true
git -C "$ROOT" branch -D unapproved-descendant >/dev/null 2>&1 || true
pass "BL-925 descendant-of-qa-tip-is-not-waved-through-06: a commit built on top of the published tip, but not itself QA-approved, is still refused"

reset_bl925_fixture

# ── extra: --list-paths surface, for a future consumer to read the same
#           QA-exclusive set instead of hand-copying the literals ─────────
LIST_OUT="$(bash "$GUARD" --list-paths)"
echo "$LIST_OUT" | grep -qx "extension/src/" || fail "list-paths: expected extension/src/ in output"
echo "$LIST_OUT" | grep -qx "extension/test/" || fail "list-paths: expected extension/test/ in output"
echo "$LIST_OUT" | grep -qx "specs/pipeline/steps/" || fail "list-paths: expected specs/pipeline/steps/ in output"
pass "extra: --list-paths publishes the QA-exclusive path set for external consumers"

# ── BL-925 invariant 2: one definition of "QA-approved tip", not two ──────
# check_pipeline_code_on_main.sh (bash) and handoffd.bb (Babashka) must both
# call is_qa_ancestor.sh rather than each running its own `git merge-base
# --is-ancestor ... swarmforge-QA` - a "kept in sync" pair of independent
# invocations is exactly what invariant 2 forbids. This does not re-verify
# ancestry semantics (provenance-01a/both-hooks-agree-02/unpublished-tip-05
# above already do that against the real script); it only pins the
# extraction itself, so a future edit that quietly re-inlines the git call
# in one file without the other fails loudly here instead of drifting
# silently.
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
grep -q "is_qa_ancestor.sh" "$GUARD" \
  || fail "BL-925 invariant 2: check_pipeline_code_on_main.sh no longer calls is_qa_ancestor.sh"
grep -q "is_qa_ancestor.sh" "$HANDOFFD" \
  || fail "BL-925 invariant 2: handoffd.bb no longer calls is_qa_ancestor.sh"
# Neither file may ALSO run its own independent `git merge-base
# --is-ancestor ... swarmforge-QA` outside of is_qa_ancestor.sh's own body -
# that would be exactly the divergent second definition invariant 2 forbids,
# even with the shared script still present and called.
grep -q 'merge-base.*--is-ancestor.*swarmforge-QA' "$GUARD" \
  && fail "BL-925 invariant 2: check_pipeline_code_on_main.sh still runs its own inline ancestry git call"
grep -q '"merge-base".*"--is-ancestor"' "$HANDOFFD" \
  && fail "BL-925 invariant 2: handoffd.bb still runs its own inline ancestry git call"
pass "BL-925 invariant2-one-shared-definition: both the bash guard and handoffd.bb call is_qa_ancestor.sh, not a second independent ancestry check"

# ── BL-1096: exemption anchors per path, not the incoming merge tip ────────
# Multi-hop shape: QA landing, then bookkeeping on origin so the TIP is not
# a QA ancestor, while each pipeline path's last-touching incoming commit is.
make_multi_hop_published_origin() {
  make_published_tip
  QA_LANDING="$(git -C "$ROOT" rev-parse published-tip)"
  git -C "$ROOT" checkout -q published-tip
  make_ahead_bookkeeping_commit "1096-hop1"
  make_ahead_bookkeeping_commit "1096-hop2"
  git -C "$ROOT" branch -f "$QA_REF" "$QA_LANDING" >/dev/null
  git -C "$ROOT" checkout -q main
}

# ── BL-1096 multi-hop-import-completes-01 (pre-merge-commit path) ──────────
reset_bl925_fixture
make_multi_hop_published_origin
make_ahead_bookkeeping_commit "1096-local-a"
set +e
OUT1096A="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-edit published-tip 2>&1)"
STATUS1096A=$?
set -e
[[ "$STATUS1096A" -eq 0 ]] || fail "BL-1096 multi-hop-import-completes-01: expected merge when tip is bookkeeping but paths are QA-published, got: $OUT1096A"
echo "$OUT1096A" | grep -qi "refused\|pipeline code" && fail "BL-1096 multi-hop-import-completes-01: refusal leaked into a successful merge: $OUT1096A"
[[ -f "$ROOT/extension/src/published.ts" ]] || fail "BL-1096 multi-hop-import-completes-01: published pipeline file missing after merge"
pass "BL-1096 multi-hop-import-completes-01: the join completes when the incoming tip is not itself a QA landing"

# ── BL-1096 multi-hop via pre-commit (git commit --no-edit) ────────────────
reset_bl925_fixture
make_multi_hop_published_origin
make_ahead_bookkeeping_commit "1096-local-b"
(cd "$ROOT" && env -u SWARMFORGE_ROLE git merge --no-commit --no-ff -q published-tip)
set +e
OUT1096B="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test commit --no-edit -q 2>&1)"
STATUS1096B=$?
set -e
[[ "$STATUS1096B" -eq 0 ]] || fail "BL-1096 multi-hop pre-commit: expected commit --no-edit to succeed, got: $OUT1096B"
pass "BL-1096 multi-hop-import-completes-01 (pre-commit): completing the multi-hop merge via git commit --no-edit is allowed"

# ── BL-1096 per-path: QA-published last-touch → allowed ───────────────────
# Covered by multi-hop-01 above (both pipeline paths last-touched at landing).
pass "BL-1096 per-path: last touched by a commit QA published → allowed"

# ── BL-1096 per-path: never-published last-touch → refused (sibling allowed)
reset_bl925_fixture
make_published_tip
QA_LANDING="$(git -C "$ROOT" rev-parse published-tip)"
git -C "$ROOT" checkout -q published-tip
mkdir -p "$ROOT/extension/src"
echo "never published on this path" > "$ROOT/extension/src/unpublished-sibling.ts"
git -C "$ROOT" add extension/src/unpublished-sibling.ts
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "non-QA pipeline path on origin"
make_ahead_bookkeeping_commit "1096-hop-mix"
git -C "$ROOT" branch -f "$QA_REF" "$QA_LANDING" >/dev/null
git -C "$ROOT" checkout -q main
make_ahead_bookkeeping_commit "1096-local-mix"
set +e
OUT1096MIX="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-edit published-tip 2>&1)"
STATUS1096MIX=$?
set -e
[[ "$STATUS1096MIX" -ne 0 ]] || fail "BL-1096 per-path never-published: expected refusal when one path is unpublished"
echo "$OUT1096MIX" | grep -q "extension/src/unpublished-sibling.ts" || fail "BL-1096 per-path never-published: must name unpublished path, got: $OUT1096MIX"
echo "$OUT1096MIX" | grep -q "extension/src/published.ts" && fail "BL-1096 per-path never-published: must NOT name the QA-published sibling, got: $OUT1096MIX"
echo "$OUT1096MIX" | grep -q "specs/pipeline/steps/published.js" && fail "BL-1096 per-path never-published: must NOT name the QA-published step sibling, got: $OUT1096MIX"
(cd "$ROOT" && git merge --abort 2>/dev/null) || true
pass "BL-1096 per-path: last touched by a commit QA never published → refused"

# ── BL-1096 per-path: published then bounced → refused ────────────────────
reset_bl925_fixture
make_multi_hop_published_origin
LANDING_SHA="$(git -C "$ROOT" rev-parse "$QA_REF")"
mkdir -p "$ROOT/.swarmforge/bounces"
printf '{"at":"2026-08-24T00:00:00Z","commit":"%s","by":"QA","role":"coder","failure_class":"correctness","ticket":"BL-1096"}\n' "${LANDING_SHA:0:10}" \
  > "$ROOT/.swarmforge/bounces/2026-08.jsonl"
make_ahead_bookkeeping_commit "1096-local-bounce"
set +e
OUT1096BOUNCE="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-edit published-tip 2>&1)"
STATUS1096BOUNCE=$?
set -e
[[ "$STATUS1096BOUNCE" -ne 0 ]] || fail "BL-1096 per-path bounced: expected refusal when path anchor is bounced"
echo "$OUT1096BOUNCE" | grep -Eq "extension/src/published\.ts|specs/pipeline/steps/published\.js" \
  || fail "BL-1096 per-path bounced: must name a bounced pipeline path, got: $OUT1096BOUNCE"
(cd "$ROOT" && git merge --abort 2>/dev/null) || true
rm -rf "$ROOT/.swarmforge/bounces"
pass "BL-1096 per-path: last touched by a commit QA published and then bounced → refused"

# ── BL-1096 per-path: absent from incoming history → refused ──────────────
reset_bl925_fixture
make_multi_hop_published_origin
make_ahead_bookkeeping_commit "1096-local-absent"
(cd "$ROOT" && env -u SWARMFORGE_ROLE git merge --no-commit --no-ff -q published-tip)
mkdir -p "$ROOT/specs/pipeline/steps"
echo "local only, never on incoming" > "$ROOT/specs/pipeline/steps/local-only.js"
git -C "$ROOT" add specs/pipeline/steps/local-only.js
set +e
OUT1096ABSENT="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test commit -q -m "merge + local-only path" 2>&1)"
STATUS1096ABSENT=$?
set -e
[[ "$STATUS1096ABSENT" -ne 0 ]] || fail "BL-1096 per-path absent: expected refusal for path with no incoming history"
echo "$OUT1096ABSENT" | grep -q "specs/pipeline/steps/local-only.js" || fail "BL-1096 per-path absent: must name the local-only path, got: $OUT1096ABSENT"
echo "$OUT1096ABSENT" | grep -q "extension/src/published.ts" && fail "BL-1096 per-path absent: must NOT name imported paths, got: $OUT1096ABSENT"
(cd "$ROOT" && git merge --abort 2>/dev/null) || true
pass "BL-1096 per-path: absent from the incoming side's history → refused"

# ── BL-1096 per-path: undeterminable predicate → refused ──────────────────
reset_bl925_fixture
make_multi_hop_published_origin
# Obstruct the bounce store directory (file where dir belongs) → exit neither 0 nor 1.
mkdir -p "$ROOT/.swarmforge"
printf 'not a directory\n' > "$ROOT/.swarmforge/bounces"
make_ahead_bookkeeping_commit "1096-local-undet"
set +e
OUT1096UNDET="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test merge --no-edit published-tip 2>&1)"
STATUS1096UNDET=$?
set -e
[[ "$STATUS1096UNDET" -ne 0 ]] || fail "BL-1096 per-path undeterminable: expected refusal when is_qa_ancestor cannot answer"
(cd "$ROOT" && git merge --abort 2>/dev/null) || true
rm -f "$ROOT/.swarmforge/bounces"
pass "BL-1096 per-path: undeterminable, the approval predicate cannot answer → refused"

# ── BL-1096 fresh-edit-still-refused-03 ───────────────────────────────────
reset_bl925_fixture
make_multi_hop_published_origin
make_ahead_bookkeeping_commit "1096-local-edit"
(cd "$ROOT" && env -u SWARMFORGE_ROLE git merge --no-commit --no-ff -q published-tip)
echo "fresh edit on top of multi-hop import" > "$ROOT/extension/src/published.ts"
git -C "$ROOT" add extension/src/published.ts
set +e
OUT1096EDIT="$(cd "$ROOT" && env -u SWARMFORGE_ROLE git -c user.email=test@test -c user.name=test commit -q -m "merge + fresh edit" 2>&1)"
STATUS1096EDIT=$?
set -e
[[ "$STATUS1096EDIT" -ne 0 ]] || fail "BL-1096 fresh-edit-03: expected refusal for edit on top of multi-hop import"
echo "$OUT1096EDIT" | grep -q "extension/src/published.ts" || fail "BL-1096 fresh-edit-03: must name the edited path, got: $OUT1096EDIT"
echo "$OUT1096EDIT" | grep -q "specs/pipeline/steps/published.js" && fail "BL-1096 fresh-edit-03: must NOT name the untouched import, got: $OUT1096EDIT"
(cd "$ROOT" && git merge --abort 2>/dev/null) || true
pass "BL-1096 fresh-edit-still-refused-03: the edited path is refused and the imported paths are not"

reset_bl925_fixture

echo "ALL PASS"
