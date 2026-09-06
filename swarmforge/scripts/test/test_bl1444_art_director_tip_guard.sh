#!/usr/bin/env bash
# BL-1444: swarmforge/scripts/check_art_director_tip.sh, exercised directly
# (both entry modes) as REAL git subprocesses against a real throwaway repo -
# never a parallel reimplementation of its decision logic. Complements
# specs/features/BL-1444-the-art-directors-tip-lands-on-main-by-qa.feature,
# which drives the same guard through the REAL wired pre-merge-commit hook
# chain end to end; this suite is the fast, narrower layer that exercises
# the guard's own two entry modes without installing hooks. Hook mode is
# reached the same way a real `git merge --no-ff` reaches it - MERGE_HEAD
# present, mid-merge - via `git merge --no-ff --no-commit`, never a
# hand-simulated substitute for that file.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GUARD="$REPO_ROOT/swarmforge/scripts/check_art_director_tip.sh"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1444-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1444_SUITE_BOUND_SECONDS:-600}" "$@"
trap 'rm -rf "$WORK"' EXIT

git_() { local r="$1"; shift; git -C "$r" "$@"; }

mk_repo() {  # mk_repo <name> -> sets `repo` global to a fresh repo with a
             # main branch and a primary/art-director branch based on it.
  repo="$WORK/$1"
  mkdir -p "$repo"
  git_ "$repo" init -q -b main
  git_ "$repo" config user.email t@t
  git_ "$repo" config user.name t
  git_ "$repo" commit -q --allow-empty -m init
  git_ "$repo" branch primary/art-director main
}

write_commit() {  # write_commit <repo> <branch> <path>... - one commit
                   # touching every given path, on <branch>.
  local r="$1" b="$2"
  shift 2
  git_ "$r" checkout -q "$b"
  local p
  for p in "$@"; do
    mkdir -p "$r/$(dirname "$p")"
    echo "content" > "$r/$p"
    git_ "$r" add "$p"
  done
  git_ "$r" commit -q -m "change: $*"
}

# ── 1. --print-lane ───────────────────────────────────────────────────
out="$(bash "$GUARD" --print-lane)"
if grep -qx 'docs/design/' <<<"$out" && grep -q 'backlog/evidence/.*art-director' <<<"$out"; then
  pass "--print-lane prints the lane"
else
  fail "--print-lane did not print the expected lane: $out"
fi

# ── 2. direct mode: an in-lane tip is OK ────────────────────────────────
mk_repo direct-ok
write_commit "$repo" primary/art-director docs/design/system.md
tip="$(git_ "$repo" rev-parse HEAD)"
git_ "$repo" checkout -q main
out="$(cd "$repo" && bash "$GUARD" --tip "$tip")"; rc=$?
if [[ $rc -eq 0 ]] && grep -q 'ART_DIRECTOR_TIP_OK' <<<"$out"; then
  pass "direct mode: an in-lane tip is OK"
else
  fail "direct mode: expected ART_DIRECTOR_TIP_OK exit 0, got rc=$rc: $out"
fi

# ── 3. direct mode: an out-of-lane tip is refused, naming the path ─────
mk_repo direct-refused
write_commit "$repo" primary/art-director extension/src/thing.ts
tip="$(git_ "$repo" rev-parse HEAD)"
git_ "$repo" checkout -q main
set +e
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" 2>&1)"; rc=$?
set -e
if [[ $rc -eq 1 ]] && grep -q 'ART_DIRECTOR_TIP_REFUSED' <<<"$out" && grep -q 'extension/src/thing.ts' <<<"$out"; then
  pass "direct mode: an out-of-lane tip is refused, naming the path"
else
  fail "direct mode: expected ART_DIRECTOR_TIP_REFUSED naming the path, got rc=$rc: $out"
fi

# ── 4. direct mode: a commit not on primary/art-director is refused,
#      saying so ─────────────────────────────────────────────────────────
mk_repo direct-not-on-branch
write_commit "$repo" main docs/design/system.md
tip="$(git_ "$repo" rev-parse HEAD)"
set +e
out="$(cd "$repo" && bash "$GUARD" --tip "$tip" 2>&1)"; rc=$?
set -e
if [[ $rc -eq 1 ]] && grep -q 'ART_DIRECTOR_TIP_REFUSED' <<<"$out" && grep -qi 'not on primary/art-director' <<<"$out"; then
  pass "direct mode: a commit not on primary/art-director is refused, saying so"
else
  fail "direct mode: expected the not-on-branch refusal, got rc=$rc: $out"
fi

# ── 5. hook mode: an in-lane tip is never refused ───────────────────────
mk_repo hook-ok
write_commit "$repo" primary/art-director docs/design/briefs/x.md
git_ "$repo" checkout -q -b landing main
git_ "$repo" merge -q --no-ff --no-commit primary/art-director >/dev/null 2>&1
set +e
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
set -e
git_ "$repo" merge --abort >/dev/null 2>&1 || true
if [[ $rc -eq 0 ]]; then
  pass "hook mode: an in-lane tip is not refused"
else
  fail "hook mode: expected exit 0 for an in-lane tip, got rc=$rc: $out"
fi

# ── 6. hook mode: an out-of-lane tip is refused, naming the path ───────
mk_repo hook-refused
write_commit "$repo" primary/art-director extension/src/thing.ts
git_ "$repo" checkout -q -b landing main
git_ "$repo" merge -q --no-ff --no-commit primary/art-director >/dev/null 2>&1
set +e
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
set -e
git_ "$repo" merge --abort >/dev/null 2>&1 || true
if [[ $rc -eq 1 ]] && grep -q 'extension/src/thing.ts' <<<"$out"; then
  pass "hook mode: an out-of-lane tip is refused, naming the path"
else
  fail "hook mode: expected refusal naming the path, got rc=$rc: $out"
fi

# ── 7. hook mode: a merge of main's own tip is never judged, even after
#      the art director merged main ──────────────────────────────────────
mk_repo hook-main-sync
early_main="$(git_ "$repo" rev-parse main)"
write_commit "$repo" main extension/src/main_change.ts
git_ "$repo" checkout -q primary/art-director
git_ "$repo" merge -q --no-ff -m "art-director merges main" main
git_ "$repo" checkout -q -b role-branch "$early_main"
git_ "$repo" merge -q --no-ff --no-commit main >/dev/null 2>&1
set +e
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
set -e
git_ "$repo" merge --abort >/dev/null 2>&1 || true
if [[ $rc -eq 0 ]]; then
  pass "hook mode: a merge of main's own tip is never judged"
else
  fail "hook mode: expected exit 0 for main's own tip, got rc=$rc: $out"
fi

# ── 8. hook mode: content carried from the landed main is exempt by
#      provenance ─────────────────────────────────────────────────────────
mk_repo hook-provenance
early_main="$(git_ "$repo" rev-parse main)"
write_commit "$repo" main extension/src/main_change.ts
git_ "$repo" checkout -q primary/art-director
git_ "$repo" merge -q --no-ff -m "art-director merges main" main
write_commit "$repo" primary/art-director docs/design/system.md
tip="$(git_ "$repo" rev-parse HEAD)"
git_ "$repo" checkout -q -b landing "$early_main"
git_ "$repo" merge -q --no-ff --no-commit "$tip" >/dev/null 2>&1
set +e
out="$(cd "$repo" && bash "$GUARD" 2>&1)"; rc=$?
set -e
git_ "$repo" merge --abort >/dev/null 2>&1 || true
if [[ $rc -eq 0 ]]; then
  pass "hook mode: content carried from the landed main is exempt by provenance"
else
  fail "hook mode: expected exit 0 (provenance exemption), got rc=$rc: $out"
fi

# ── 9. wiring: joins pre-merge-commit's chain, never run_commit_guards.sh's
#      (out of scope, BL-1444) ────────────────────────────────────────────
if grep -q 'run_guard check_art_director_tip\.sh' "$REPO_ROOT/swarmforge/git-hooks/pre-merge-commit"; then
  pass "check_art_director_tip.sh is wired into pre-merge-commit's chain"
else
  fail "check_art_director_tip.sh is not wired into pre-merge-commit's chain"
fi
if grep -q 'check_art_director_tip' "$REPO_ROOT/swarmforge/scripts/run_commit_guards.sh"; then
  fail "check_art_director_tip.sh must not join run_commit_guards.sh's pre-commit chain (out of scope, BL-1444)"
else
  pass "check_art_director_tip.sh does not join run_commit_guards.sh's pre-commit chain"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
