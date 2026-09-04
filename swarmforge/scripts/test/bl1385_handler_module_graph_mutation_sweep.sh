#!/usr/bin/env bash
# BL-1385 hardener: surgical mutation sweep over check_handler_module_graph.sh
# (BL-149 cooldown gate reads file_age_days ~20700 for this brand-new file ->
# DECISION run). Babashka/shell have no mutation tool wired (Startup Tools) -
# this is the BL-638/BL-567 hand-authored fallback. Each mutant is a single
# edit specs/pipeline/scripts/run_acceptance.sh on the BL-1385 feature must
# reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GUARD=swarmforge/scripts/check_handler_module_graph.sh
FEATURE=specs/features/BL-1385-a-handler-that-cannot-load-never-reaches-main.feature

BACKUP="$(mktemp)"
cp "$GUARD" "$BACKUP"
restore() { cp "$BACKUP" "$GUARD"; }

killed=0; survived=0; skipped=0; equivalent=0
declare -a SURVIVORS=()
declare -a SKIPPED=()

# mutate <label> <from-file> <to-file>
# from/to are passed as FILES (not inline strings) to sidestep quoting
# hazards across bash/python/heredoc/JS-in-heredoc layers in this target.
mutate() {
  local label="$1" fromfile="$2" tofile="$3" reason="${4:-}"
  restore
  if ! python3 - "$GUARD" "$fromfile" "$tofile" <<'PY'
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
  if ! bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE" >/dev/null 2>&1; then
    echo "  killed   $label"; killed=$((killed+1)); return
  fi
  if [ -n "$reason" ]; then
    echo "  EQUIV    $label -- $reason"
    equivalent=$((equivalent+1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label"); survived=$((survived+1))
}

MUT_DIR="$(mktemp -d)"
trap 'restore; rm -f "$BACKUP"; rm -rf "$MUT_DIR"' EXIT

write() { printf '%s' "$2" >"$MUT_DIR/$1"; }

echo "mutation sweep over $GUARD (BL-1385 handler module graph guard)"

# 1. The RUNNER's own failure-reporting branch disabled: a failing handler
#    would never write anything to stdout and the shell side would see an
#    empty RUNNER_OUT while RUNNER_STATUS is still non-zero.
write from1 'if (failures.length > 0) {'
write to1   'if (false) {'
mutate "runner failure branch disabled (RUNNER exits 1 but prints nothing)" "$MUT_DIR/from1" "$MUT_DIR/to1"

# 2. The refusal-branch exit changed 1 -> 0: a real HANDLER_LOAD_BLOCK would
#    still print but the guard would exit success, so run_guard/land_step_lib
#    would treat a genuine refusal as a pass.
write from2 'handler-graph: $FAILURES handler(s) on this tree cannot load; under BL-1371 discovery that makes EVERY acceptance run throw"
  # 1, not 3: commit_guard_chain_lib.sh'"'"'s run_guard treats any status other
  # than 1 as UNEXPECTED rather than as a refusal, and this guard is a member
  # of that chain.
  exit 1'
write to2   'handler-graph: $FAILURES handler(s) on this tree cannot load; under BL-1371 discovery that makes EVERY acceptance run throw"
  # 1, not 3: commit_guard_chain_lib.sh'"'"'s run_guard treats any status other
  # than 1 as UNEXPECTED rather than as a refusal, and this guard is a member
  # of that chain.
  exit 0'
mutate "shell-side exit code on refusal changed 1 -> 0" "$MUT_DIR/from2" "$MUT_DIR/to2"

# 3. HANDLER_LOAD_BLOCK marker line dropped on the shell-side refusal print.
write from3 '  echo "HANDLER_LOAD_BLOCK"
  while IFS= read -r line; do'
write to3   '  while IFS= read -r line; do'
mutate "marker line dropped on shell-side refusal" "$MUT_DIR/from3" "$MUT_DIR/to3"

# 4. Unreadable-archive refusal flipped to a silent pass.
write from4 "handler-graph: could not read the tree '\$TREEISH' - refusing rather than passing an unexamined tree\"
    exit 1"
write to4   "handler-graph: could not read the tree '\$TREEISH' - refusing rather than passing an unexamined tree\"
    exit 0"
mutate "unreadable-archive refusal flipped to a pass" "$MUT_DIR/from4" "$MUT_DIR/to4"

# 5. No-steps-dir path (a legitimate pass, nothing to discover) flipped to a
#    refusal - would false-refuse a tree with no handlers at all.
write from5 '  # No steps directory on this tree is not a failure - there is nothing to
  # discover, so nothing can fail to load. Distinct from an unreadable tree.
  exit 0'
write to5   '  # No steps directory on this tree is not a failure - there is nothing to
  # discover, so nothing can fail to load. Distinct from an unreadable tree.
  exit 1'
mutate "no-steps-dir case flipped from pass to refusal" "$MUT_DIR/from5" "$MUT_DIR/to5"

# 6. out/->src/ mapping candidate list emptied: invariant 2's "present on the
#    tree passes" direction would break - every out/ require refuses, even a
#    real, resolvable one. Re-anchored (hardener, 2026-09-04) after the
#    cleaner's firstOnTree(cands) consolidation replaced the original
#    inline-array `for` loop with a `cands` variable passed to a shared
#    helper - the old anchor (a literal `for (const cand of [...])`) no
#    longer exists on disk, so this mutant SKIPPED silently until re-pointed
#    at the new `cands` assignment (flagged by cleaner's governed pass,
#    backlog/evidence/BL-1385-cleaner-governed-pass-20260904.md).
write from6 "      const cands = [
        path.join(TREE, 'extension', 'src', rel + '.ts'),
        path.join(TREE, 'extension', 'src', rel + '.js'),
        path.join(TREE, 'extension', 'src', rel, 'index.ts'),
      ];"
write to6   "      const cands = [];"
mutate "out/->src/ candidate list emptied (invariant 2, present-on-tree direction)" "$MUT_DIR/from6" "$MUT_DIR/to6"

# 7. TREE-rooted check dropped: invariant 2's "absent from tree refuses"
#    direction would break - a request outside the materialised tree would
#    resolve against whatever `abs` happens to be instead of refusing.
write from7 'const real = abs.startsWith(TREE) ? abs : null;'
write to7   'const real = abs;'
mutate "TREE-rooted check dropped (invariant 2, absent-from-tree direction)" "$MUT_DIR/from7" "$MUT_DIR/to7"

# 8. process.exit-during-load guard removed: a handler calling process.exit
#    at load would end the whole sweep and silently pass every handler after
#    it in sort order.
write from8 "  process.exit = () => { throw new Error('BL1385_HANDLER_CALLED_EXIT'); };"
write to8   "  ;"
mutate "process.exit-during-load guard removed" "$MUT_DIR/from8" "$MUT_DIR/to8"

# 9. missing.length gate on failure inverted: would report every load-time
#    throw as a missing-module finding, even ones unrelated to resolution
#    (BL-1371's own registry surfacing a handler's own bug, out of scope).
write from9 'if (missing.length > 0) {'
write to9   'if (missing.length === 0) {'
mutate "missing.length gate inverted (would misreport unrelated load-time throws as HANDLER_LOAD_BLOCK)" "$MUT_DIR/from9" "$MUT_DIR/to9"

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
