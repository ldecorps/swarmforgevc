'use strict';

// BL-1905: does an acceptance step handler start a receive or completion
// dispatcher from the REAL scripts dir? Those dispatchers cd into their own
// scripts dir, so started from the real one they receive and complete in the
// checkout running the feature, as the fixture's role, against the live
// mailbox. BL-998's guard covers the shell tests; this covers
// specs/pipeline/steps. Shared by bl1905StepHandlerNeverRunsRealDispatcherSteps.js
// and its invariant's property test, so neither restates the scan.
//
// The dispatcher set is DERIVED, never listed: the self-rooting set BL-998's
// guard computes (step 1 closed over sibling invocations by step 1b, read
// from the guard's own `bash -x` trace by bl1539SelfRootingDerivationLib),
// narrowed to its receive and completion members (ready_for_next*,
// done_with_current*).
//
// The scan parses each handler (TypeScript's parser, which reads plain JS):
// 1. A REAL-dir value is any variable whose initializer mentions __dirname,
//    or a variable already known to be real-dir (to a fixpoint). A fixture's
//    own copy is anchored elsewhere and is never real-dir.
// 2. A dispatcher path is a real-dir variable whose initializer names a
//    dispatcher, a path.join/resolve over a real-dir value and a dispatcher
//    name, or a variable built from either (aliases, to a fixpoint). A
//    handler holding one is a CANDIDATE.
// 3. Each use of a dispatcher path is judged by the innermost call that
//    receives it. path.* calls and fs.realpathSync pass their result on, so
//    the scan keeps climbing. Read-only fs calls and assertions are safe
//    sinks. Any other call, a spawn, a local wrapper or an imported helper,
//    starts or may start a process with it, so the use is FLAGGED. Unknown
//    callees flag: a false alarm costs a review, a miss costs a live mailbox.

const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, REAL_GUARD } = require('./bl1539SelfRootingDerivationLib');

// TypeScript's parser is loaded on the first scan, never at require time:
// every step handler is required at registry load (BL-1569's module-load
// budget), and only this feature's steps scan.
let ts = null;
function parser() {
  if (!ts) ts = require(path.join(REPO_ROOT, 'extension', 'node_modules', 'typescript'));
  return ts;
}

const STEPS_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps');
const DISPATCHER_PREFIX = /^(ready_for_next|done_with_current)/;

// Step 1 closed by step 1b: the LAST `SELF_ROOTING=` assignment the guard's
// -x trace prints (bl1539's reader takes the first, step 1 alone, which
// misses done_with_current_task.bb - the helper this ticket is about).
function deriveClosedSelfRooting(guardPath = REAL_GUARD) {
  const { spawnSync } = require('node:child_process');
  // The guard stops after step 1b when asked (exit 3, never a pass): this
  // reads only the closed set, and step 2 is most of the -x run.
  const { stdout, stderr } = spawnSync('bash', ['-x', guardPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SWARMFORGE_GUARD_DERIVE_ONLY: '1' },
  });
  const trace = `${stdout}\n${stderr}`;
  const all = [...trace.matchAll(/\n\+ SELF_ROOTING=(?:'([^']*)'|(\S+))/g)];
  if (!all.length) throw new Error(`no SELF_ROOTING= assignment in the guard's -x trace:\n${trace.slice(-2000)}`);
  const last = all[all.length - 1];
  return (last[1] !== undefined ? last[1] : last[2]).split('\n').filter(Boolean);
}

let cachedDispatchers = null;
function dispatcherNames() {
  if (!cachedDispatchers) {
    cachedDispatchers = deriveClosedSelfRooting().filter((n) => DISPATCHER_PREFIX.test(n)).sort();
    if (!cachedDispatchers.length) throw new Error('derivation broke: no receive or completion dispatcher in the self-rooting set');
  }
  return cachedDispatchers;
}

const TRANSPARENT = /^(path\.(join|resolve|normalize|dirname|basename|relative)|fs\.realpathSync|String)$/;
const SAFE_SINKS =
  /^(fs\.(readFileSync|existsSync|statSync|lstatSync|accessSync|readdirSync|copyFileSync|openSync)|assert(\.[A-Za-z]+)?|console\.[a-z]+|JSON\.stringify|require\.resolve)$/;

function calleeText(call, sf) {
  return call.expression.getText(sf).replace(/\s+/g, '');
}

// Exact-name match on a literal: 'ready_for_next_task.bb' never names
// 'ready_for_next_task.sh', nor does a longer file name containing one.
function literalNames(n, sf, names) {
  if (!(ts.isStringLiteralLike(n) || ts.isTemplateExpression(n))) return null;
  const text = n.getText(sf).slice(1, -1);
  return names.find((name) => text === name || text.endsWith(`/${name}`)) || null;
}

function namesADispatcher(node, sf, names) {
  let found = null;
  const visit = (n) => {
    if (found) return;
    found = literalNames(n, sf, names);
    if (!found) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

// The block, function body or file a declaration is visible in.
function scopeOf(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isForOfStatement(p) || ts.isForStatement(p) || ts.isForInStatement(p) || ts.isFunctionLike(p)) return p;
  }
  return null;
}

function scanSource(src, names = dispatcherNames(), fileName = 'handler.js') {
  parser();
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  // Every binding with a value: `const X = init`, and `for (const X of init)`
  // (iterating over dispatcher paths must not hide one).
  const decls = [];
  const visitDecl = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const loop = n.parent && n.parent.parent;
      if (n.initializer) decls.push({ node: n, name: n.name.text, init: n.initializer, scope: scopeOf(n) });
      else if (loop && ts.isForOfStatement(loop)) decls.push({ node: n, name: n.name.text, init: loop.expression, scope: loop });
    }
    ts.forEachChild(n, visitDecl);
  };
  visitDecl(sf);
  // An identifier resolves to the innermost visible declaration of its name.
  const resolve = (id) => {
    let best = null;
    for (const d of decls) {
      if (d.name !== id.text || !d.scope || id.pos < d.scope.pos || id.end > d.scope.end) continue;
      if (!best || d.scope.pos >= best.scope.pos) best = d;
    }
    return best;
  };
  const mentions = (node, set) => {
    let hit = false;
    const visit = (n) => {
      if (hit) return;
      if (ts.isIdentifier(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
        const d = resolve(n);
        if (d && set.has(d)) hit = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return hit;
  };

  // 1. real-dir values
  const real = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of decls) {
      if (real.has(d)) continue;
      if (/__dirname/.test(d.init.getText(sf)) || mentions(d.init, real)) {
        real.add(d);
        grew = true;
      }
    }
  }

  // 2. dispatcher paths: inline joins, then variables, then aliases
  const isInlineHit = (n) =>
    ts.isCallExpression(n) &&
    /^path\.(join|resolve)$/.test(calleeText(n, sf)) &&
    n.arguments.some((a) => mentions(a, real)) &&
    n.arguments.some((a) => namesADispatcher(a, sf, names));
  const inlineHits = [];
  const visitInline = (n) => {
    if (isInlineHit(n)) inlineHits.push(n);
    ts.forEachChild(n, visitInline);
  };
  visitInline(sf);
  const within = (n, list) => list.some((h) => n.pos >= h.pos && n.end <= h.end);
  const hits = new Map();
  for (const d of decls) {
    if (real.has(d)) {
      const name = namesADispatcher(d.init, sf, names);
      if (name) hits.set(d, name);
    }
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of decls) {
      if (hits.has(d)) continue;
      if (mentions(d.init, new Set(hits.keys())) || inlineHits.some((h) => h.pos >= d.init.pos && h.end <= d.init.end)) {
        hits.set(d, '(alias)');
        grew = true;
      }
    }
  }
  const candidate = hits.size > 0 || inlineHits.length > 0;

  // 3. judge each use by its innermost receiving call, never climbing out of
  // the statement or function the use sits in.
  const flagged = [];
  const judge = (use, label) => {
    let child = use;
    for (let p = use.parent; p; child = p, p = p.parent) {
      if (ts.isFunctionLike(p) || ts.isBlock(p) || ts.isSourceFile(p)) return;
      if (ts.isVariableDeclaration(p) && p.initializer === child) return; // a binding, judged through its alias
      if (ts.isForOfStatement(p) && p.expression === child) return; // judged through the loop variable
      if (ts.isCallExpression(p) && p.expression === child) return; // a call ON the path, e.g. DONE.endsWith()
      if (ts.isCallExpression(p) && p.arguments.includes(child)) {
        const callee = calleeText(p, sf);
        if (TRANSPARENT.test(callee)) continue;
        if (SAFE_SINKS.test(callee)) return;
        const { line } = sf.getLineAndCharacterOfPosition(p.getStart(sf));
        flagged.push({ line: line + 1, callee, path: label });
        return;
      }
    }
  };
  for (const h of inlineHits) judge(h, h.getText(sf));
  const visitUse = (n) => {
    if (ts.isIdentifier(n) && !within(n, inlineHits)) {
      const p = n.parent;
      const isDecl = ts.isVariableDeclaration(p) && p.name === n;
      const isProp = ts.isPropertyAccessExpression(p) && p.name === n;
      const d = !isDecl && !isProp ? resolve(n) : null;
      if (d && hits.has(d)) judge(n, n.text);
    }
    ts.forEachChild(n, visitUse);
  };
  visitUse(sf);
  return {
    candidate,
    hits: [...hits.entries()].map(([d, v]) => `${d.name}=${v}`).concat(inlineHits.map((h) => h.getText(sf))),
    flagged,
  };
}

function scanDir(dir = STEPS_DIR, names = dispatcherNames()) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((file) => ({ file, ...scanSource(fs.readFileSync(path.join(dir, file), 'utf8'), names, file) }));
}

module.exports = { STEPS_DIR, deriveClosedSelfRooting, dispatcherNames, scanSource, scanDir };
