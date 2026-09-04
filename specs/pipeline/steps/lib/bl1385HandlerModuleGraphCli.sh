#!/usr/bin/env bash
# BL-1385 acceptance fixture: drive the REAL check_handler_module_graph.sh over
# a REAL scratch repository whose tree carries real handlers.
#
# Usage: bl1385HandlerModuleGraphCli.sh <work-dir> <shape>
#   shapes:
#     good                  every handler's module graph resolves on the tree
#     missing-ext-out       a handler requires a compiled extension module whose
#                           source is on no tree (the 2026-09-04 incident)
#     missing-lib-sibling   a handler requires ./lib/<helper> absent from the tree
#     missing-relative      a handler requires a relative module beside it, absent
#     checker-has-it        absent from the tree, PRESENT in the checking worktree
#     tree-has-it           present on the tree, ABSENT from the checking worktree
#     unreadable-tree       a tree-ish that cannot be read at all
#     land-replay           the LAND's own tree-guard list, run against a bad
#                           materialised tree exactly as land_step_lib.bb does
#     commit-guards         the commit guard chain, run over a bad staged tree
#     no-steps-dir           a tree with no specs/pipeline/steps directory at
#                           all - nothing to discover, must pass
#     handler-calls-exit     a handler between the good and bad ones calls
#                           process.exit(0) at load; the sweep must still
#                           reach and refuse the bad handler after it
#     escapes-tree-scope     a handler requires a nonexistent absolute path
#                           outside any tree - foreign, not tree content,
#                           must pass rather than being flagged missing
#
# Prints one JSON line:
#   {"exit":N,"marker":bool,"namesHandler":bool,"namesModule":bool,"out":"..."}
#
# A real git repo and a real archive: invariant 2 is about the difference
# between the tree and the checker's worktree, and a fixture that never
# materialises a tree could not exhibit it.
set -uo pipefail

WORK="$1"
SHAPE="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
GUARD="$REPO_ROOT/swarmforge/scripts/check_handler_module_graph.sh"

# no-steps-dir builds a bare tree with no specs/pipeline/steps directory at
# all, so it cannot share the setup below (which always creates one) -
# handled entirely separately, before that setup runs.
if [[ "$SHAPE" == "no-steps-dir" ]]; then
  R="$WORK/repo"
  mkdir -p "$R"
  git init -q -b main "$R"
  git -C "$R" config user.email t@t
  git -C "$R" config user.name t
  git -C "$R" config commit.gpgsign false
  echo "nothing to discover here" >"$R/README.md"
  git -C "$R" add -A
  git -C "$R" commit -q -m "no steps dir at all"
  OUT="$(bash "$GUARD" HEAD "$R" 2>&1)"
  CODE=$?
  MARKER=false
  grep -q 'HANDLER_LOAD_BLOCK' <<<"$OUT" && MARKER=true
  BL_OUT="$OUT" BL_CODE="$CODE" BL_MARKER="$MARKER" \
    python3 -c 'import json, os; print(json.dumps({
      "exit": int(os.environ["BL_CODE"]),
      "marker": os.environ["BL_MARKER"] == "true",
      "namesHandler": False,
      "namesModule": False,
      "out": os.environ["BL_OUT"],
  }))'
  exit 0
fi

R="$WORK/repo"
mkdir -p "$R/specs/pipeline/steps/lib" "$R/extension/src/tools"
git init -q -b main "$R"
git -C "$R" config user.email t@t
git -C "$R" config user.name t
git -C "$R" config commit.gpgsign false

# The registry, discovering handlers the way BL-1371 made it.
cat >"$R/specs/pipeline/steps/index.js" <<'IDX'
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const HANDLER_SUFFIX = 'Steps.js';
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith(HANDLER_SUFFIX))) {
  require(path.join(__dirname, f));
}
IDX

# A good handler, present in every shape: a run that refuses must be refusing
# because of the BAD one, not because nothing loads.
cat >"$R/specs/pipeline/steps/aaGoodSteps.js" <<'GOOD'
'use strict';
const path = require('node:path');
const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
require(path.join(EXT_OUT, 'tools', 'present'));
function registerSteps() {}
module.exports = { registerSteps };
GOOD
echo "export const present = 1;" >"$R/extension/src/tools/present.ts"

bad_handler_requiring() { # <require-expression>
  cat >"$R/specs/pipeline/steps/zzBadSteps.js" <<EOF
'use strict';
const path = require('node:path');
const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
$1
function registerSteps() {}
module.exports = { registerSteps };
EOF
}

case "$SHAPE" in
  good) ;;
  missing-ext-out|checker-has-it)
    bad_handler_requiring "require(path.join(EXT_OUT, 'tools', 'absentFromTree'));"
    ;;
  missing-lib-sibling)
    bad_handler_requiring "require('./lib/absentHelper');"
    ;;
  missing-relative)
    bad_handler_requiring "require('./absentNeighbour');"
    ;;
  tree-has-it)
    # The module exists ONLY on the tree - the checking worktree has no such
    # file anywhere. The guard must pass.
    bad_handler_requiring "require(path.join(EXT_OUT, 'tools', 'bl1385TreeOnlyModule'));"
    echo "export const x = 1;" >"$R/extension/src/tools/bl1385TreeOnlyModule.ts"
    ;;
  unreadable-tree) ;;
  land-replay|commit-guards)
    bad_handler_requiring "require(path.join(EXT_OUT, 'tools', 'absentFromTree'));"
    ;;
  handler-calls-exit)
    # An exit-calling handler sorts BEFORE the bad one (mm < zz): with the
    # exit-during-load guard intact the sweep must still reach and refuse
    # zzBad after it, not silently stop there.
    cat >"$R/specs/pipeline/steps/mmExitSteps.js" <<'EXIT'
'use strict';
process.exit(0);
function registerSteps() {}
module.exports = { registerSteps };
EXIT
    bad_handler_requiring "require(path.join(EXT_OUT, 'tools', 'absentFromTree'));"
    ;;
  escapes-tree-scope)
    # A foreign absolute path, outside any tree and nonexistent anywhere -
    # not tree content, so the guard must not flag it as a missing module.
    bad_handler_requiring "require('/nonexistent-bl1385-invariant2-probe-9f3a1c');"
    ;;
  *) echo "unknown shape: $SHAPE" >&2; exit 2 ;;
esac

git -C "$R" add -A
git -C "$R" commit -q -m "fixture tree"

# `checker-has-it`: the module is absent from the TREE and present in the
# CHECKER. Built here as a real file in this fixture's own checkout, outside
# the committed tree, so the guard could only pass by consulting the wrong one.
if [[ "$SHAPE" == "checker-has-it" ]]; then
  mkdir -p "$R/extension/src/tools"
  echo "export const absentFromTree = 1;" >"$R/extension/src/tools/absentFromTree.ts"
  # deliberately NOT committed: on disk, not on the tree
fi

case "$SHAPE" in
  unreadable-tree)
    OUT="$(bash "$GUARD" "0000000000000000000000000000000000000000" "$R" 2>&1)"
    CODE=$?
    ;;
  land-replay)
    # The land's OWN call shape: a materialised tree ROOT directory plus
    # --assume-main, run through land_step_lib.bb's replayed-tree-guard list
    # rather than by invoking the script directly - so this proves the guard
    # is IN that list, not merely that it works.
    TREE_ROOT="$WORK/replayed"; mkdir -p "$TREE_ROOT"
    git -C "$R" archive --format=tar HEAD | tar -x -C "$TREE_ROOT"
    OUT="$(BL1385_LIB="$REPO_ROOT/swarmforge/scripts/land_step_lib.bb" BL1385_TREE_ROOT="$TREE_ROOT" bb -e '
(load-file (System/getenv "BL1385_LIB"))
(doseq [r (land-step-lib/run-replayed-tree-guards (System/getenv "BL1385_TREE_ROOT"))]
  (println r))' 2>&1)"
    # The land refuses when its guard list returns any refusal string.
    if [[ -n "$(tr -d '[:space:]' <<<"$OUT")" ]]; then CODE=1; else CODE=0; fi
    ;;
  commit-guards)
    # The commit chain's own call shape: no argument at all, so the guard
    # examines the STAGED tree. Staged-but-uncommitted is exactly a hand-land.
    git -C "$R" reset -q --soft HEAD~1 2>/dev/null || true
    OUT="$(cd "$R" && bash "$GUARD" 2>&1)"
    CODE=$?
    ;;
  *)
    OUT="$(bash "$GUARD" HEAD "$R" 2>&1)"
    CODE=$?
    ;;
esac

MARKER=false
grep -q 'HANDLER_LOAD_BLOCK' <<<"$OUT" && MARKER=true
NAMES_HANDLER=false
grep -q 'zzBadSteps.js' <<<"$OUT" && NAMES_HANDLER=true
NAMES_MODULE=false
grep -qE 'absentFromTree|absentHelper|absentNeighbour' <<<"$OUT" && NAMES_MODULE=true

BL_OUT="$OUT" BL_CODE="$CODE" BL_MARKER="$MARKER" BL_H="$NAMES_HANDLER" BL_M="$NAMES_MODULE" \
  python3 -c 'import json, os; print(json.dumps({
    "exit": int(os.environ["BL_CODE"]),
    "marker": os.environ["BL_MARKER"] == "true",
    "namesHandler": os.environ["BL_H"] == "true",
    "namesModule": os.environ["BL_M"] == "true",
    "out": os.environ["BL_OUT"],
}))'
