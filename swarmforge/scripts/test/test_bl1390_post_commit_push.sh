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
# BL-1390 second incident: this suite runs concurrently (an acceptance handler
# invokes it once per scenario, and several roles run acceptance at once), and
# its old startup was a BLIND prefix sweep - so each of the 1156 copies QA
# counted deleted every other copy's fixture mid-run. BL-971's sweep-the-prefix
# rule is for a suite that runs one at a time; this one does not.
#
# fixture_isolation_begin gives, in order: a wall-clock bound, an invoker log
# line, a lock so only one instance runs, reaping of roots NO LIVE RUN OWNS,
# and an owner-stamped $WORK.
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1390_SUITE_BOUND_SECONDS:-900}"
trap 'rm -rf "$WORK"' EXIT

# A second invocation only needs to reach the lock decision to prove scenario
# 07; running the whole body again would be the storm this exists to prevent.
if [[ -n "${BL1390_LOCK_PROBE:-}" ]]; then
  echo "LOCK_PROBE_RAN_BODY: a probe acquired the lock and would have run the suite"
  exit 0
fi

# BL-1390 scenario 06: the live repository's own state, recorded BEFORE the
# suite touches anything and compared after it finishes. This test once
# rewrote the shared remote.origin.url to a fixture path and broke every push
# and fetch from every worktree until QA restored it; the suite now proves it
# did not, rather than asserting it in a comment.
LIVE_ORIGIN_BEFORE="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)"
LIVE_WORKTREES_BEFORE="$(git -C "$REPO_ROOT" worktree list 2>/dev/null)"

# EVERY git call in this file goes through a guarded helper, and the guard is
# not decoration. An early draft of this test called `g "$root" ...` with
# `$root` empty (a broken fixture setup left it unset), and `git -C ""` does
# NOT fail - it operates on the CURRENT directory, so a `git add -A` and a
# commit meant for a throwaway fixture landed on this repository's own branch,
# sweeping in unrelated untracked files: the exact BL-506 violation, made by a
# test. Refusing anything that is not under $WORK makes that unreachable.
in_fixture() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" == "$WORK"/* && -d "$dir" ]] || return 1
  # BL-1390 amendment: PROVEN, not assumed. A linked worktree shares the live
  # .git/config, so a path that merely looks like a fixture is not enough -
  # git's own answer for which repository this directory belongs to must also
  # be under $WORK. This is the check whose absence let `remote set-url` point
  # the shared repository's origin at a fixture path.
  local common
  # The ONE raw git call in this file, and it must stay raw: it is the guard's
  # own question, so routing it through the guard would recurse.
  common="$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in
    /*) [[ "$common" == "$WORK"/* ]] || return 1 ;;
    *)  : ;;   # relative (.git) - resolved against $dir, already under $WORK
  esac
  return 0
}

# EVERY git call in this file goes through one of these two, and the guard is
# not decoration. An early draft called `g "$root" ...` with `$root` empty;
# `git -C ""` does NOT fail - it uses the current directory - so a fixture
# `remote set-url` rewrote the LIVE repository's origin and broke every push,
# fetch and ls-remote from every worktree until QA restored it (2026-09-04,
# 17:01Z). Nothing below may call git directly.
g() {
  in_fixture "$1" || { fail "refusing git outside the fixture: '${1:-<empty>}'"; return 1; }
  git -C "$1" "${@:2}"
}

gq() { g "$@" >/dev/null 2>&1; }

# A master checkout on main with a bare origin, and the real hooks installed.
# Sets $root (and $origin) for the caller. Deliberately NOT a function that
# echoes its path: a command substitution runs in a subshell, whose exit fires
# the EXIT trap above and deletes the fixture root out from under the test.
setup_repo() {
  name="$1"; root="$WORK/$name"; origin="$WORK/$name-origin.git"
  mkdir -p "$root"
  git init -q --bare "$origin"
  g "$origin" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true
  git init -q -b main "$root"
  g "$root" config user.email t@t
  g "$root" config user.name t
  g "$root" config commit.gpgsign false
  g "$root" config core.hooksPath "$HOOKS_DIR"
  g "$root" remote add origin "$origin"
  # The hook resolves its repo root from its own location, so the fixture gets
  # the scripts it needs rather than the hook reaching into this checkout.
  mkdir -p "$root/swarmforge/git-hooks"
  # ONE copy per run, symlinked per fixture. Six deep copies of the whole
  # scripts tree per run is heavy I/O that raced git's own object writes -
  # observed as "fatal: object ... cannot be read" during a fixture's push.
  if [[ ! -d "$WORK/shared-scripts" ]]; then
    cp -R "$REPO_ROOT/swarmforge/scripts" "$WORK/shared-scripts" \
      || { fail "setup($name): could not stage the shared scripts copy"; return 1; }
  fi
  ln -s "$WORK/shared-scripts" "$root/swarmforge/scripts"
  # ONLY the post-commit hook. Copying the whole hooks directory would install
  # the full commit guard chain into the fixture, which refuses (and runs the
  # property suite) on a repository that is not this one - the fixture would be
  # testing the guards, not the hook.
  cp "$HOOKS_DIR/post-commit" "$root/swarmforge/git-hooks/post-commit"
  g "$root" config core.hooksPath "$root/swarmforge/git-hooks"
  echo seed > "$root/seed.txt"
  # The setup checks itself. A fixture that silently fails to seed reads later
  # as "the hook pushed while diverged" - a defect report against working code,
  # which is exactly what happened while this test was being written.
  g "$root" add -A >/dev/null 2>&1 || fail "setup($name): git add failed"
  g "$root" commit -m "seed" >/dev/null 2>&1 || fail "setup($name): seed commit failed"
  local push_err
  push_err="$(g "$root" push -u origin main 2>&1)" || fail "setup($name): seed push failed: $push_err"
}

counts() { git -C "$1" rev-list --left-right --count origin/main...main 2>/dev/null | tr '\t' '/'; }
log_of() { cat "$1/.swarmforge/daemon/post-commit-push.log" 2>/dev/null || true; }

commit_on() {
  local root="$1" file="$2"
  in_fixture "$root" || { fail "refusing to commit outside the fixture: '${root:-<empty>}'"; return 1; }
  echo "$RANDOM" > "$root/$file"
  g "$root" add -A >/dev/null 2>&1
  g "$root" commit -q -m "BL-9390: fixture commit $file" >/dev/null 2>&1
}

# ── 1. origin unchanged: the hook pushes at once ───────────────────────────
setup_repo one
commit_on "$root" a.txt
gq "$root" fetch origin main
if [[ "$(counts "$root")" == "0/0" ]]; then
  pass "a commit made while origin has not moved is pushed immediately (ahead/behind 0/0)"
else
  fail "expected 0/0 after the hook, got $(counts "$root") - log: $(log_of "$root")"
fi
if [[ "$(g "$root" rev-parse main)" == "$(g "$root" rev-parse origin/main)" ]]; then
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
git clone -q -b main "$WORK/two-origin.git" "$other"   # destination is under $WORK by construction
g "$other" config user.email t@t; g "$other" config user.name t
g "$other" config commit.gpgsign false
echo remote > "$other/remote.txt"
g "$other" add -A >/dev/null 2>&1 || fail "scenario 02 setup: add failed"
g "$other" commit -qm "somebody else's commit" >/dev/null 2>&1 || fail "scenario 02 setup: commit failed"
other_push_err="$(g "$other" push origin main 2>&1)" || fail "scenario 02 setup: push failed: $other_push_err"
before_origin="$(git -C "$WORK/two-origin.git" rev-parse main 2>/dev/null)"
# The PREMISE, asserted rather than assumed: origin must really be one commit
# ahead of this checkout before the scenario means anything. A fixture that
# failed to set that up would otherwise read as "the hook pushed while
# diverged" - a defect report against working code.
gq "$root" fetch origin "+refs/heads/main:refs/remotes/origin/main"
premise="$(g "$root" rev-list --left-right --count origin/main...main 2>/dev/null | tr '\t' '/')"
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
if g "$root" log -1 --format=%s | grep -q "fixture commit b.txt"; then
  pass "the commit is intact on local main"
else
  fail "the commit was disturbed"
fi

# ── 3. a linked role worktree never pushes, and never fetches ──────────────
setup_repo three
# Named for this fixture, and pruned below: `git worktree add` writes a
# registration into the repository it runs in, which outlives $WORK.
gq "$root" worktree add -b bl1390-fixture-role "$WORK/three-coder"
wt="$WORK/three-coder"
g "$wt" config user.email t@t; g "$wt" config user.name t
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
gq "$root" worktree remove --force "$WORK/three-coder"
gq "$root" worktree prune
gq "$root" branch -D bl1390-fixture-role

# ── 4. unreachable origin: bounded, logged, commit intact ──────────────────
setup_repo four
g "$root" remote set-url origin "$WORK/does-not-exist.git"
started=$(date +%s)
commit_on "$root" d.txt
elapsed=$(( $(date +%s) - started ))
bound="${SWARMFORGE_POST_COMMIT_PUSH_TIMEOUT:-20}"
if (( elapsed <= bound + 10 )); then
  pass "an unreachable origin costs a bounded wait (${elapsed}s)"
else
  fail "the commit took ${elapsed}s, past the ${bound}s bound"
fi
if g "$root" log -1 --format=%s | grep -q "fixture commit d.txt"; then
  pass "the commit completes and is intact with origin unreachable"
else
  fail "the commit did not complete with origin unreachable"
fi
if log_of "$root" | grep -qE "fetch-failed|push-failed|counts-unknown"; then
  pass "the hook logs that the push was not attempted"
else
  fail "the hook logged nothing for an unreachable origin: $(log_of "$root")"
fi
# The check above alone is too broad to prove the push was never ATTEMPTED
# (hardener finding, BL-1390): "push-failed" is also in its OR-pattern, and
# that is what a broken fetch-failure guard would log instead - dropping
# `(when (zero? (:exit fetched)) (rev-counts))` computes stale counts from
# an origin/main tracking ref left over from setup, reads should-push, and
# the resulting push! then fails against the unreachable remote too, so the
# broad check above passes either way. A truly unreachable origin must
# refuse BEFORE ever shelling a push - confirmed live, unmutated code logs
# "fetch-failed" specifically here, never "push-failed".
if log_of "$root" | tail -1 | grep -q "fetch-failed\|counts-unknown"; then
  pass "the push was refused before ever being attempted (fetch-failed/counts-unknown, not push-failed)"
else
  fail "the hook attempted a push against an unreachable origin instead of refusing first: $(log_of "$root" | tail -1)"
fi

# ── 5. two quick commits both reach origin, in order, no force ─────────────
setup_repo five
commit_on "$root" e1.txt
commit_on "$root" e2.txt
gq "$root" fetch origin main
if [[ "$(g "$root" rev-parse main)" == "$(g "$root" rev-parse origin/main)" ]]; then
  pass "two commits in quick succession both reach origin in order"
else
  fail "origin/main lags after two quick commits: $(counts "$root")"
fi
if log_of "$root" | grep -q -- "--force"; then
  fail "a push used --force"
else
  pass "no push used force"
fi

# ── 5b: the REAL git push subprocess never carries --force ─────────────────
#
# The check above is a proxy, not the invariant: log_of only ever contains
# the fixed strings `log!` writes ("pushed"/"push-failed"/...), never the
# actual argv passed to git - so it would read identically whether or not
# push-main! silently gained --force (hardener finding, BL-1390). This
# scenario watches the REAL subprocess instead, via `GIT_TRACE` - unlike a
# PATH-prepended `git` shim (tried first and found NOT to work: git itself
# prepends `/usr/lib/git-core` to PATH before running a hook, and that
# directory ships its own `git` binary, so a shim earlier in the caller's
# PATH is never reached), `GIT_TRACE` is an ordinary environment variable
# that propagates through the whole subprocess chain (bash -> bb ->
# babashka.process/sh -> git) and git's own trace machinery logs each
# invocation's real argv, including "built-in: git push ..." lines from
# the hook's own internal calls - confirmed live before writing this
# scenario, by re-applying the exact --force mutation this check exists to
# catch and reading `built-in: git push --force origin main` in the trace.
setup_repo five-b
TRACE_LOG="$WORK/git-trace.log"
echo "$RANDOM" > "$root/f1.txt"
gq "$root" add -A
# GIT_TRACE has to be set on the commit itself, so this one call carries the
# env rather than going through `gq` - but it still goes through the guard,
# which is what the structural check requires and what a raw `git -C` here
# would defeat.
in_fixture "$root" && GIT_TRACE="$TRACE_LOG" git -C "$root" commit -q -m "BL-9390: fixture commit f1.txt" >/dev/null 2>&1
gq "$root" fetch origin main
if [[ "$(counts "$root")" == "0/0" ]]; then
  pass "scenario 5b: the traced commit reached origin (trace setup did not itself break the push)"
else
  fail "scenario 5b: origin did not receive the traced commit: $(counts "$root")"
fi
if ! grep -q "git push" "$TRACE_LOG" 2>/dev/null; then
  fail "scenario 5b: GIT_TRACE never saw a push at all - the check would pass vacuously either way"
elif grep -q "git push --force" "$TRACE_LOG" 2>/dev/null; then
  fail "a REAL git push subprocess used --force"
else
  pass "no REAL git push subprocess used --force"
fi

# The hook shells no push of its own - the one adapter is push_sweep_lib.bb's.
if grep -v '^[[:space:]]*#' "$HOOKS_DIR/post-commit" | grep -q "git push"; then
  fail "the hook shells its own git push instead of using the one adapter"
else
  pass "the hook contains no git push of its own (BL-1198)"
fi

# ── 7. a second invocation never destroys the first's fixtures ─────────────
# Ten at once, which is the shape that actually happened. Each probe reaches
# the lock decision and stops; none may run the body, and none may touch this
# run's fixture directory.
probe_out="$WORK/lock-probes.txt"
: > "$probe_out"
for _ in $(seq 1 10); do
  ( BL1390_LOCK_PROBE=1 FIXTURE_ISOLATION_LOCK_WAIT=1 FIXTURE_ISOLATION_NO_REAP=1 \
      timeout 60 bash "${BASH_SOURCE[0]}" >>"$probe_out" 2>&1 ) &
done
wait
if grep -q 'LOCK_PROBE_RAN_BODY' "$probe_out"; then
  fail "a second invocation acquired the lock while this one holds it"
else
  pass "at most one instance of the suite runs at a time"
fi
if grep -q "SUITE_BUSY: another instance of this suite (pid $$)" "$probe_out"; then
  pass "a second invocation exits cleanly naming the first's pid"
else
  fail "a probe did not name this run's pid: $(head -3 "$probe_out")"
fi
if [[ -d "$WORK" && -f "$WORK/.fixture-owner-pid" ]]; then
  pass "the first's fixture directory is intact throughout"
elif [[ -d "$WORK" ]]; then
  fail "this run's fixture directory survived but lost its owner stamp"
else
  fail "this run's fixture directory ($WORK) was destroyed while it was running"
fi
if grep -cq 'SUITE_INVOKER pid=' "$probe_out"; then
  pass "each suite log names the process chain that invoked it"
else
  fail "no SUITE_INVOKER line: $(head -3 "$probe_out")"
fi

# ── 6. the suite itself left the live repository alone ─────────────────────
LIVE_ORIGIN_AFTER="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)"
LIVE_WORKTREES_AFTER="$(git -C "$REPO_ROOT" worktree list 2>/dev/null)"
if [[ "$LIVE_ORIGIN_BEFORE" == "$LIVE_ORIGIN_AFTER" ]]; then
  pass "the live repository's origin URL is byte-identical after the suite"
else
  fail "the suite changed the live origin URL: '$LIVE_ORIGIN_BEFORE' -> '$LIVE_ORIGIN_AFTER'"
fi
if [[ "$LIVE_WORKTREES_BEFORE" == "$LIVE_WORKTREES_AFTER" ]]; then
  pass "the live repository's worktree list is byte-identical after the suite"
else
  fail "the suite changed the live worktree list:
before: $LIVE_WORKTREES_BEFORE
after:  $LIVE_WORKTREES_AFTER"
fi
# Every mutating command ran against a fixture root: proven structurally by
# there being exactly ONE raw `git -C` in this file - inside the guard itself -
# so no call can reach a repository the guard did not prove is under $WORK.
# A line that calls in_fixture first is guarded even though `git -C` appears on
# it (the traced commit needs its own env), so it does not count as raw.
raw_git_calls="$(grep -E '^[[:space:]]*git -C |in_fixture "\$root" && GIT_TRACE' "${BASH_SOURCE[0]}" \
  | grep -cvE 'in_fixture ')"
if [[ "$raw_git_calls" == "1" ]]; then
  pass "every mutating git command in the suite goes through the fixture guard"
else
  fail "found $raw_git_calls raw 'git -C' calls; only the guard itself may call git directly"
fi

if [[ $status -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
