#!/usr/bin/env bash
# BL-1390 e2e: a commit on the shared main checkout is pushed while it still
# fast-forwards - driven through the REAL hook, a REAL git repository and a
# REAL bare origin. The hook is what git runs; a test that called the bb
# runner directly would never prove the hook itself is wired.
#
# BL-1242: a chain of independent guards must NOT run under `set -e` - the
# first failure would abort the rest and mask them.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HOOKS_DIR="$REPO_ROOT/swarmforge/git-hooks"
FIXTURE_PREFIX="bl1390-post-commit-"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

# A killed run traps no `finally`, so the previous run's fixtures are swept by
# prefix BEFORE this one starts as well (BL-971). These roots are this test's
# own, one run at a time.
rm -rf "${TMPDIR:-/tmp}/${FIXTURE_PREFIX}"* 2>/dev/null || true
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${FIXTURE_PREFIX}XXXXXX")" || exit 1
trap 'rm -rf "$WORK"' EXIT

# EVERY git call in this file goes through a guarded helper, and the guard is
# not decoration. An early draft of this test called `git -C "$root" ...` with
# `$root` empty (a broken fixture setup left it unset), and `git -C ""` does
# NOT fail - it operates on the CURRENT directory, so a `git add -A` and a
# commit meant for a throwaway fixture landed on this repository's own branch,
# sweeping in unrelated untracked files: the exact BL-506 violation, made by a
# test. Refusing anything that is not under $WORK makes that unreachable.
in_fixture() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" == "$WORK"/* && -d "$dir" ]]
}

git_q() {
  in_fixture "$1" || { fail "refusing git in a non-fixture directory: '${1:-<empty>}'"; return 1; }
  git -C "$1" "${@:2}" >/dev/null 2>&1
}

# A master checkout on main with a bare origin, and the real hooks installed.
# Sets $root (and $origin) for the caller. Deliberately NOT a function that
# echoes its path: a command substitution runs in a subshell, whose exit fires
# the EXIT trap above and deletes the fixture root out from under the test.
setup_repo() {
  name="$1"; root="$WORK/$name"; origin="$WORK/$name-origin.git"
  mkdir -p "$root"
  git init -q --bare "$origin"
  git init -q -b main "$root"
  git -C "$root" config user.email t@t
  git -C "$root" config user.name t
  git -C "$root" config commit.gpgsign false
  git -C "$root" config core.hooksPath "$HOOKS_DIR"
  git -C "$root" remote add origin "$origin"
  # The hook resolves its repo root from its own location, so the fixture gets
  # the scripts it needs rather than the hook reaching into this checkout.
  mkdir -p "$root/swarmforge/git-hooks"
  cp -R "$REPO_ROOT/swarmforge/scripts" "$root/swarmforge/scripts"
  # ONLY the post-commit hook. Copying the whole hooks directory would install
  # the full commit guard chain into the fixture, which refuses (and runs the
  # property suite) on a repository that is not this one - the fixture would be
  # testing the guards, not the hook.
  cp "$HOOKS_DIR/post-commit" "$root/swarmforge/git-hooks/post-commit"
  git -C "$root" config core.hooksPath "$root/swarmforge/git-hooks"
  echo seed > "$root/seed.txt"
  # The setup checks itself. A fixture that silently fails to seed reads later
  # as "the hook pushed while diverged" - a defect report against working code,
  # which is exactly what happened while this test was being written.
  git -C "$root" add -A >/dev/null 2>&1 || fail "setup($name): git add failed"
  git -C "$root" commit -m "seed" >/dev/null 2>&1 || fail "setup($name): seed commit failed"
  local push_err
  push_err="$(git -C "$root" push -u origin main 2>&1)" || fail "setup($name): seed push failed: $push_err"
}

counts() { git -C "$1" rev-list --left-right --count origin/main...main 2>/dev/null | tr '\t' '/'; }
log_of() { cat "$1/.swarmforge/daemon/post-commit-push.log" 2>/dev/null || true; }

commit_on() {
  local root="$1" file="$2"
  in_fixture "$root" || { fail "refusing to commit outside the fixture: '${root:-<empty>}'"; return 1; }
  echo "$RANDOM" > "$root/$file"
  git -C "$root" add -A >/dev/null 2>&1
  git -C "$root" commit -q -m "BL-9390: fixture commit $file" >/dev/null 2>&1
}

# ── 1. origin unchanged: the hook pushes at once ───────────────────────────
setup_repo one
commit_on "$root" a.txt
git_q "$root" fetch origin main
if [[ "$(counts "$root")" == "0/0" ]]; then
  pass "a commit made while origin has not moved is pushed immediately (ahead/behind 0/0)"
else
  fail "expected 0/0 after the hook, got $(counts "$root") - log: $(log_of "$root")"
fi
if [[ "$(git -C "$root" rev-parse main)" == "$(git -C "$root" rev-parse origin/main)" ]]; then
  pass "origin/main carries the commit the hook pushed"
else
  fail "origin/main does not equal local main"
fi
if log_of "$root" | grep -q "pushed"; then
  pass "the push is logged by the hook"
else
  fail "the hook logged no push: $(log_of "$root")"
fi

# ── 2. origin advanced first: never a push, logged diverged ────────────────
setup_repo two
other="$WORK/two-other"
# `-b main` is load-bearing: the bare origin's own HEAD still points at the
# init default (master), so a plain clone lands on an unborn branch and the
# push below fails with "src refspec main does not match any" - silently,
# leaving origin unmoved and the whole scenario meaningless.
git clone -q -b main "$WORK/two-origin.git" "$other"
git -C "$other" config user.email t@t; git -C "$other" config user.name t
git -C "$other" config commit.gpgsign false
echo remote > "$other/remote.txt"
git -C "$other" add -A >/dev/null 2>&1 || fail "scenario 02 setup: add failed"
git -C "$other" commit -qm "somebody else's commit" >/dev/null 2>&1 || fail "scenario 02 setup: commit failed"
other_push_err="$(git -C "$other" push origin main 2>&1)" || fail "scenario 02 setup: push failed: $other_push_err"
before_origin="$(git -C "$WORK/two-origin.git" rev-parse main 2>/dev/null)"
# The PREMISE, asserted rather than assumed: origin must really be one commit
# ahead of this checkout before the scenario means anything. A fixture that
# failed to set that up would otherwise read as "the hook pushed while
# diverged" - a defect report against working code.
git_q "$root" fetch origin "+refs/heads/main:refs/remotes/origin/main"
premise="$(git -C "$root" rev-list --left-right --count origin/main...main 2>/dev/null | tr '\t' '/')"
if [[ "$premise" != "1/0" ]]; then
  fail "scenario 02 premise not established: expected origin 1 ahead (behind/ahead 1/0), got '$premise'"
fi
commit_on "$root" b.txt
after_origin="$(git -C "$WORK/two-origin.git" rev-parse main)"
if [[ "$before_origin" == "$after_origin" ]]; then
  pass "a commit made after origin moved pushes nothing"
else
  fail "the hook pushed while diverged - origin moved from $before_origin to $after_origin"
fi
if log_of "$root" | grep -q "diverged"; then
  pass "the hook logs diverged"
else
  fail "the hook did not log diverged: $(log_of "$root")"
fi
if git -C "$root" log -1 --format=%s | grep -q "fixture commit b.txt"; then
  pass "the commit is intact on local main"
else
  fail "the commit was disturbed"
fi

# ── 3. a linked role worktree never pushes, and never fetches ──────────────
setup_repo three
# Named for this fixture, and pruned below: `git worktree add` writes a
# registration into the repository it runs in, which outlives $WORK.
git_q "$root" worktree add -b bl1390-fixture-role "$WORK/three-coder"
wt="$WORK/three-coder"
git -C "$wt" config user.email t@t; git -C "$wt" config user.name t
before_origin="$(git -C "$WORK/three-origin.git" rev-parse main)"
# Only what THIS commit logs counts: the fixture's own seed commit logged a
# line already (origin was empty at that moment), and comparing against an
# empty file would be measuring the seed rather than the worktree.
log_lines_before="$( { log_of "$root"; log_of "$wt"; } | wc -l | tr -d ' ')"
commit_on "$wt" c.txt
if [[ "$before_origin" == "$(git -C "$WORK/three-origin.git" rev-parse main)" ]]; then
  pass "a commit on a linked role worktree pushes nothing"
else
  fail "a role worktree commit reached origin"
fi
log_lines_after="$( { log_of "$root"; log_of "$wt"; } | wc -l | tr -d ' ')"
if [[ "$log_lines_before" == "$log_lines_after" ]]; then
  pass "nothing is logged by the hook for a role worktree commit (no fetch, no push)"
else
  fail "the hook logged $((log_lines_after - log_lines_before)) line(s) for a role worktree commit: $(log_of "$root")$(log_of "$wt")"
fi

# The worktree registration is this scenario's own artifact - removed here so
# nothing of the fixture survives it, whatever $WORK's own cleanup does.
git_q "$root" worktree remove --force "$WORK/three-coder"
git_q "$root" worktree prune
git_q "$root" branch -D bl1390-fixture-role

# ── 4. unreachable origin: bounded, logged, commit intact ──────────────────
setup_repo four
git -C "$root" remote set-url origin "$WORK/does-not-exist.git"
started=$(date +%s)
commit_on "$root" d.txt
elapsed=$(( $(date +%s) - started ))
bound="${SWARMFORGE_POST_COMMIT_PUSH_TIMEOUT:-20}"
if (( elapsed <= bound + 10 )); then
  pass "an unreachable origin costs a bounded wait (${elapsed}s)"
else
  fail "the commit took ${elapsed}s, past the ${bound}s bound"
fi
if git -C "$root" log -1 --format=%s | grep -q "fixture commit d.txt"; then
  pass "the commit completes and is intact with origin unreachable"
else
  fail "the commit did not complete with origin unreachable"
fi
if log_of "$root" | grep -qE "fetch-failed|push-failed|counts-unknown"; then
  pass "the hook logs that the push was not attempted"
else
  fail "the hook logged nothing for an unreachable origin: $(log_of "$root")"
fi

# ── 5. two quick commits both reach origin, in order, no force ─────────────
setup_repo five
commit_on "$root" e1.txt
commit_on "$root" e2.txt
git_q "$root" fetch origin main
if [[ "$(git -C "$root" rev-parse main)" == "$(git -C "$root" rev-parse origin/main)" ]]; then
  pass "two commits in quick succession both reach origin in order"
else
  fail "origin/main lags after two quick commits: $(counts "$root")"
fi
if log_of "$root" | grep -q -- "--force"; then
  fail "a push used --force"
else
  pass "no push used force"
fi
# The hook shells no push of its own - the one adapter is push_sweep_lib.bb's.
if grep -v '^[[:space:]]*#' "$HOOKS_DIR/post-commit" | grep -q "git push"; then
  fail "the hook shells its own git push instead of using the one adapter"
else
  pass "the hook contains no git push of its own (BL-1198)"
fi

if [[ $status -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
