#!/usr/bin/env bash
# reset_worktrees.sh --align-main: hard-reset every role worktree (and its
# current agent branch tip) onto main, then git clean -fd.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESET="$SCRIPT_DIR/../reset_worktrees.sh"
START_SWARM="$SCRIPT_DIR/../../../start-swarm.sh"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

[[ -x "$RESET" || -f "$RESET" ]] || fail "reset_worktrees.sh missing"
[[ -f "$START_SWARM" ]] || fail "start-swarm.sh missing"

# ── start-swarm wires -clean / --clean to align-main ────────────────────────
grep -qE '\-clean\|\-\-clean' "$START_SWARM" \
  || fail "01: start-swarm.sh must accept -clean / --clean"
grep -q 'reset_worktrees.sh' "$START_SWARM" \
  || fail "02: start-swarm.sh -clean must invoke reset_worktrees.sh"
grep -q '\-\-align-main' "$START_SWARM" \
  || fail "03: start-swarm.sh -clean must pass --align-main"
pass "01-03: start-swarm.sh wires -clean to reset_worktrees --align-main"

# ── fixture: main + diverged dirty role worktree ────────────────────────────
FIX="$(mktemp -d "${TMPDIR:-/tmp}/sf-align-main.XXXXXX")"
trap 'rm -rf "$FIX"' EXIT

git -C "$FIX" init -b main >/dev/null
git -C "$FIX" config user.email "test@example.com"
git -C "$FIX" config user.name "Test"
echo base > "$FIX/README"
git -C "$FIX" add README
git -C "$FIX" commit -m "base" >/dev/null
MAIN_SHA="$(git -C "$FIX" rev-parse HEAD)"

mkdir -p "$FIX/.worktrees"
git -C "$FIX" worktree add -B swarmforge-coder "$FIX/.worktrees/coder" >/dev/null 2>&1
(
  cd "$FIX/.worktrees/coder"
  echo dirty > tracked.txt
  git add tracked.txt
  git commit -m "diverge" >/dev/null
  echo untracked > litter.txt
  echo 'modified base' > README
)

CODER_SHA_BEFORE="$(git -C "$FIX/.worktrees/coder" rev-parse HEAD)"
[[ "$CODER_SHA_BEFORE" != "$MAIN_SHA" ]] || fail "04: setup expected coder to diverge from main"

bash "$RESET" --align-main "$FIX" >/dev/null

CODER_SHA_AFTER="$(git -C "$FIX/.worktrees/coder" rev-parse HEAD)"
CODER_BR="$(git -C "$FIX/.worktrees/coder" branch --show-current)"
[[ "$CODER_SHA_AFTER" == "$MAIN_SHA" ]] \
  || fail "05: coder HEAD should match main after --align-main (got $CODER_SHA_AFTER want $MAIN_SHA)"
[[ "$CODER_BR" == "swarmforge-coder" ]] \
  || fail "06: coder should stay on swarmforge-coder branch (got $CODER_BR)"
[[ ! -e "$FIX/.worktrees/coder/litter.txt" ]] \
  || fail "07: untracked litter.txt should be removed by git clean -fd"
if ! git -C "$FIX/.worktrees/coder" diff --quiet \
  || ! git -C "$FIX/.worktrees/coder" diff --cached --quiet; then
  fail "08: coder worktree should be clean after --align-main"
fi
pass "04-08: --align-main resets role branch tip to main and cleans"

# Soft mode (no flag) must NOT hard-reset onto main
git -C "$FIX/.worktrees/coder" commit --allow-empty -m "soft-keep" >/dev/null
SOFT_SHA="$(git -C "$FIX/.worktrees/coder" rev-parse HEAD)"
bash "$RESET" "$FIX" >/dev/null
[[ "$(git -C "$FIX/.worktrees/coder" rev-parse HEAD)" == "$SOFT_SHA" ]] \
  || fail "09: default reset_worktrees must not hard-reset onto main"
pass "09: default mode stays soft"

echo "ALL PASS"
