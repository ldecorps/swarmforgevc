#!/usr/bin/env bash
# BL-1424: swarmforge/scripts/check_test_file_registration.sh, exercised
# directly as REAL subprocesses against real throwaway repos - never a
# parallel reimplementation of unregistered_test_gate_lib.bb's own
# findings-for-staged-commit decision. Complements
# specs/features/BL-1424-a-commit-that-adds-a-test-file-registers-it.feature,
# which drives the same guard's SEVEN example rows through the acceptance
# runner; this suite is the fast, narrower layer plus the two checks a
# Gherkin scenario cannot make (grep-based wiring, and the dogfood proof
# below).
#
# DOGFOOD (the ticket's own How section): this file is itself a test file
# under the tree this guard governs. The commit that adds it must add its
# own manifest row in the same commit, or the guard refuses ITSELF - that
# refusal, seen once live before this file's row was added, is stronger
# evidence the guard is wired and live than any fixture below can be. See
# backlog/evidence/BL-1424-coder-*.md for the transcript.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GUARD="$REPO_ROOT/swarmforge/scripts/check_test_file_registration.sh"
TEST_DIR="swarmforge/scripts/test"
MANIFEST="$TEST_DIR/suite-manifest.tsv"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1424-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1424_SUITE_BOUND_SECONDS:-600}" "$@"
trap 'rm -rf "$WORK"' EXIT

git_() { local r="$1"; shift; git -C "$r" "$@"; }

mk_repo() {  # mk_repo <name> -> sets `repo` global to a fresh repo with one
             # registered row already committed.
  repo="$WORK/$1"
  mkdir -p "$repo"
  git_ "$repo" init -q -b main
  git_ "$repo" config user.email t@t
  git_ "$repo" config user.name t
  mkdir -p "$repo/$TEST_DIR"
  printf 'existing_test_runner.bb\tstanding\t\t\n' > "$repo/$MANIFEST"
  echo seed > "$repo/seed.txt"
  git_ "$repo" add -A
  git_ "$repo" commit -q -m seed
}

# ── 1. a staged, unregistered test file is refused, naming the row ──────
mk_repo unregistered
printf '#!/usr/bin/env bash\necho probe\n' > "$repo/$TEST_DIR/test_probe.sh"
git_ "$repo" add -A
set +e
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
set -e
if [[ $rc -eq 1 ]] && grep -q 'test_probe.sh' <<<"$out" && grep -q $'test_probe.sh\tstanding' <<<"$out"; then
  pass "an unregistered staged test file is refused, naming the file and the row"
else
  fail "expected a refusal naming test_probe.sh and its row, got rc=$rc: $out"
fi

# ── 2. the same file, registered in the SAME staged commit, is silent ───
mk_repo registered
printf '#!/usr/bin/env bash\necho probe\n' > "$repo/$TEST_DIR/test_probe.sh"
printf 'test_probe.sh\tstanding\t\t\n' >> "$repo/$MANIFEST"
git_ "$repo" add -A
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]]; then
  pass "a staged test file registered in the same commit is silent"
else
  fail "expected exit 0 for a registered staged file, got rc=$rc: $out"
fi

# ── 3. pre-existing drift (committed BEFORE this guard even ran) never
#      refuses a later, unrelated commit - the load-bearing property ──────
mk_repo drift
printf '#!/usr/bin/env bash\necho stale\n' > "$repo/$TEST_DIR/test_stale.sh"
git_ "$repo" add -A
git_ "$repo" commit -q -m "a stale unregistered file, already on HEAD"
echo unrelated > "$repo/README-unrelated.md"
git_ "$repo" add -A
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]]; then
  pass "pre-existing drift never refuses a later, unrelated commit"
else
  fail "expected exit 0 despite pre-existing drift, got rc=$rc: $out"
fi

# ── 4. an untracked (unstaged) file on disk is invisible - never reads
#      working-tree state ──────────────────────────────────────────────────
mk_repo untracked
printf '#!/usr/bin/env bash\necho untracked\n' > "$repo/$TEST_DIR/test_untracked.sh"
echo unrelated > "$repo/README-unrelated.md"
git_ "$repo" add -- README-unrelated.md
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]]; then
  pass "an untracked file on disk never refuses a commit that does not stage it"
else
  fail "expected exit 0 for an unstaged file, got rc=$rc: $out"
fi

# ── 5. fail-open: no readable staged manifest WARNS and exits 0 ─────────
mk_repo no-manifest
git_ "$repo" rm -q "$MANIFEST"
git_ "$repo" commit -q -m "remove the manifest entirely"
mkdir -p "$repo/$TEST_DIR"
printf '#!/usr/bin/env bash\necho orphan\n' > "$repo/$TEST_DIR/test_orphan.sh"
git_ "$repo" add -A
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]] && grep -qi 'WARNING' <<<"$out"; then
  pass "an unreadable staged manifest fails open with a WARNING, exit 0"
else
  fail "expected exit 0 with a WARNING for an unreadable manifest, got rc=$rc: $out"
fi

# ── 5b. Hardener addition: a repo's VERY FIRST commit (no HEAD yet) is
#      judged the same way as every later one ───────────────────────────
# unregistered_test_gate_lib.bb's diff-base falls back to the empty-tree
# SHA when HEAD does not resolve, so a brand-new repo's first commit is
# diffed against "nothing" rather than special-cased. Every fixture above
# (mk_repo) seeds one commit before ever staging anything the guard judges,
# so this branch was never reached by any test. Confirmed by hand-mutation:
# removing the empty-tree fallback (diff-base always resolves HEAD) left
# every existing test green.
repo="$WORK/first-commit-refused"
mkdir -p "$repo"
git_ "$repo" init -q -b main
git_ "$repo" config user.email t@t
git_ "$repo" config user.name t
mkdir -p "$repo/$TEST_DIR"
printf 'existing_test_runner.bb\tstanding\t\t\n' > "$repo/$MANIFEST"
printf '#!/usr/bin/env bash\necho probe\n' > "$repo/$TEST_DIR/test_probe.sh"
git_ "$repo" add -A
set +e
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
set -e
if [[ $rc -eq 1 ]] && grep -q 'test_probe.sh' <<<"$out"; then
  pass "a repo's very first commit (no HEAD) still refuses an unregistered staged test file"
else
  fail "expected the first commit to be refused for an unregistered file, got rc=$rc: $out"
fi

repo="$WORK/first-commit-registered"
mkdir -p "$repo"
git_ "$repo" init -q -b main
git_ "$repo" config user.email t@t
git_ "$repo" config user.name t
mkdir -p "$repo/$TEST_DIR"
printf 'test_probe.sh\tstanding\t\t\n' > "$repo/$MANIFEST"
printf '#!/usr/bin/env bash\necho probe\n' > "$repo/$TEST_DIR/test_probe.sh"
git_ "$repo" add -A
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]]; then
  pass "a repo's very first commit (no HEAD) is silent when the staged file is registered in the same commit"
else
  fail "expected exit 0 for a first commit registering its own file, got rc=$rc: $out"
fi

# ── 6. wiring: joins run_commit_guards.sh's Tier 1 (the pre-commit chain,
#      the only pre-existing live consumer), before the tier's own
#      guard_chain_has_refusal check ─────────────────────────────────────
RUNNER="$REPO_ROOT/swarmforge/scripts/run_commit_guards.sh"
if grep -q 'run_guard check_test_file_registration\.sh' "$RUNNER" \
   && [[ "$(grep -n 'run_guard check_test_file_registration\.sh' "$RUNNER" | cut -d: -f1)" \
       -lt "$(grep -n 'guard_chain_has_refusal' "$RUNNER" | head -1 | cut -d: -f1)" ]]; then
  pass "check_test_file_registration.sh is wired into run_commit_guards.sh's Tier 1, before the refusal check"
else
  fail "check_test_file_registration.sh is not wired into run_commit_guards.sh's Tier 1 (or wired after the refusal check)"
fi

# ── 7. NOT a tree-guard: never added to land_step_lib.bb's tree-guard list
#      (those run tree-wide against the replayed tree - exactly the shape
#      invariant 1 forbids) ─────────────────────────────────────────────
if grep -q 'check_test_file_registration' "$REPO_ROOT/swarmforge/scripts/land_step_lib.bb"; then
  fail "check_test_file_registration.sh must not join land_step_lib.bb's tree-guard list (BL-1424 scope)"
else
  pass "check_test_file_registration.sh does not join land_step_lib.bb's tree-guard list"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
