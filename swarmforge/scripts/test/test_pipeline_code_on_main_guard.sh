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

# ── extra: --list-paths surface, for a future consumer to read the same
#           QA-exclusive set instead of hand-copying the literals ─────────
LIST_OUT="$(bash "$GUARD" --list-paths)"
echo "$LIST_OUT" | grep -qx "extension/src/" || fail "list-paths: expected extension/src/ in output"
echo "$LIST_OUT" | grep -qx "extension/test/" || fail "list-paths: expected extension/test/ in output"
echo "$LIST_OUT" | grep -qx "specs/pipeline/steps/" || fail "list-paths: expected specs/pipeline/steps/ in output"
pass "extra: --list-paths publishes the QA-exclusive path set for external consumers"

echo "ALL PASS"
