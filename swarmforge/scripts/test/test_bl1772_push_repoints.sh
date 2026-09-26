#!/usr/bin/env bash
# BL-1772: land_main_publish.sh --push re-points the QA branch after it
# publishes, the same way --land already does (BL-1438). Every push here
# goes to a bare repo under this test's own temp root (BL-1390).
#
# BL-1242: independent guards do NOT run under `set -e`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FIXTURE_PREFIX="bl1772-push-repoint-"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1772_SUITE_BOUND_SECONDS:-180}" "$@"
trap 'rm -rf "$WORK"' EXIT

LIVE_ORIGIN_BEFORE="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)"

in_fixture() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" == "$WORK"/* && -d "$dir" ]] || return 1
  local common
  common="$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in /*) [[ "$common" == "$WORK"/* ]] || return 1 ;; *) : ;; esac
}
g() { in_fixture "$1" || { fail "refusing git outside the fixture: '${1:-<empty>}'"; return 1; }; git -C "$1" "${@:2}"; }
gq() { g "$@" >/dev/null 2>&1; }

setup() {
  name="$1"; root="$WORK/$name"; origin="$WORK/$name-origin.git"
  mkdir -p "$root/.swarmforge" "$root/swarmforge" "$root/backlog/active"
  git init -q --bare "$origin"
  git -C "$origin" symbolic-ref HEAD refs/heads/main 2>/dev/null || true
  git init -q -b main "$root"
  for kv in user.email:t@t user.name:t commit.gpgsign:false; do g "$root" config "${kv%%:*}" "${kv##*:}" >/dev/null; done
  if [[ ! -d "$WORK/shared-scripts" ]]; then
    cp -R "$REPO_ROOT/swarmforge/scripts" "$WORK/shared-scripts" || fail "setup($name): scripts copy failed"
  fi
  ln -s "$WORK/shared-scripts" "$root/swarmforge/scripts"
  g "$root" remote add origin "$origin" >/dev/null
  # Without this, lock/log writes under .swarmforge/ trip the dirty-tree
  # guard and every re-point would skip (BL-1438 fixture note).
  printf '.swarmforge/\n' > "$root/.gitignore"
  printf 'id: BL-9772\ntitle: fixture\nmilestone: M8\nstatus: todo\n' > "$root/backlog/active/BL-9772-fixture.yaml"
  echo seed > "$root/seed.txt"
  gq "$root" add -A && gq "$root" commit -m "seed" || fail "setup($name): seed failed"
  gq "$root" push -u origin main || fail "setup($name): seed push failed"
}

# Extra commits on the worktree that origin/main does not have - the QA
# branch leftover the re-point is meant to drop.
grow_qa_branch() {
  echo "review $RANDOM" > "$root/review.txt"
  gq "$root" add -A
  gq "$root" commit -m "QA review merge leftover"
}

# A tip-pure landing off current origin/main, leaving HEAD on the leftover
# QA branch (the branch the re-point must move).
make_tip_pure() {
  local origin_main landing qa_branch
  qa_branch="$(g "$root" rev-parse --abbrev-ref HEAD)"
  origin_main="$(g "$root" rev-parse origin/main)"
  gq "$root" checkout --detach "$origin_main"
  echo "landed $RANDOM" > "$root/landed.txt"
  gq "$root" add landed.txt
  gq "$root" commit -m "BL-9772: the tip-pure landing"
  landing="$(g "$root" rev-parse HEAD)"
  gq "$root" checkout "$qa_branch"
  printf '%s\n' "$landing"
}

run_push() {
  ( cd "$root" && LAND_LOCK_WAIT_SECONDS="${2:-20}" timeout 120 \
      bash "$root/swarmforge/scripts/land_main_publish.sh" "$root" --push \
      "$1" >"$WORK/$name.push.out" 2>"$WORK/$name.push.err" )
}
push_out() { cat "$WORK/$name.push.out" "$WORK/$name.push.err" 2>/dev/null; }

# ── 1. a clean --push re-points the leftover QA branch ────────────────────
setup one
grow_qa_branch
QA_BEFORE="$(g "$root" rev-parse HEAD)"
LANDING="$(make_tip_pure)"
run_push "$LANDING"; rc=$?
if grep -q "LAND_PUBLISHED $LANDING" <<<"$(push_out)"; then
  pass "a clean --push prints LAND_PUBLISHED"
else
  fail "no LAND_PUBLISHED line: $(push_out | tail -5)"
fi
if grep -qE '^LAND_REPOINTED ' <<<"$(push_out)"; then
  pass "and then LAND_REPOINTED"
else
  fail "no LAND_REPOINTED line: $(push_out | tail -8)"
fi
ORIGIN_MAIN="$(git -C "$origin" rev-parse main 2>/dev/null)"
HEAD_NOW="$(g "$root" rev-parse HEAD)"
if [[ "$HEAD_NOW" == "$ORIGIN_MAIN" ]]; then
  pass "the worktree HEAD equals origin/main after the re-point"
else
  fail "HEAD $HEAD_NOW != origin/main $ORIGIN_MAIN"
fi
if [[ "$HEAD_NOW" != "$QA_BEFORE" ]]; then
  pass "the leftover QA-only commit is no longer HEAD"
else
  fail "the QA branch was left at its pre-push tip"
fi
if [[ ! -d "$root/.swarmforge/land-main.publish.lock" ]]; then
  pass "the land lock is gone afterwards"
else
  fail "the lock was left held"
fi
if (( rc == 0 )); then pass "a clean --push exits 0"; else fail "a clean --push exited $rc"; fi

# ── 2. a dirty worktree still publishes; re-point skips ───────────────────
setup two
grow_qa_branch
QA_BEFORE="$(g "$root" rev-parse HEAD)"
LANDING="$(make_tip_pure)"
echo dirty > "$root/uncommitted.txt"
run_push "$LANDING"; rc=$?
if grep -q "LAND_PUBLISHED $LANDING" <<<"$(push_out)" && grep -q 'LAND_REPOINT_SKIPPED an uncommitted change' <<<"$(push_out)"; then
  pass "a dirty worktree publishes and skips the re-point by name"
else
  fail "expected LAND_PUBLISHED then LAND_REPOINT_SKIPPED an uncommitted change, got: $(push_out | tail -8)"
fi
if [[ "$(g "$root" rev-parse HEAD)" == "$QA_BEFORE" ]] || [[ -f "$root/uncommitted.txt" ]]; then
  pass "the dirty worktree and its branch were left in place"
else
  fail "a skipped re-point still moved the worktree"
fi
if (( rc == 0 )); then pass "a skipped re-point still exits 0"; else fail "a skipped re-point exited $rc"; fi

# ── 3. a refused --push never re-points ───────────────────────────────────
setup three
grow_qa_branch
QA_BEFORE="$(g "$root" rev-parse HEAD)"
# A merge commit is what verify-push-safe refuses (BL-1678). Built in
# isolation so HEAD stays on the leftover QA branch.
PARENT_A="$(g "$root" rev-parse HEAD)"
echo other > "$root/other-parent.txt"
gq "$root" add -A
gq "$root" commit -m "other parent"
PARENT_B="$(g "$root" rev-parse HEAD)"
gq "$root" reset --hard "$QA_BEFORE"
MERGE="$(g "$root" commit-tree "$(g "$root" rev-parse 'HEAD^{tree}')" -p "$PARENT_A" -p "$PARENT_B" -m "BL-9772: a merge landing")"
run_push "$MERGE"; rc=$?
if grep -q 'LAND_STOPPED' <<<"$(push_out)" && ! grep -qE 'LAND_REPOINTED|LAND_REPOINT_SKIPPED' <<<"$(push_out)"; then
  pass "a refused --push prints LAND_STOPPED and no re-point line"
else
  fail "expected LAND_STOPPED and no re-point, got: $(push_out | tail -8)"
fi
if [[ "$(g "$root" rev-parse HEAD)" == "$QA_BEFORE" ]]; then
  pass "a refused --push leaves the branch where it was"
else
  fail "a refused --push moved HEAD"
fi
if (( rc != 0 )); then pass "a refused --push exits non-zero"; else fail "a refused --push exited 0"; fi

# ── the suite never touched the live repository ───────────────────────────
if [[ "$LIVE_ORIGIN_BEFORE" == "$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)" ]]; then
  pass "the live repository's origin URL is byte-identical after the suite"
else
  fail "the suite changed the live origin URL"
fi
if git -C "$REPO_ROOT" remote -v 2>/dev/null | grep -q "$WORK"; then
  fail "a live remote now points into this suite's fixture directory"
else
  pass "no live remote points into the fixture directory"
fi

if [[ $status -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
