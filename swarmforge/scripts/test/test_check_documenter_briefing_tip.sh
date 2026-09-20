#!/usr/bin/env bash
# BL-1459: swarmforge/scripts/check_documenter_briefing_tip.sh, exercised
# directly (both entry modes) as REAL git subprocesses against a real
# throwaway repo - never a parallel reimplementation of its decision
# logic. Complements specs/features/BL-1459-a-documenter-briefing-lands-
# through-a-qa-note-inside-its-lane.feature, which drives the same guard
# through the REAL wired pre-merge-commit hook chain end to end; this
# suite is the fast, narrower layer that exercises the guard's own two
# entry modes without installing hooks. Hook mode is reached the same way
# a real `git merge --no-ff` reaches it - MERGE_HEAD present, mid-merge -
# via `git merge --no-ff --no-commit`, never a hand-simulated substitute
# for that file. BL-1444's own test (test_bl1444_art_director_tip_guard.sh)
# is this suite's direct template.
#
# BL-1390: every git command below runs through g()/gq(), which refuses
# (via in_fixture) unless the target directory's own `rev-parse
# --git-common-dir` resolves inside this run's $WORK - never the live
# repository, never `git -C ""`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GUARD="$REPO_ROOT/swarmforge/scripts/check_documenter_briefing_tip.sh"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1459-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1459_SUITE_BOUND_SECONDS:-600}" "$@"
trap 'rm -rf "$WORK"' EXIT

in_fixture() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" == "$WORK"/* && -d "$dir" ]] || return 1
  local common
  common="$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in /*) [[ "$common" == "$WORK"/* ]] || return 1 ;; *) : ;; esac
}
g() { in_fixture "$1" || { fail "refusing git outside the fixture: '${1:-<empty>}'"; return 1; }; git -C "$1" "${@:2}"; }
gq() { g "$@" >/dev/null 2>&1; }

DOC_BRANCH="swarmforge-documenter"

mk_repo() {  # mk_repo <name> -> sets `repo` global to a fresh repo with a
             # main branch and a documenter branch based on it.
  repo="$WORK/$1"
  mkdir -p "$repo"
  # git init CREATES the git-common-dir in_fixture's own check depends on,
  # so it runs directly, once, never through g()/gq() (test_bl1366's own
  # pattern) - every git command after this point goes through the
  # wrapper.
  git init -q -b main "$repo"
  g "$repo" config user.email t@t >/dev/null
  g "$repo" config user.name t >/dev/null
  g "$repo" commit -q --allow-empty -m init
  g "$repo" branch "$DOC_BRANCH" main
}

write_commit() {  # write_commit <repo> <branch> <path>... - one commit
                   # touching every given path, on <branch>.
  local r="$1" b="$2"
  shift 2
  g "$r" checkout -q "$b"
  local p
  for p in "$@"; do
    mkdir -p "$r/$(dirname "$p")"
    echo "content" > "$r/$p"
    g "$r" add "$p"
  done
  g "$r" commit -q -m "change: $*"
}

# ── 1. --print-lane ───────────────────────────────────────────────────
out="$(bash "$GUARD" --print-lane)"
if grep -q 'docs/briefings/<date>.md' <<<"$out" && grep -q 'docs/briefings/<date>.json' <<<"$out"; then
  pass "--print-lane prints the lane"
else
  fail "--print-lane did not print the expected lane: $out"
fi

# ── 2. direct mode: a tip that changes only the day's briefing file is OK
mk_repo direct-ok
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-01.md
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH")"; rc=$?
if [[ $rc -eq 0 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_OK' <<<"$out"; then
  pass "direct mode: a tip that changes only the day's briefing file is OK"
else
  fail "direct mode: expected DOCUMENTER_BRIEFING_TIP_OK exit 0, got rc=$rc: $out"
fi

# ── 2b. direct mode: the day's briefing plus its own same-date .json
#       sidecar is also OK ──────────────────────────────────────────────
mk_repo direct-ok-sidecar
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-02.md docs/briefings/2099-01-02.json
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH")"; rc=$?
if [[ $rc -eq 0 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_OK' <<<"$out"; then
  pass "direct mode: the day's briefing plus its own same-date .json sidecar is OK"
else
  fail "direct mode: expected DOCUMENTER_BRIEFING_TIP_OK for the briefing+sidecar pair, got rc=$rc: $out"
fi

# ── 3. direct mode: a tip that also changes .sent.json is refused, naming
#      it ───────────────────────────────────────────────────────────────
mk_repo direct-refused-sent-json
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-03.md docs/briefings/.sent.json
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_REFUSED' <<<"$out" && grep -q 'docs/briefings/.sent.json' <<<"$out"; then
  pass "direct mode: a tip touching docs/briefings/.sent.json is refused, naming it"
else
  fail "direct mode: expected refusal naming docs/briefings/.sent.json, got rc=$rc: $out"
fi

# ── 4. direct mode: a tip that also changes an unrelated doc is refused,
#      naming it ─────────────────────────────────────────────────────────
mk_repo direct-refused-other-doc
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-04.md docs/index.md
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'docs/index.md' <<<"$out"; then
  pass "direct mode: a tip touching docs/index.md is refused, naming it"
else
  fail "direct mode: expected refusal naming docs/index.md, got rc=$rc: $out"
fi

# ── 5. direct mode: a tip that also changes a code path is refused,
#      naming it ─────────────────────────────────────────────────────────
mk_repo direct-refused-code
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-05.md extension/src/extension.ts
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'extension/src/extension.ts' <<<"$out"; then
  pass "direct mode: a tip touching extension/src/extension.ts is refused, naming it"
else
  fail "direct mode: expected refusal naming extension/src/extension.ts, got rc=$rc: $out"
fi

# ── 6. direct mode: a commit not on the documenter branch is refused,
#      saying so ─────────────────────────────────────────────────────────
mk_repo direct-not-on-branch
write_commit "$repo" main docs/briefings/2099-01-06.md
tip="$(g "$repo" rev-parse HEAD)"
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_REFUSED' <<<"$out" && grep -qi "not on $DOC_BRANCH" <<<"$out"; then
  pass "direct mode: a commit not on the documenter branch is refused, saying so"
else
  fail "direct mode: expected the not-on-branch refusal, got rc=$rc: $out"
fi

# ── 7. direct mode: a day the landed main already carries is refused,
#      naming that day, even with a DIFFERENT byte content ─────────────
mk_repo direct-already-landed
write_commit "$repo" main docs/briefings/2099-01-07.md
write_commit "$repo" "$DOC_BRANCH" docs/index.md  # advance the branch off main's tip harmlessly
g "$repo" checkout -q "$DOC_BRANCH"
mkdir -p "$repo/docs/briefings"
echo "a different version" > "$repo/docs/briefings/2099-01-07.md"
g "$repo" add docs/briefings/2099-01-07.md
g "$repo" commit -q -m "re-send 2099-01-07 with different content"
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
if [[ $rc -eq 1 ]] && grep -q '2099-01-07' <<<"$out" && grep -qi 'already on main' <<<"$out"; then
  pass "direct mode: a day the landed main already carries is refused, even with different content"
else
  fail "direct mode: expected the already-landed-day refusal, got rc=$rc: $out"
fi

# ── 8. hook mode: an in-lane tip is never refused ───────────────────────
mk_repo hook-ok
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-08.md
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$DOC_BRANCH"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode: an in-lane tip is not refused"
else
  fail "hook mode: expected exit 0 for an in-lane tip, got rc=$rc: $out"
fi

# ── 9. hook mode: an out-of-lane tip is refused, naming the path ───────
mk_repo hook-refused
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-09.md extension/src/thing.ts
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$DOC_BRANCH"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 1 ]] && grep -q 'extension/src/thing.ts' <<<"$out"; then
  pass "hook mode: an out-of-lane tip is refused, naming the path"
else
  fail "hook mode: expected refusal naming the path, got rc=$rc: $out"
fi

# ── 10. hook mode: a day the landed main already carries is refused ────
mk_repo hook-already-landed
write_commit "$repo" main docs/briefings/2099-01-10.md
write_commit "$repo" "$DOC_BRANCH" docs/index.md
g "$repo" checkout -q "$DOC_BRANCH"
mkdir -p "$repo/docs/briefings"
echo "a different version" > "$repo/docs/briefings/2099-01-10.md"
g "$repo" add docs/briefings/2099-01-10.md
g "$repo" commit -q -m "re-send 2099-01-10"
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit "$DOC_BRANCH"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 1 ]] && grep -q '2099-01-10' <<<"$out" && grep -qi 'already' <<<"$out"; then
  pass "hook mode: a day the landed main already carries is refused"
else
  fail "hook mode: expected the already-landed-day refusal, got rc=$rc: $out"
fi

# ── 11. hook mode: a merge whose incoming parent is not reachable from
#       the documenter branch exits 0 without judging ──────────────────
mk_repo hook-not-documenter
write_commit "$repo" main extension/src/other.ts
g "$repo" branch other-role main
write_commit "$repo" other-role extension/src/thing.ts
g "$repo" checkout -q -b landing main
gq "$repo" merge -q --no-ff --no-commit other-role
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode: a merge not from the documenter branch exits 0 without judging"
else
  fail "hook mode: expected exit 0 for a non-documenter merge, got rc=$rc: $out"
fi

# ── 12. hook mode: a merge of main's own tip is never judged, even after
#       the documenter merged main ──────────────────────────────────────
mk_repo hook-main-sync
early_main="$(g "$repo" rev-parse main)"
write_commit "$repo" main extension/src/main_change.ts
g "$repo" checkout -q "$DOC_BRANCH"
g "$repo" merge -q --no-ff -m "documenter merges main" main
g "$repo" checkout -q -b role-branch "$early_main"
gq "$repo" merge -q --no-ff --no-commit main
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode: a merge of main's own tip is never judged"
else
  fail "hook mode: expected exit 0 for main's own tip, got rc=$rc: $out"
fi

# ── 13. hook mode: content carried from the landed main is exempt by
#       provenance ────────────────────────────────────────────────────
mk_repo hook-provenance
early_main="$(g "$repo" rev-parse main)"
write_commit "$repo" main extension/src/main_change.ts
g "$repo" checkout -q "$DOC_BRANCH"
g "$repo" merge -q --no-ff -m "documenter merges main" main
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-13.md
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q -b landing "$early_main"
gq "$repo" merge -q --no-ff --no-commit "$tip"
out="$(cd "$repo" && bash "$GUARD" --branch "$DOC_BRANCH" 2>&1)"; rc=$?
gq "$repo" merge --abort
if [[ $rc -eq 0 ]]; then
  pass "hook mode: content carried from the landed main is exempt by provenance"
else
  fail "hook mode: expected exit 0 (provenance exemption), got rc=$rc: $out"
fi

# ── 14. --branch resolves via .swarmforge/roles.tsv when not given
#        explicitly ───────────────────────────────────────────────────
mk_repo roles-tsv-resolution
mkdir -p "$repo/.swarmforge"
printf 'documenter\tdocumenter\t%s\t%s\tDocumenter\tclaude\ttask\n' "$repo" "$DOC_BRANCH" > "$repo/.swarmforge/roles.tsv"
write_commit "$repo" "$DOC_BRANCH" docs/briefings/2099-01-14.md
tip="$(g "$repo" rev-parse HEAD)"
g "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip")"; rc=$?
if [[ $rc -eq 0 ]] && grep -q 'DOCUMENTER_BRIEFING_TIP_OK' <<<"$out"; then
  pass "the documenter branch resolves from .swarmforge/roles.tsv when --branch is not given"
else
  fail "expected roles.tsv resolution to find the documenter branch, got rc=$rc: $out"
fi

# ── 15. wiring: joins pre-merge-commit's chain, never
#        run_commit_guards.sh's (out of scope, BL-1459/BL-1444) ─────────
if grep -q 'run_guard check_documenter_briefing_tip\.sh' "$REPO_ROOT/swarmforge/git-hooks/pre-merge-commit"; then
  pass "check_documenter_briefing_tip.sh is wired into pre-merge-commit's chain"
else
  fail "check_documenter_briefing_tip.sh is not wired into pre-merge-commit's chain"
fi
if grep -q 'check_documenter_briefing_tip' "$REPO_ROOT/swarmforge/scripts/run_commit_guards.sh"; then
  fail "check_documenter_briefing_tip.sh must not join run_commit_guards.sh's pre-commit chain (out of scope)"
else
  pass "check_documenter_briefing_tip.sh does not join run_commit_guards.sh's pre-commit chain"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
