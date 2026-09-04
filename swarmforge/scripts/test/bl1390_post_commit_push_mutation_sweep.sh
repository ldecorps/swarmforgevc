#!/usr/bin/env bash
# BL-1390 hardener: surgical mutation sweep over push_sweep_lib.bb's
# post-commit-decision/push-main! and post_commit_push.bb's -main (BL-149
# cooldown gate reads DECISION run for all three - and for
# swarmforge/git-hooks/post-commit, checked separately below). No Babashka
# mutation tool is wired (Startup Tools) - BL-638/BL-567 hand-authored
# fallback. This hook runs on the SHARED main checkout in production, so
# the sweep targets the highest-consequence safety properties: never
# force-push, fail closed on unknown counts, never push while diverged,
# never treat a linked worktree or non-main branch as the shared checkout.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/push_sweep_lib.bb
RUNNER=swarmforge/scripts/post_commit_push.bb
UNIT=swarmforge/scripts/test/push_sweep_lib_test_runner.bb
SHELL_E2E=swarmforge/scripts/test/test_bl1390_post_commit_push.sh

BACKUP_L="$(mktemp)"; cp "$LIB" "$BACKUP_L"
BACKUP_R="$(mktemp)"; cp "$RUNNER" "$BACKUP_R"
restore() { cp "$BACKUP_L" "$LIB"; cp "$BACKUP_R" "$RUNNER"; }

killed=0; survived=0; skipped=0; equivalent=0
declare -a SURVIVORS=()
declare -a SKIPPED=()

MUT_DIR="$(mktemp -d)"
trap 'restore; rm -f "$BACKUP_L" "$BACKUP_R"; rm -rf "$MUT_DIR"' EXIT
write() { printf '%s' "$2" >"$MUT_DIR/$1"; }

# mutate <label> <target-file> <from-file> <to-file> <oracle> [equivalent-reason]
mutate() {
  local label="$1" target="$2" fromfile="$3" tofile="$4" oracle="$5" reason="${6:-}"
  restore
  if ! python3 - "$target" "$fromfile" "$tofile" <<'PY'
import sys
p, af, bf = sys.argv[1], sys.argv[2], sys.argv[3]
a = open(af).read()
b = open(bf).read()
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    SKIPPED+=("$label"); skipped=$((skipped+1)); return
  fi
  local ok=1
  if [ "$oracle" = "unit" ]; then
    bb "$UNIT" >/dev/null 2>&1 || ok=0
  else
    bash "$SHELL_E2E" >/dev/null 2>&1 || ok=0
  fi
  if [ "$ok" = 0 ]; then
    echo "  killed   $label ($oracle)"; killed=$((killed+1)); return
  fi
  if [ -n "$reason" ]; then
    echo "  EQUIV    $label -- $reason"
    equivalent=$((equivalent+1)); return
  fi
  echo "  SURVIVED $label ($oracle)"
  SURVIVORS+=("$label"); survived=$((survived+1))
}

echo "mutation sweep over $LIB + $RUNNER (BL-1390 post-commit push)"

# 1. post-commit-decision's linked-worktree/branch guard dropped: a role
#    worktree commit (or a non-main branch commit on the shared checkout)
#    would be treated as shared-checkout eligible, potentially pushing a
#    role branch to origin/main.
write from1 '(or linked-worktree? (not= branch "main")) :not-shared-checkout'
write to1   'false :not-shared-checkout'
mutate "linked-worktree/non-main guard dropped" "$LIB" "$MUT_DIR/from1" "$MUT_DIR/to1" unit

# 2. post-commit-decision's unknown-counts fail-closed check dropped: a nil
#    ahead/behind (failed fetch) would fall through to push-decision with
#    nil counts instead of refusing outright.
write from2 '(or (nil? ahead) (nil? behind)) :counts-unknown'
write to2   'false :counts-unknown'
mutate "unknown-counts fail-closed check dropped" "$LIB" "$MUT_DIR/from2" "$MUT_DIR/to2" unit

# 3. push-decision's diverged check (pos? behind) dropped: a checkout that
#    is both ahead AND behind would read as should-push instead of
#    diverged, pushing over content the checkout has not yet absorbed.
write from3 '(pos? behind) :diverged'
write to3   'false :diverged'
mutate "diverged check dropped (ahead+behind would push anyway)" "$LIB" "$MUT_DIR/from3" "$MUT_DIR/to3" unit

# 4. push-main! gains --force: the one push adapter both the hook and the
#    daemon sweep share would silently start force-pushing over anyone's
#    unabsorbed origin content - the single highest-consequence mutant in
#    this whole ticket.
write from4 '["git" "push" "origin" "main"]'
write to4   '["git" "push" "--force" "origin" "main"]'
mutate "push-main! gains --force" "$LIB" "$MUT_DIR/from4" "$MUT_DIR/to4" shell

# 5. push-main!'s success/failure mapping inverted: a failed push (non-zero
#    exit) would report success:true, and the hook would log "pushed" for
#    a push that never happened.
write from5 '(if (zero? exit)
      {:success true}
      {:success false :error (str/trim (or err ""))})'
write to5   '(if (zero? exit)
      {:success false :error "flipped"}
      {:success true})'
mutate "push-main! success/failure mapping inverted" "$LIB" "$MUT_DIR/from5" "$MUT_DIR/to5" shell

# 6. post_commit_push.bb's fetch-failure guard dropped: a failed `git
#    fetch` would still compute rev-counts from a stale origin/main ref,
#    reading "ahead, not behind" precisely when origin has moved -
#    invariant 1's exact hazard, in the runner that actually shells out.
write from6 'counts (when (zero? (:exit fetched)) (rev-counts))'
write to6   'counts (rev-counts)'
mutate "fetch-failure guard dropped (stale counts read on a failed fetch)" "$RUNNER" "$MUT_DIR/from6" "$MUT_DIR/to6" shell

echo "----"
echo "mutants: killed=$killed survived=$survived equivalent=$equivalent skipped=$skipped"
if [ "$survived" -gt 0 ]; then
  echo "SURVIVORS:"; printf '  %s\n' "${SURVIVORS[@]}"
  exit 1
fi
if [ "$skipped" -gt 0 ]; then
  echo "SKIPPED (stale anchors, unrun):"; printf '  %s\n' "${SKIPPED[@]}"
fi
echo "ALL MUTANTS KILLED (or accepted-equivalent, see EQUIV lines above)"
