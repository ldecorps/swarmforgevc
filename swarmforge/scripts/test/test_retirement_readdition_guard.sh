#!/usr/bin/env bash
# BL-1258: the addition-side twin of check_merge_deletion.sh (BL-1242) -
# refuses a merge that silently re-adds a retired ticket's artefacts, per
# the retirement_registry_lib.bb ref every worktree can read without
# merging anything.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_retirement_readdition.sh"
TICKET_GUARD="$SCRIPT_DIR/../check_ticket_deletion.sh"
MERGE_GUARD="$SCRIPT_DIR/../check_merge_deletion.sh"
REGISTRY_CLI="$SCRIPT_DIR/../retirement_registry_cli.bb"
COMMIT_MSG_HOOK="$SCRIPT_DIR/../../git-hooks/commit-msg"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
MSGDIR="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT" "$MSGDIR"' EXIT
MSG="$MSGDIR/msg.txt"

run_guard() {
  (cd "$ROOT" && bash "$GUARD" "$@")
}

register() {
  bb "$REGISTRY_CLI" "$ROOT" register "$@"
}

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email test@test
git -C "$ROOT" config user.name test
git -C "$ROOT" config commit.gpgsign false
git -C "$ROOT" commit -q --allow-empty -m seed

# ── fixture topology: the REAL incident shape, not a 3-way delete/keep
#    resolution (that is check_merge_deletion.sh's own domain, and git
#    resolves modified-or-deleted vs unchanged as the deletion winning
#    regardless of merge direction - it can never reproduce a one-sided
#    add). Here "feature" mints the files and main NEVER merges that
#    commit at all - "main was clean only because the mint never reached
#    it", exactly this ticket's own incident narrative. relative to
#    main's history the files are entirely unseen, so merging feature
#    into main is a genuine clean one-sided add: present in feature,
#    absent from main, absent from their merge-base. ──────────────────────

git -C "$ROOT" checkout -q -b feature
mkdir -p "$ROOT/specs/pipeline/steps" "$ROOT/swarmforge/scripts"
echo "step handler" > "$ROOT/specs/pipeline/steps/bl0001ExampleSteps.js"
echo "lib" > "$ROOT/swarmforge/scripts/bl0002_example_lib.bb"
git -C "$ROOT" add specs/pipeline/steps/bl0001ExampleSteps.js swarmforge/scripts/bl0002_example_lib.bb
git -C "$ROOT" commit -q -m "BL-0001: mint the retired-later feature"
echo "feature progress" > "$ROOT/feature-note.txt"
git -C "$ROOT" add feature-note.txt
git -C "$ROOT" commit -q -m "feature: unrelated progress"
FEATURE_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

# main never took the mint at all - adjudicated retired, and registered as
# such, without ever needing a deletion commit of its own.
git -C "$ROOT" checkout -q main
MAIN_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
register BL-0001 specs/pipeline/steps/bl0001ExampleSteps.js swarmforge/scripts/bl0002_example_lib.bb >/dev/null

# ── 1: not a merge at all - guard is a no-op regardless of staged content ──
git -C "$ROOT" checkout -q main
echo "unrelated prose" > "$MSG"
run_guard "$MSG" || fail "01: a plain (non-merge) commit must never be refused by this guard"
pass "01: a plain commit (no MERGE_HEAD) is untouched"

# Merges FEATURE (still carrying the retired mint) INTO main (which never
# took it) - the direction that actually reproduces a one-sided add.
start_merge() {
  git -C "$ROOT" checkout -q main
  git -C "$ROOT" reset -q --hard "$MAIN_TIP"
  set +e
  git -C "$ROOT" merge --no-ff --no-commit feature >/dev/null 2>&1
  set -e
}

# ── 2: merging feature (still carrying the retired mint) into main,
#       message naming nothing -> refused, naming both retired paths ─────
start_merge
echo "merge feature into main" > "$MSG"
set +e
OUT2="$(run_guard "$MSG" 2>&1)"
STATUS2=$?
set -e
[[ "$STATUS2" -ne 0 ]] || fail "02: expected refusal when a retired path re-enters via a one-sided add"
echo "$OUT2" | grep -q "bl0001ExampleSteps.js" || fail "02: refusal must name the first retired path, got: $OUT2"
echo "$OUT2" | grep -q "bl0002_example_lib.bb" || fail "02: refusal must name the second retired path, got: $OUT2"
echo "$OUT2" | grep -q "BL-0001" || fail "02: refusal must name the retiring ticket BL-0001, got: $OUT2"
pass "02: a merge re-adding a retired ticket's artefacts is refused, naming each path"
git -C "$ROOT" merge --abort

# ── 3: naming the retired ticket in the message allows the merge ─────────
start_merge
echo "BL-0001: deliberate un-retirement, resurrecting the mint" > "$MSG"
run_guard "$MSG" || fail "03: expected the merge to be allowed once the retired ticket id is named"
pass "03: naming the retired ticket id allows the merge (deliberate un-retirement)"
git -C "$ROOT" merge --abort

# ── 4: deleting the retired paths on the branch clears the refusal - the
#       refused role always has a move ───────────────────────────────────
git -C "$ROOT" checkout -q feature
git -C "$ROOT" reset -q --hard "$FEATURE_TIP"
git -C "$ROOT" rm -q specs/pipeline/steps/bl0001ExampleSteps.js swarmforge/scripts/bl0002_example_lib.bb
git -C "$ROOT" commit -q -m "drop the retired mint on my own branch before merging"
CLEARED_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
git -C "$ROOT" checkout -q main
git -C "$ROOT" reset -q --hard "$MAIN_TIP"
set +e
git -C "$ROOT" merge --no-ff --no-commit "$CLEARED_TIP" >/dev/null 2>&1
set -e
echo "merge feature into main" > "$MSG"
run_guard "$MSG" || fail "04: expected the merge to be allowed once the retired paths were deleted on this branch"
pass "04: deleting the retired paths on the refused branch clears the refusal"
git -C "$ROOT" merge --abort 2>/dev/null || true

# ── 5: a live (never-retired) ticket's brand new files still merge clean ──
# Branches from MAIN_TIP, never from feature - it must not carry the
# retired mint through its own ancestry, or this would (correctly) also
# be refused and prove nothing about the live-file case.
git -C "$ROOT" checkout -q -b feature2 "$MAIN_TIP"
mkdir -p "$ROOT/specs/pipeline/steps"
echo "brand new, never retired" > "$ROOT/specs/pipeline/steps/bl0003ExampleSteps.js"
git -C "$ROOT" add specs/pipeline/steps/bl0003ExampleSteps.js
git -C "$ROOT" commit -q -m "BL-0003: new live work"
FEATURE2_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
git -C "$ROOT" checkout -q main
git -C "$ROOT" reset -q --hard "$MAIN_TIP"
set +e
git -C "$ROOT" merge --no-ff --no-commit "$FEATURE2_TIP" >/dev/null 2>&1
set -e
echo "totally unrelated message" > "$MSG"
run_guard "$MSG" || fail "05: a live ticket's new (never-retired) file must never be refused"
pass "05: a live ticket's new files are still allowed through"
git -C "$ROOT" merge --abort 2>/dev/null || true

# ── 6: no retirement ever registered - the guard is a cheap no-op ────────
ROOT2="$(cd "$(mktemp -d)" && pwd -P)"
git -C "$ROOT2" init -q -b main
git -C "$ROOT2" config user.email test@test
git -C "$ROOT2" config user.name test
git -C "$ROOT2" commit -q --allow-empty -m seed
echo x > "$ROOT2/f.txt"
git -C "$ROOT2" add f.txt
git -C "$ROOT2" commit -q -m "add a file"
echo "unrelated" > "$MSG"
(cd "$ROOT2" && bash "$GUARD" "$MSG") || fail "06: a repo with no retirement registry must never be refused"
pass "06: an empty/absent registry is a no-op, not a refusal"
rm -rf "$ROOT2"

# ── 7: wired as the real commit-msg hook, an actual `git merge --no-ff`
#       is blocked - not just the standalone script ──────────────────────
mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/swarmforge/git-hooks"
cp "$TICKET_GUARD" "$ROOT/swarmforge/scripts/check_ticket_deletion.sh"
cp "$MERGE_GUARD" "$ROOT/swarmforge/scripts/check_merge_deletion.sh"
cp "$GUARD" "$ROOT/swarmforge/scripts/check_retirement_readdition.sh"
cp "$REGISTRY_CLI" "$ROOT/swarmforge/scripts/retirement_registry_cli.bb"
cp "$SCRIPT_DIR/../retirement_registry_lib.bb" "$ROOT/swarmforge/scripts/retirement_registry_lib.bb"
cp "$COMMIT_MSG_HOOK" "$ROOT/swarmforge/git-hooks/commit-msg"
chmod +x "$ROOT/swarmforge/scripts/"*.sh "$ROOT/swarmforge/git-hooks/"*
git -C "$ROOT" checkout -q main
git -C "$ROOT" reset -q --hard "$MAIN_TIP"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "install hooks fixture"
git -C "$ROOT" config core.hooksPath swarmforge/git-hooks
HOOKED_MAIN_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
register BL-0001 specs/pipeline/steps/bl0001ExampleSteps.js swarmforge/scripts/bl0002_example_lib.bb >/dev/null

git -C "$ROOT" checkout -q main
set +e
OUT7="$(git -C "$ROOT" merge --no-ff -m "merge feature into main" "$FEATURE_TIP" 2>&1)"
STATUS7=$?
set -e
[[ "$STATUS7" -ne 0 ]] || fail "07: expected the installed hook to block a real git merge re-adding a retired ticket's artefacts, got: $OUT7"
echo "$OUT7" | grep -q "bl0001ExampleSteps.js" || fail "07: expected the real hook's refusal to name the retired path, got: $OUT7"
pass "07: an installed commit-msg hook blocks a real git merge --no-ff that silently re-adds retired artefacts"
git -C "$ROOT" merge --abort 2>/dev/null || true

set +e
OUT8="$(git -C "$ROOT" merge --no-ff -m "BL-0001: deliberate un-retirement" "$FEATURE_TIP" 2>&1)"
STATUS8=$?
set -e
[[ "$STATUS8" -eq 0 ]] || fail "08: expected naming the retired ticket to allow the real merge, got: $OUT8"
pass "08: with the hooks installed, naming the retired ticket allows the merge"

echo "ALL PASS"
