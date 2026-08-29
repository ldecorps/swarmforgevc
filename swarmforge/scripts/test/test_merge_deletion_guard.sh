#!/usr/bin/env bash
# BL-1242: sibling guard to check_ticket_deletion.sh (BL-901), refusing a
# MERGE commit that silently removes a path the receiving branch itself
# introduced - the exact failure mode of the 2026-08-28 BL-1227 merge-up
# incident (backlog/evidence/BL-1242-merge-up-deletes-rebuilt-work-20260828.md).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_merge_deletion.sh"
TICKET_GUARD="$SCRIPT_DIR/../check_ticket_deletion.sh"
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

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email test@test
git -C "$ROOT" config user.name test
git -C "$ROOT" config commit.gpgsign false
git -C "$ROOT" commit -q --allow-empty -m seed

# ── fixture topology: BOTH files are introduced on the shared history
#    FIRST (the common ancestor both branches will share), then "main"
#    REVERTS them (mirroring a QA-side BL-490/BL-495 bounce revert) while
#    "feature" branches off the pre-revert point and keeps them - the
#    exact 3-way-merge shape that resolves as "theirs deleted, ours
#    unchanged" and silently drops them from the merge result. ───────────

mkdir -p "$ROOT/specs/pipeline/steps" "$ROOT/swarmforge/scripts"
echo "step handler" > "$ROOT/specs/pipeline/steps/bl0001ExampleSteps.js"
git -C "$ROOT" add specs/pipeline/steps/bl0001ExampleSteps.js
git -C "$ROOT" commit -q -m "BL-0001: add step handler"
echo "lib" > "$ROOT/swarmforge/scripts/bl0002_example_lib.bb"
git -C "$ROOT" add swarmforge/scripts/bl0002_example_lib.bb
git -C "$ROOT" commit -q -m "BL-0002: add lib"
PRE_REVERT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

# feature branches HERE, before either revert - it keeps both files and
# adds its own unrelated change (any subsequent commit; the revert is
# what matters for the merge, not this).
git -C "$ROOT" checkout -q -b feature
echo "feature progress" > "$ROOT/feature-note.txt"
git -C "$ROOT" add feature-note.txt
git -C "$ROOT" commit -q -m "feature: unrelated progress"
FEATURE_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

# main (still at PRE_REVERT) reverts both files - the QA-side bounce
# revert shape.
git -C "$ROOT" checkout -q main
git -C "$ROOT" rm -q specs/pipeline/steps/bl0001ExampleSteps.js swarmforge/scripts/bl0002_example_lib.bb
git -C "$ROOT" commit -q -m "revert BL-0001/BL-0002 bounce"
MAIN_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

# ── 1: not a merge at all - guard is a no-op regardless of staged deletes ──
git -C "$ROOT" checkout -q feature
git -C "$ROOT" rm -q swarmforge/scripts/bl0002_example_lib.bb
echo "unrelated prose" > "$MSG"
run_guard "$MSG" || fail "01: a plain (non-merge) commit must never be refused by this guard"
pass "01: a plain commit (no MERGE_HEAD) is untouched"
git -C "$ROOT" reset -q --hard "$FEATURE_TIP"

# ── setup for the merge scenarios: start the merge, resolve nothing extra -
#    main's tree naturally lacks both files, so the merge result "theirs
#    deleted, ours unchanged" removes both from the feature branch. ───────
start_merge() {
  git -C "$ROOT" checkout -q feature
  git -C "$ROOT" reset -q --hard "$FEATURE_TIP"
  set +e
  git -C "$ROOT" merge --no-ff --no-commit "$MAIN_TIP" >/dev/null 2>&1
  set -e
}

# ── 2: message names neither ticket -> refused, naming both paths ─────────
start_merge
echo "merge main" > "$MSG"
set +e
OUT2="$(run_guard "$MSG" 2>&1)"
STATUS2=$?
set -e
[[ "$STATUS2" -ne 0 ]] || fail "02: expected refusal when the message names neither ticket"
echo "$OUT2" | grep -q "bl0001ExampleSteps.js" || fail "02: refusal must name the first path, got: $OUT2"
echo "$OUT2" | grep -q "bl0002_example_lib.bb" || fail "02: refusal must name the second path, got: $OUT2"
echo "$OUT2" | grep -q "BL-0001" || fail "02: refusal must name BL-0001, got: $OUT2"
echo "$OUT2" | grep -q "BL-0002" || fail "02: refusal must name BL-0002, got: $OUT2"
echo "$OUT2" | grep -q "$FEATURE_TIP" || echo "$OUT2" | grep -qE "[0-9a-f]{7,10}" \
  || fail "02: refusal must name a commit that introduced the path, got: $OUT2"
pass "02: a merge removing two branch-introduced files, message naming neither, is refused naming both"
git -C "$ROOT" merge --abort

# ── 3: message names only one of the two tickets -> still refused, naming
#       only the unnamed one ──────────────────────────────────────────────
start_merge
echo "BL-0001: revert propagation" > "$MSG"
set +e
OUT3="$(run_guard "$MSG" 2>&1)"
STATUS3=$?
set -e
[[ "$STATUS3" -ne 0 ]] || fail "03: expected refusal when only one of two tickets is named"
echo "$OUT3" | grep -q "BL-0002" || fail "03: refusal must still name the unnamed ticket BL-0002, got: $OUT3"
echo "$OUT3" | grep -q "(BL-0001," && fail "03: refusal must not also flag the already-named ticket BL-0001, got: $OUT3"
pass "03: with only one of two tickets named, the merge is still refused, naming the unnamed one specifically"
git -C "$ROOT" merge --abort

# ── 4: message names both tickets -> allowed ───────────────────────────────
start_merge
echo "BL-0001 and BL-0002: revert propagation from QA merge-up" > "$MSG"
run_guard "$MSG" || fail "04: expected the merge to be allowed once both ticket ids are named"
pass "04: naming both affected ticket ids allows the merge"
git -C "$ROOT" merge --abort

# ── 5: a merge that removes nothing the branch introduced -> allowed,
#       regardless of message content ─────────────────────────────────────
git -C "$ROOT" checkout -q feature
git -C "$ROOT" reset -q --hard "$FEATURE_TIP"
git -C "$ROOT" checkout -q -b feature2 "$FEATURE_TIP"
echo "more feature work" > "$ROOT/specs/pipeline/steps/bl0003ExampleSteps.js"
git -C "$ROOT" add specs/pipeline/steps/bl0003ExampleSteps.js
git -C "$ROOT" commit -q -m "BL-0003: more work"
git -C "$ROOT" checkout -q feature
set +e
git -C "$ROOT" merge --no-ff --no-commit feature2 >/dev/null 2>&1
set -e
echo "totally unrelated message" > "$MSG"
run_guard "$MSG" || fail "05: a merge removing nothing the branch introduced must never be refused"
pass "05: a merge that adds work without removing anything is allowed"
git -C "$ROOT" reset -q --hard "$FEATURE_TIP"

# ── 6 (no-double-report): a backlog ticket YAML deletion in the SAME merge
#       is reported by check_ticket_deletion.sh, not by this guard ────────
mkdir -p "$ROOT/backlog/paused"
echo "id: BL-0001" > "$ROOT/backlog/paused/BL-0001-example.yaml"
git -C "$ROOT" add backlog/paused/BL-0001-example.yaml
git -C "$ROOT" commit -q -m "BL-0001: seed ticket yaml"
FEATURE_TIP2="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
git -C "$ROOT" checkout -q main
git -C "$ROOT" checkout -q feature
git -C "$ROOT" reset -q --hard "$FEATURE_TIP2"
set +e
git -C "$ROOT" merge --no-ff --no-commit "$MAIN_TIP" >/dev/null 2>&1
set -e
git -C "$ROOT" rm -q backlog/paused/BL-0001-example.yaml >/dev/null 2>&1 || true
echo "BL-0002: named" > "$MSG"
set +e
OUT6="$(run_guard "$MSG" 2>&1)"
set -e
echo "$OUT6" | grep -q "BL-0001-example.yaml" \
  && fail "06: this guard must never report the backlog ticket YAML - that is check_ticket_deletion.sh's domain, got: $OUT6"
pass "06: a backlog ticket YAML deletion in the same merge is left to check_ticket_deletion.sh, never double-reported here"
git -C "$ROOT" merge --abort 2>/dev/null || git -C "$ROOT" reset -q --hard "$FEATURE_TIP2"

# ── 7: wired as the real commit-msg hook, an actual `git merge --no-ff`
#       is blocked - not just the standalone script ───────────────────────
mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/swarmforge/git-hooks"
cp "$TICKET_GUARD" "$ROOT/swarmforge/scripts/check_ticket_deletion.sh"
cp "$GUARD" "$ROOT/swarmforge/scripts/check_merge_deletion.sh"
cp "$COMMIT_MSG_HOOK" "$ROOT/swarmforge/git-hooks/commit-msg"
chmod +x "$ROOT/swarmforge/scripts/"*.sh "$ROOT/swarmforge/git-hooks/"*
git -C "$ROOT" checkout -q feature
git -C "$ROOT" reset -q --hard "$FEATURE_TIP"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "install hooks fixture"
FEATURE_TIP3="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
git -C "$ROOT" config core.hooksPath swarmforge/git-hooks

set +e
OUT7="$(cd "$ROOT" && git -c user.email=test@test -c user.name=test merge --no-ff -m "merge main, no ticket named" "$MAIN_TIP" 2>&1)"
STATUS7=$?
set -e
[[ "$STATUS7" -ne 0 ]] || fail "07: expected a real git merge --no-ff to be blocked by the installed commit-msg hook"
echo "$OUT7" | grep -q "BL-0001" || fail "07: hook output must name an affected ticket, got: $OUT7"
pass "07: an installed commit-msg hook blocks a real git merge --no-ff that silently drops branch work"
git -C "$ROOT" merge --abort 2>/dev/null || true
git -C "$ROOT" reset -q --hard "$FEATURE_TIP3"

# ── 8: with the hooks installed, naming the tickets still allows the merge ─
git -C "$ROOT" merge --no-ff -m "BL-0001 and BL-0002: revert propagation, named" "$MAIN_TIP" \
  || fail "08: naming the affected tickets must still allow the real git merge with hooks installed"
pass "08: with the hooks installed, naming the affected tickets allows the merge"

# ── 9: a merge violating BOTH guards at once (a backlog ticket YAML AND a
#       non-YAML branch-introduced path) reports BOTH in one refusal - the
#       commit-msg hook must not let check_ticket_deletion.sh's failure
#       short-circuit check_merge_deletion.sh's own call ──────────────────
mkdir -p "$ROOT/specs/pipeline/steps" "$ROOT/backlog/paused"
echo "step 3" > "$ROOT/specs/pipeline/steps/bl0003ExampleSteps.js"
git -C "$ROOT" add specs/pipeline/steps/bl0003ExampleSteps.js
git -C "$ROOT" commit -q -m "BL-0003: add step handler"
echo "id: BL-0004" > "$ROOT/backlog/paused/BL-0004-example.yaml"
git -C "$ROOT" add backlog/paused/BL-0004-example.yaml
git -C "$ROOT" commit -q -m "BL-0004: seed ticket yaml"
SHARED_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

git -C "$ROOT" checkout -q -b feature3 "$SHARED_TIP"
echo "feature3 progress" > "$ROOT/feature3-note.txt"
git -C "$ROOT" add feature3-note.txt
git -C "$ROOT" commit -q -m "feature3: unrelated progress"

git -C "$ROOT" checkout -q -b main3 "$SHARED_TIP"
git -C "$ROOT" rm -q specs/pipeline/steps/bl0003ExampleSteps.js backlog/paused/BL-0004-example.yaml
git -C "$ROOT" commit -q -m "revert BL-0003/BL-0004 bounce"
MAIN3_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

git -C "$ROOT" checkout -q feature3
set +e
OUT9="$(cd "$ROOT" && git -c user.email=test@test -c user.name=test merge --no-ff -m "merge main3, no ticket named" "$MAIN3_TIP" 2>&1)"
STATUS9=$?
set -e
[[ "$STATUS9" -ne 0 ]] || fail "09: expected refusal when the merge violates both guards"
echo "$OUT9" | grep -q "BL-0004-example.yaml" \
  || fail "09: expected check_ticket_deletion.sh's own violation in the output, got: $OUT9"
echo "$OUT9" | grep -q "bl0003ExampleSteps.js" \
  || fail "09: expected check_merge_deletion.sh's violation too - a failing first guard call must not stop the second from running, got: $OUT9"
pass "09: a merge violating both guards at once reports both, not just the first to run"
git -C "$ROOT" merge --abort 2>/dev/null || true

echo "ALL PASS"
