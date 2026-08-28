#!/usr/bin/env bash
# BL-570: property-suite drift guard — unit scenarios (injectable suite runner).
# Mirrors test_commit_size_guard.sh: drives the standalone script in a temp
# git repo; never a FORCE_RESULT env bypass in the production path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_property_suite_drift.sh"
PRE_COMMIT_HOOK="$SCRIPT_DIR/../../git-hooks/pre-commit"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

GREEN=(bash -c 'exit 0')
RED=(bash -c 'echo "FAIL extension/test/pipelineBoard.property.test.js" >&2; exit 1')
UNAVAIL=(bash -c 'exit 127')

stage() {
  local rel="$1"
  mkdir -p "$ROOT/$(dirname "$rel")"
  echo "v1" > "$ROOT/$rel"
  git -C "$ROOT" add "$rel"
}

# ── 01: docs-only staged path skips the suite ─────────────────────────────
stage docs/diagrams/architecture.md
set +e
OUT01="$(cd "$ROOT" && bash "$GUARD" "${GREEN[@]}" 2>&1)"
ST01=$?
set -e
[[ "$ST01" -eq 0 ]] || fail "01: docs-only must allow, got $ST01: $OUT01"
echo "$OUT01" | grep -q 'property-suite-guard: skip-paths' \
  || fail "01: expected skip-paths marker, got: $OUT01"
echo "$OUT01" | grep -q 'property-suite-guard: run' \
  && fail "01: must not run the suite for docs-only"
pass "01: docs-only staged path skips the property suite"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/docs"

# ── 02: extension/src triggers a green suite and allows ───────────────────
stage extension/src/pipelineBoard.ts
set +e
OUT02="$(cd "$ROOT" && bash "$GUARD" "${GREEN[@]}" 2>&1)"
ST02=$?
set -e
[[ "$ST02" -eq 0 ]] || fail "02: green suite must allow, got $ST02: $OUT02"
echo "$OUT02" | grep -q 'property-suite-guard: run' \
  || fail "02: expected run marker, got: $OUT02"
pass "02: extension/src with green suite allows"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 03: *.property.test.js triggers the suite ─────────────────────────────
stage extension/test/pipelineBoard.property.test.js
set +e
OUT03="$(cd "$ROOT" && bash "$GUARD" "${GREEN[@]}" 2>&1)"
ST03=$?
set -e
[[ "$ST03" -eq 0 ]] || fail "03: property test path must allow when green: $OUT03"
echo "$OUT03" | grep -q 'property-suite-guard: run' \
  || fail "03: expected run marker, got: $OUT03"
pass "03: *.property.test.js staged path runs the suite"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 04: red suite blocks and names the property file ──────────────────────
stage extension/src/pipelineBoard.ts
set +e
OUT04="$(cd "$ROOT" && bash "$GUARD" "${RED[@]}" 2>&1)"
ST04=$?
set -e
[[ "$ST04" -ne 0 ]] || fail "04: red suite must block"
echo "$OUT04" | grep -q 'pipelineBoard.property.test.js' \
  || fail "04: must name failing property file, got: $OUT04"
pass "04: red suite blocks and names the property test file"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 05: unavailable toolchain fails open with skipped warning ─────────────
stage extension/src/pipelineBoard.ts
set +e
OUT05="$(cd "$ROOT" && bash "$GUARD" "${UNAVAIL[@]}" 2>&1)"
ST05=$?
set -e
[[ "$ST05" -eq 0 ]] || fail "05: unavailable must allow, got $ST05: $OUT05"
echo "$OUT05" | grep -qi 'skipped' \
  || fail "05: must warn skipped, got: $OUT05"
pass "05: unavailable toolchain fails open with skipped warning"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 06: override allows a red suite with overridden warning ───────────────
stage extension/src/pipelineBoard.ts
set +e
OUT06="$(cd "$ROOT" && SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 bash "$GUARD" "${RED[@]}" 2>&1)"
ST06=$?
set -e
[[ "$ST06" -eq 0 ]] || fail "06: override must allow, got $ST06: $OUT06"
echo "$OUT06" | grep -qi 'overridden' \
  || fail "06: must warn overridden, got: $OUT06"
pass "06: override lets a red suite through with overridden warning"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 07: pre-commit wiring invokes the new guard (script must exist) ───────
mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/swarmforge/git-hooks"
cp "$GUARD" "$ROOT/swarmforge/scripts/check_property_suite_drift.sh"
cp "$SCRIPT_DIR/../property_suite_standing_allowlist_lib.sh" "$ROOT/swarmforge/scripts/property_suite_standing_allowlist_lib.sh"
cp "$SCRIPT_DIR/../property_suite_standing_allowlist.tsv" "$ROOT/swarmforge/scripts/property_suite_standing_allowlist.tsv"
cp "$SCRIPT_DIR/../property_suite_shared_repo_guard.sh" "$ROOT/swarmforge/scripts/property_suite_shared_repo_guard.sh"
cp "$SCRIPT_DIR/../incoming_merge_parent_lib.sh" "$ROOT/swarmforge/scripts/incoming_merge_parent_lib.sh"
cp "$SCRIPT_DIR/../check_commit_size.sh" "$ROOT/swarmforge/scripts/check_commit_size.sh"
cp "$SCRIPT_DIR/../check_ticket_deletion.sh" "$ROOT/swarmforge/scripts/check_ticket_deletion.sh"
cp "$SCRIPT_DIR/../check_pipeline_code_on_main.sh" "$ROOT/swarmforge/scripts/check_pipeline_code_on_main.sh"
cp "$PRE_COMMIT_HOOK" "$ROOT/swarmforge/git-hooks/pre-commit"
chmod +x "$ROOT/swarmforge/scripts/"*.sh "$ROOT/swarmforge/git-hooks/pre-commit"
# Load-bearing: must be an executable line, not only the name in a comment
# (commenting out the call otherwise survives a bare grep -q).
grep -v '^[[:space:]]*#' "$ROOT/swarmforge/git-hooks/pre-commit" \
  | grep -q 'check_property_suite_drift\.sh' \
  || fail "07: pre-commit must invoke check_property_suite_drift.sh (non-comment)"
git -C "$ROOT" config core.hooksPath swarmforge/git-hooks
stage backlog/paused/BL-999-example.yaml
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m ordinary \
  || fail "07: ordinary commit must succeed with the property guard wired"
pass "07: pre-commit wires the property guard; docs/backlog commit still succeeds"

# ── 08: BL-1121 reconcile import (MERGE_HEAD + byte-identical) skips suite ─
# Fixture commits must not fire the repo's pre-commit (pipeline-code on main).
git -C "$ROOT" config core.hooksPath /dev/null
git -C "$ROOT" reset -q --hard HEAD
rm -rf "$ROOT/extension"
mkdir -p "$ROOT/extension/src"
echo "base" > "$ROOT/extension/src/pipelineBoard.ts"
git -C "$ROOT" add extension/src/pipelineBoard.ts
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m base-ext \
  || fail "08: base-ext commit failed"
git -C "$ROOT" checkout -q -b incoming
echo "imported" > "$ROOT/extension/src/pipelineBoard.ts"
git -C "$ROOT" add extension/src/pipelineBoard.ts
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m incoming-ext \
  || fail "08: incoming-ext commit failed"
INCOMING_SHA="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" checkout -q main
# Divergent tip so merge is not a fast-forward; keep local unrelated change.
mkdir -p "$ROOT/docs"
echo "local-only" > "$ROOT/docs/local.txt"
git -C "$ROOT" add docs/local.txt
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m local-docs \
  || fail "08: local-docs commit failed"
git -C "$ROOT" -c user.email=test@test -c user.name=test \
  merge --no-commit --no-ff "$INCOMING_SHA" >/dev/null 2>&1 \
  || fail "08: setup merge --no-commit must succeed"
set +e
OUT08="$(cd "$ROOT" && bash "$GUARD" "${RED[@]}" 2>&1)"
ST08=$?
set -e
[[ "$ST08" -eq 0 ]] || fail "08: reconcile import must allow without suite, got $ST08: $OUT08"
echo "$OUT08" | grep -q 'property-suite-guard: skip-reconcile-import' \
  || fail "08: expected skip-reconcile-import marker, got: $OUT08"
echo "$OUT08" | grep -q 'property-suite-guard: run' \
  && fail "08: must not run the suite for byte-identical import"
echo "$OUT08" | grep -qi 'overridden' \
  && fail "08: must not use recovery override for standing reconcile skip"
pass "08: MERGE_HEAD byte-identical import skips suite (not env override)"
git -C "$ROOT" merge --abort >/dev/null 2>&1 || git -C "$ROOT" reset -q --hard HEAD

# ── 09: ordinary extension/src commit still runs (invariant 2) ────────────
git -C "$ROOT" checkout -q main
rm -rf "$ROOT/extension"
mkdir -p "$ROOT/extension/src"
echo "fresh-edit" > "$ROOT/extension/src/pipelineBoard.ts"
git -C "$ROOT" add extension/src/pipelineBoard.ts
set +e
OUT09="$(cd "$ROOT" && bash "$GUARD" "${GREEN[@]}" 2>&1)"
ST09=$?
set -e
[[ "$ST09" -eq 0 ]] || fail "09: ordinary green suite must allow: $OUT09"
echo "$OUT09" | grep -q 'property-suite-guard: run' \
  || fail "09: ordinary commit must run the suite, got: $OUT09"
echo "$OUT09" | grep -q 'skip-reconcile-import' \
  && fail "09: ordinary commit must not claim reconcile-import skip"
pass "09: non-reconcile extension/src commit still runs the suite"

# ── 10: recovery override stays distinct from skip-reconcile-import ───────
set +e
OUT10="$(cd "$ROOT" && SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 bash "$GUARD" "${RED[@]}" 2>&1)"
ST10=$?
set -e
[[ "$ST10" -eq 0 ]] || fail "10: override must allow"
echo "$OUT10" | grep -qi 'overridden' \
  || fail "10: override path must warn overridden"
echo "$OUT10" | grep -q 'skip-reconcile-import' \
  && fail "10: override must not print skip-reconcile-import"
pass "10: SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD remains recovery-only (distinct marker)"

# ── 11: BL-1175 all-allowlisted standing reds allow without SKIP ─────────
stage extension/src/pipelineBoard.ts
ALLOWLISTED_RED=(bash -c 'printf "%s\n" " FAIL  test/bl632CommitTimeGuardInvariants.property.test.js > x" >&2; exit 1')
set +e
OUT11="$(cd "$ROOT" && bash "$GUARD" "${ALLOWLISTED_RED[@]}" 2>&1)"
ST11=$?
set -e
[[ "$ST11" -eq 0 ]] || fail "11: all-allowlisted reds must allow, got $ST11: $OUT11"
echo "$OUT11" | grep -q 'allowlisted-standing-reds' \
  || fail "11: expected allowlisted-standing-reds marker, got: $OUT11"
echo "$OUT11" | grep -qi 'overridden' \
  && fail "11: must not use SKIP override for allowlisted standing reds"
pass "11: all-allowlisted standing reds allow commit without SKIP"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 12: BL-1175 non-allowlisted red still blocks ─────────────────────────
stage extension/src/pipelineBoard.ts
MIXED_RED=(bash -c 'printf "%s\n" " FAIL  test/bl632CommitTimeGuardInvariants.property.test.js > x" " FAIL  test/pipelineBoard.property.test.js > y" >&2; exit 1')
set +e
OUT12="$(cd "$ROOT" && bash "$GUARD" "${MIXED_RED[@]}" 2>&1)"
ST12=$?
set -e
[[ "$ST12" -ne 0 ]] || fail "12: mixed allowlisted + non-allowlisted must block"
echo "$OUT12" | grep -q 'pipelineBoard.property.test.js' \
  || fail "12: must name non-allowlisted file, got: $OUT12"
echo "$OUT12" | grep -q 'non-allowlisted' \
  || fail "12: expected non-allowlisted rejection marker, got: $OUT12"
pass "12: non-allowlisted failure still blocks the commit"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 13: BL-1175 green parcel path — ordinary run still enforced ──────────
stage extension/src/pipelineBoard.ts
set +e
OUT13="$(cd "$ROOT" && bash "$GUARD" "${RED[@]}" 2>&1)"
ST13=$?
set -e
[[ "$ST13" -ne 0 ]] || fail "13: unallowlisted red must still block"
echo "$OUT13" | grep -q 'pipelineBoard.property.test.js' \
  || fail "13: must name failing property file, got: $OUT13"
pass "13: guard still refuses silent unallowlisted reds"

# ── 14/15 (BL-1202): the guard is killed mid-run — canary still reported,
#    and no process the suite started outlives the guard ─────────────────
# The fake suite mutates the live checkout ref (simulating the incident:
# fixture children rewriting a real branch ref) then sleeps, so the guard
# can be killed from outside while it is still "in the suite". A marker
# file records the fake suite's own PID so scenario 15 can confirm nothing
# in its process group survives the kill.
stage extension/src/pipelineBoard.ts
MARKER="$ROOT/../bl1202_marker_$$"
rm -f "$MARKER" "${MARKER}.child"
MUTATING_SLEEP=(bash -c '
  git -C "'"$ROOT"'" -c user.email=t@t -c user.name=t commit -q --allow-empty -m mutated-by-fixture
  echo $$ > "'"$MARKER"'"
  # A grandchild in the SAME process group, so scenario 15 can prove the
  # whole group (not just the direct child) is reaped by pgid.
  (sleep 30) &
  echo $! > "'"$MARKER"'.child"
  sleep 30
')
(
  cd "$ROOT"
  # exec replaces this subshell's own process image with the guard itself,
  # so GUARD_PID below is the guard's REAL pid - without it, GUARD_PID
  # would be the wrapping subshell, and a SIGTERM to it would never reach
  # the guard, since a subshell's default signal disposition does not
  # forward to its own children.
  exec bash "$GUARD" "${MUTATING_SLEEP[@]}" >"$ROOT/../bl1202_out_$$" 2>&1
) &
GUARD_PID=$!

# Wait for the fake suite to actually be running (marker written) before
# killing the guard - a fixed sleep here would race the fork/exec above.
DEADLINE=$((SECONDS + 10))
while [[ ! -s "$MARKER" ]] && (( SECONDS < DEADLINE )); do
  sleep 0.05
done
[[ -s "$MARKER" ]] || fail "14: fake suite never started (marker never appeared)"
CHILD_PID="$(cat "$MARKER")"

kill -TERM "$GUARD_PID" 2>/dev/null || true
set +e
wait "$GUARD_PID"
ST14=$?
set -e

OUT14="$(cat "$ROOT/../bl1202_out_$$" 2>/dev/null || true)"

[[ "$ST14" -ne 0 ]] || fail "14: a killed guard must exit non-zero, got $ST14: $OUT14"
echo "$OUT14" | grep -q 'BL-1124: shared repo refs/bare changed' \
  || fail "14: expected the canary to still be reported on a killed run, got: $OUT14"
pass "14: killing the guard mid-run still reports the BL-1124 canary verdict"

# BL-1202 invariant 2: no process the guard started outlives the guard -
# checked by process group (the direct child AND its own grandchild), not
# by name, per the ticket's own qa_e2e_procedure step 3.
DEADLINE=$((SECONDS + 5))
while { kill -0 "$CHILD_PID" 2>/dev/null || kill -0 "$(cat "${MARKER}.child" 2>/dev/null || echo 0)" 2>/dev/null; } \
      && (( SECONDS < DEADLINE )); do
  sleep 0.05
done
if kill -0 "$CHILD_PID" 2>/dev/null; then
  fail "15: fake suite's own process ($CHILD_PID) is still running after the guard was killed"
fi
GRANDCHILD_PID="$(cat "${MARKER}.child" 2>/dev/null || echo "")"
if [[ -n "$GRANDCHILD_PID" ]] && kill -0 "$GRANDCHILD_PID" 2>/dev/null; then
  fail "15: fake suite's grandchild ($GRANDCHILD_PID, same process group) is still running after the guard was killed"
fi
pass "15: no process the guard started (by process group) outlives a killed guard"

rm -f "$MARKER" "${MARKER}.child" "$ROOT/../bl1202_out_$$"
git -C "$ROOT" reset -q HEAD~1 --hard
rm -rf "$ROOT/extension"

# ── 16 (hardener, BL-1202): a SIGHUP kill is caught ONLY by the standalone
#    `trap ... EXIT` line, never by `trap on_interrupt INT TERM` - the guard
#    traps INT/TERM explicitly, but not HUP, so a HUP delivery (a plausible
#    real shape for "the foreground git commit was killed": a closing
#    terminal or a dying parent process group sends HUP, not always TERM)
#    relies entirely on bash's own behavior of still running a registered
#    EXIT trap on an untrapped fatal signal. Verified live (2026-08-28): a
#    2-line bash script with only `trap ... EXIT` and no HUP trap DOES run
#    its EXIT trap on `kill -HUP`, exit status 129. Removing the guard's
#    standalone EXIT trap line left scenarios 01-15 all still green (they
#    only ever exercise TERM), so this scenario is what actually pins that
#    line as load-bearing rather than redundant with on_interrupt.
stage extension/src/pipelineBoard.ts
MARKER16="$ROOT/../bl1202_marker16_$$"
rm -f "$MARKER16"
MUTATING_SLEEP_16=(bash -c '
  git -C "'"$ROOT"'" -c user.email=t@t -c user.name=t commit -q --allow-empty -m mutated-by-fixture-16
  echo $$ > "'"$MARKER16"'"
  sleep 30
')
(
  cd "$ROOT"
  exec bash "$GUARD" "${MUTATING_SLEEP_16[@]}" >"$ROOT/../bl1202_out16_$$" 2>&1
) &
GUARD_PID_16=$!

DEADLINE=$((SECONDS + 10))
while [[ ! -s "$MARKER16" ]] && (( SECONDS < DEADLINE )); do
  sleep 0.05
done
[[ -s "$MARKER16" ]] || fail "16: fake suite never started (marker never appeared)"

kill -HUP "$GUARD_PID_16" 2>/dev/null || true
set +e
wait "$GUARD_PID_16"
ST16=$?
set -e

OUT16="$(cat "$ROOT/../bl1202_out16_$$" 2>/dev/null || true)"

[[ "$ST16" -ne 0 ]] || fail "16: a HUP-killed guard must exit non-zero, got $ST16: $OUT16"
echo "$OUT16" | grep -q 'BL-1124: shared repo refs/bare changed' \
  || fail "16: expected the canary to still be reported on a HUP-killed run, got: $OUT16"
pass "16: a SIGHUP kill (caught only by the standalone EXIT trap) still reports the BL-1124 canary verdict"

rm -f "$MARKER16" "$ROOT/../bl1202_out16_$$"
git -C "$ROOT" reset -q HEAD~1 --hard
rm -rf "$ROOT/extension"

# ── 17 (BL-1222): the hook's inherited git environment does not reach the
#    launched suite. GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE are exactly what
#    a real pre-commit hook exports for a commit made from a linked
#    worktree (measured live, ticket description) - simulated here by
#    exporting fabricated values before invoking the guard, the same shape
#    a hook environment presents regardless of how it got there.
FAKE_MAIN_GITDIR_17="$ROOT/../bl1222_fake_main_17_$$"
rm -rf "$FAKE_MAIN_GITDIR_17"
git init -q -b main "$FAKE_MAIN_GITDIR_17"
git -C "$FAKE_MAIN_GITDIR_17" -c user.email=t@t -c user.name=t commit -q --allow-empty -m fake-main-init
mkdir -p "$FAKE_MAIN_GITDIR_17/extension/src"
echo v1 > "$FAKE_MAIN_GITDIR_17/extension/src/pipelineBoard.ts"
git -C "$FAKE_MAIN_GITDIR_17" add extension/src/pipelineBoard.ts

ENV_OUT_17="$ROOT/../bl1222_env_out_$$"
rm -f "$ENV_OUT_17"
DUMP_ENV_17=(bash -c 'env | grep -E "^GIT_(DIR|WORK_TREE|INDEX_FILE)=" > "'"$ENV_OUT_17"'" || true; exit 0')
set +e
OUT17="$(
  cd "$FAKE_MAIN_GITDIR_17"
  GIT_DIR="$FAKE_MAIN_GITDIR_17/.git" \
  GIT_INDEX_FILE="$FAKE_MAIN_GITDIR_17/.git/index" \
  bash "$GUARD" "${DUMP_ENV_17[@]}" 2>&1
)"
ST17=$?
set -e
[[ "$ST17" -eq 0 ]] || fail "17: green injected suite must allow, got $ST17: $OUT17"
[[ -f "$ENV_OUT_17" ]] || fail "17: injected suite never ran (no env dump produced): $OUT17"
if [[ -s "$ENV_OUT_17" ]]; then
  fail "17: suite process still inherited git env vars: $(cat "$ENV_OUT_17")"
fi
pass "17: the launched suite receives none of GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE from the invoking hook"
rm -f "$ENV_OUT_17"
rm -rf "$FAKE_MAIN_GITDIR_17"

# ── 18 (BL-1222): a SHELL fixture the suite shells out to (mkdtemp + git
#    init + git commit, the exact class BL-1200 was filed for) is isolated
#    too - the class a vitest setupFile can never reach, since it covers
#    code running inside vitest, not a nested shell process the suite
#    spawns. A fake "linked worktree" gitdir is a REAL git repo here (not
#    just a fabricated path), so an un-scrubbed run would actually commit
#    into it - proving the isolation, not merely that nothing crashed.
FAKE_MAIN_GITDIR="$ROOT/../bl1222_fake_main_$$"
rm -rf "$FAKE_MAIN_GITDIR"
git init -q -b main "$FAKE_MAIN_GITDIR"
git -C "$FAKE_MAIN_GITDIR" -c user.email=t@t -c user.name=t commit -q --allow-empty -m fake-main-init
mkdir -p "$FAKE_MAIN_GITDIR/extension/src"
echo v1 > "$FAKE_MAIN_GITDIR/extension/src/pipelineBoard.ts"
git -C "$FAKE_MAIN_GITDIR" add extension/src/pipelineBoard.ts
HEAD_BEFORE_18="$(git -C "$FAKE_MAIN_GITDIR" rev-parse HEAD)"

NESTED_MARKER_18="$ROOT/../bl1222_nested_out_$$"
rm -f "$NESTED_MARKER_18"
NESTED_FIXTURE_18=(bash -c '
  NESTED_DIR="$(mktemp -d)"
  git -C "$NESTED_DIR" init -q -b main
  git -C "$NESTED_DIR" -c user.email=t@t -c user.name=t commit -q --allow-empty -m nested-fixture-commit
  git -C "$NESTED_DIR" rev-parse HEAD > "'"$NESTED_MARKER_18"'"
  rm -rf "$NESTED_DIR"
')
set +e
OUT18="$(
  cd "$FAKE_MAIN_GITDIR"
  GIT_DIR="$FAKE_MAIN_GITDIR/.git" \
  GIT_INDEX_FILE="$FAKE_MAIN_GITDIR/.git/index" \
  bash "$GUARD" "${NESTED_FIXTURE_18[@]}" 2>&1
)"
ST18=$?
set -e
[[ "$ST18" -eq 0 ]] || fail "18: green injected suite must allow, got $ST18: $OUT18"
[[ -f "$NESTED_MARKER_18" ]] || fail "18: nested shell fixture never ran: $OUT18"
HEAD_AFTER_18="$(git -C "$FAKE_MAIN_GITDIR" rev-parse HEAD)"
[[ "$HEAD_AFTER_18" == "$HEAD_BEFORE_18" ]] \
  || fail "18: the fake linked worktree's HEAD moved from $HEAD_BEFORE_18 to $HEAD_AFTER_18 - the nested fixture's git init/commit leaked into it"
pass "18: a nested shell fixture's git init + commit is isolated, not redirected into the invoking worktree"
rm -f "$NESTED_MARKER_18"
rm -rf "$FAKE_MAIN_GITDIR"

echo "ALL PASS"
