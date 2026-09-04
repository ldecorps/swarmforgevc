#!/usr/bin/env bash
# BL-1385: no handler that cannot load reaches main.
#
# Usage: check_handler_module_graph.sh <tree-ish> [repo-root]
#
# Since BL-1371 a step handler registers by EXISTING in specs/pipeline/steps,
# and specs/pipeline/steps/index.js requires every discovered handler eagerly,
# failing the whole run on one it cannot load. So one handler whose require
# names a module living only on an unlanded parcel makes every acceptance run
# throw. That is what happened on 2026-09-04: a93aa4a18f landed
# bl1296BubbleSeatSteps.js, whose require resolves an extension module compiled
# from a source on no branch main could see - 947 handlers, 1 unloadable, 0
# features runnable, and both existing guards passed it because neither loads
# a handler.
#
# Exit status: 0 every discovered handler's module graph resolves on the tree;
# 1 with HANDLER_LOAD_BLOCK when one does not, or when the tree cannot be read
# (the guard chain reads any other non-zero status as unexpected). A guard handed a tree it cannot open REFUSES and says why - absence
# never buys a pass. (BL-806's fail-open line is about inputs the land's decide
# step cannot read concerning SIBLINGS; this is a tree the guard was handed.)
#
# HOW THE VERDICT IS MADE A FUNCTION OF THE TREE (invariant 2)
#
# The tree is materialised with `git archive` into a mkdtemp root and every
# handler is required in a child node process rooted THERE. Nothing resolves
# against the checking worktree: the child's module paths are the materialised
# root's, and the out/->src/ mapping below reads that root too. So a module
# present in the checker but absent from the tree refuses, and one absent from
# the checker but present on the tree passes - both directions, structurally,
# rather than by discipline.
#
# WHY NOT STATIC PARSING. The handlers reach extension modules through at least
# nine different computed constants (EXT_DIR, EXT_OUT, EXT, REPO_ROOT, OUT,
# EXTENSION_DIR, EXTENSION_OUT, EXT_TEST, __dirname). A static resolver would
# need to evaluate each one and would false-positive across 947 files. Letting
# node evaluate them is exact and needs no parser.
#
# WHY NO tsc. extension/out/ is gitignored, so a materialised tree never has
# it. Compiling would make a commit guard cost a full TypeScript build. Instead
# resolution of any extension/out/<p>.js is answered by asking whether
# extension/src/<p>.ts exists ON THE TREE - which is the question that actually
# distinguishes "this module will exist once built here" from "this module's
# source is on somebody else's branch", and is the exact class of the incident.
set -uo pipefail

# Three call shapes, because the two consumers differ and neither should have
# to adapt to the other:
#   <dir>            the land replay hands a materialised tree ROOT directory
#                    (land_step_lib.bb, plus a trailing --assume-main it may
#                    pass; ignored here, this guard is branch-agnostic).
#   <tree-ish>       an explicit commit/tree, for a hand check or a test.
#   (no argument)    the commit guards call with none, so the tree under test
#                    is the STAGED tree - `git write-tree` - which is exactly
#                    the tree the commit will carry.
ARGS=()
for a in "$@"; do
  case "$a" in
    --assume-main) ;;                # the land's flag; not this guard's concern
    *) ARGS+=("$a") ;;
  esac
done

FIRST="${ARGS[0]:-}"
REPO_ROOT="${ARGS[1]:-$(git rev-parse --show-toplevel 2>/dev/null)}"

if [[ -z "$REPO_ROOT" || ( ! -d "$REPO_ROOT/.git" && ! -f "$REPO_ROOT/.git" ) ]]; then
  # Only reachable when there is no repo AND no directory was handed over.
  if [[ -z "$FIRST" || ! -d "$FIRST" ]]; then
    echo "HANDLER_LOAD_BLOCK"
    echo "handler-graph: not a git repository and no tree directory given: ${REPO_ROOT:-<empty>}"
    exit 1
  fi
fi

# BL-971: a killed run traps nothing, so sweep this prefix BEFORE the run too.
PREFIX="bl1385-handler-graph"
rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null || true
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")" || exit 2
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# A directory is already materialised - examine it in place. Otherwise
# materialise the tree-ish (or the staged tree) with git archive. A tree the
# guard cannot open is a REFUSAL, never a pass: it was handed this tree and
# could not do its job.
if [[ -n "$FIRST" && -d "$FIRST" ]]; then
  WORK_TREE="$FIRST"
else
  TREEISH="${FIRST:-$(git -C "$REPO_ROOT" write-tree 2>/dev/null)}"
  if [[ -z "$TREEISH" ]]; then
    echo "HANDLER_LOAD_BLOCK"
    echo "handler-graph: could not determine a tree to examine - refusing rather than passing an unexamined tree"
    exit 1
  fi
  if ! git -C "$REPO_ROOT" archive --format=tar "$TREEISH" 2>/dev/null | tar -x -C "$WORK" 2>/dev/null; then
    echo "HANDLER_LOAD_BLOCK"
    echo "handler-graph: could not read the tree '$TREEISH' - refusing rather than passing an unexamined tree"
    exit 1
  fi
  WORK_TREE="$WORK"
fi

STEPS_DIR="$WORK_TREE/specs/pipeline/steps"
if [[ ! -d "$STEPS_DIR" ]]; then
  # No steps directory on this tree is not a failure - there is nothing to
  # discover, so nothing can fail to load. Distinct from an unreadable tree.
  exit 0
fi

# The child requires each handler with resolution rooted at the materialised
# tree. `extension/out/<p>.js` is answered from `extension/src/<p>.ts` on that
# same tree, because out/ is gitignored and never present in an archive.
NODE_RUNNER="$WORK/.bl1385-runner.js"
cat >"$NODE_RUNNER" <<'RUNNER'
'use strict';
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const TREE = fs.realpathSync(process.env.BL1385_TREE);
const HANDLER = process.env.BL1385_HANDLER;

// A stub permissive enough that a handler's TOP-LEVEL code cannot fail on its
// SHAPE. The guard's question is whether every module RESOLVES on this tree,
// not whether the handler runs correctly - so destructuring, iteration, calls
// and construction all have to succeed against a stand-in.
function stub() {
  const f = function () { return proxy; };
  f[Symbol.iterator] = function* () {};
  const proxy = new Proxy(f, {
    get(t, prop) {
      if (prop === Symbol.iterator) return function* () {};
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;          // never look thenable
      if (prop === 'prototype') return t.prototype;
      return proxy;
    },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

const missing = [];
const origResolve = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  // Resolve relative requests to an absolute path FIRST: the incident's own
  // handler reaches the compiled module as '../../../extension/out/...', not
  // as an absolute path, so an absolute-only check sees nothing.
  let abs = null;
  if (path.isAbsolute(request)) {
    abs = request;
  } else if (request.startsWith('.') && parent && parent.filename) {
    abs = path.resolve(path.dirname(parent.filename), request);
  }

  if (abs) {
    // node_modules is gitignored and never archived, so an in-tree path that
    // points INTO it is a dependency, not tree content. Checking it would
    // false-positive on every handler that computes a dependency path (jsdom,
    // fast-check, js-yaml all do). Dependencies are the package manifest's
    // business, not this guard's.
    if (abs.includes(`${path.sep}node_modules${path.sep}`)) {
      try {
        return origResolve.call(this, request, parent, isMain, options);
      } catch (e) {
        return '\u0000bl1385-stub:' + request;
      }
    }
    const real = abs.startsWith(TREE) ? abs : null;
    const outDir = path.join(TREE, 'extension', 'out') + path.sep;
    if (real && real.startsWith(outDir)) {
      // extension/out is gitignored and never in an archive, so ask the
      // question that actually matters: is its SOURCE on this tree?
      const rel = real.slice(outDir.length).replace(/\.js$/, '');
      for (const cand of [
        path.join(TREE, 'extension', 'src', rel + '.ts'),
        path.join(TREE, 'extension', 'src', rel + '.js'),
        path.join(TREE, 'extension', 'src', rel, 'index.ts'),
      ]) {
        if (fs.existsSync(cand)) return cand;
      }
      missing.push(`${request} (no extension/src source on this tree)`);
      const err = new Error(`BL1385_MISSING ${request}`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    // Any other in-tree relative/absolute module: it must exist ON THE TREE.
    if (real) {
      for (const cand of [real, real + '.js', real + '.json', path.join(real, 'index.js')]) {
        if (fs.existsSync(cand)) return origResolve.call(this, cand, parent, isMain, options);
      }
      missing.push(request);
      const err = new Error(`BL1385_MISSING ${request}`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
  }

  // Bare specifiers are dependencies (node builtins, node_modules). They are
  // not tree content - node_modules is gitignored and never archived - so a
  // dependency this guard cannot see is NOT a finding. Resolve if possible,
  // otherwise stand in.
  try {
    return origResolve.call(this, request, parent, isMain, options);
  } catch (e) {
    return '\u0000bl1385-stub:' + request;
  }
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const resolved = (() => {
    try { return Module._resolveFilename(request, parent, isMain); }
    catch (e) { throw e; }
  })();
  if (typeof resolved === 'string' && resolved.startsWith('\u0000bl1385-stub:')) return stub();
  if (resolved.endsWith('.ts')) return stub();
  return origLoad.call(this, request, parent, isMain);
};

try {
  require(HANDLER);
  process.exit(0);
} catch (e) {
  if (missing.length > 0) {
    process.stdout.write(missing.join('; '));
    process.exit(1);
  }
  // The handler resolved everything but threw for another reason (its own
  // top-level code). That is NOT this guard's question - BL-1371's registry
  // would surface it, and refusing here would block on unrelated behaviour.
  process.exit(0);
}
RUNNER

FAILURES=0
FAILED_LINES=""

while IFS= read -r handler; do
  name="$(basename "$handler")"
  out="$(BL1385_TREE="$WORK_TREE" BL1385_HANDLER="$handler" node "$NODE_RUNNER" 2>&1)"
  status=$?
  if [[ "$status" -ne 0 ]]; then
    FAILURES=$((FAILURES + 1))
    FAILED_LINES+="handler-load-failed: $name - ${out:-<no message>}"$'\n'
  fi
done < <(find "$STEPS_DIR" -maxdepth 1 -name '*Steps.js' -type f | sort)

if [[ "$FAILURES" -gt 0 ]]; then
  echo "HANDLER_LOAD_BLOCK"
  printf '%s' "$FAILED_LINES"
  echo "handler-graph: $FAILURES handler(s) on this tree cannot load; under BL-1371 discovery that makes EVERY acceptance run throw"
  # 1, not 3: commit_guard_chain_lib.sh's run_guard treats any status other
  # than 1 as UNEXPECTED rather than as a refusal, and this guard is a member
  # of that chain.
  exit 1
fi

exit 0
