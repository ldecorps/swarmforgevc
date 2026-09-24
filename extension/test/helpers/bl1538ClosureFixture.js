'use strict';

// BL-1695: the shared fixture-building logic
// bl1538Bl1028RunnerFixtureClosureInvariants.property.test.js and its own
// acceptance step handler
// (specs/pipeline/steps/bl1695ClosureFixtureCopiesOnlyTheClosureSteps.js)
// both drive - never each reimplementing it (the stepHandlerRequireCensus.js
// precedent: one real implementation, several drivers).
//
// copyScriptsTree(dest) copies the SMALLEST set the runner needs to
// actually run `--copy-into` against a scratch root: promotion_gates_cli.bb's
// own transitive load-file closure (closureOf), the runner's own
// bb_load_closure_lib.bb dependency (it load-files this directly to
// recompute the closure from whatever is on disk when it runs - the
// mechanism invariant 1's injected load-file edges rely on), the
// bb_load_closure_cli.bb wrapper invariant 1's own closureOf(root, ENTRY)
// call spawns, and the runner itself - never the whole 496-file
// swarmforge/scripts directory (BL-1695's own fix; BL-1538 originally
// copied every file directly under swarmforge/scripts, ~130MB and sixteen
// bb starts per property run under lane load).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXTENSION_ROOT = path.join(__dirname, '..', '..');
const REPO_ROOT = path.dirname(EXTENSION_ROOT);
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ENTRY = 'promotion_gates_cli.bb';
const RUNNER_REL = path.join('test', 'bl1028_promotion_refusal_property_runner.bb');
// Neither is ENTRY's own dependency - both are TOOLING the test code
// (invariant 1's own closureOf(root, ENTRY) re-derivation, and the
// runner's own recomputation of promotion-gate-deps) drives against the
// scratch root, not something promotion_gates_cli.bb itself load-files.
// Neither has a load-file dependency beyond the other (bb_load_closure_cli.bb
// load-files bb_load_closure_lib.bb; the lib is self-contained over
// babashka.fs only) - verified empirically: omitting either makes the
// runner's own `(load-file ".../bb_load_closure_lib.bb")` (line ~56) or
// invariant 1's closureOf(root, ENTRY) call fail with "File does not
// exist" (BL-1695 authoring, 2026-09-22).
const CLOSURE_LIB = 'bb_load_closure_lib.bb';
const CLOSURE_CLI = 'bb_load_closure_cli.bb';

function closureOf(scriptsDir, entry) {
  const out = spawnSync('bb', [path.join(scriptsDir, 'bb_load_closure_cli.bb'), scriptsDir, entry], {
    encoding: 'utf8',
  });
  assert.equal(out.status, 0, `closure CLI failed: ${out.stderr}`);
  return out.stdout.split('\n').filter(Boolean).sort();
}

// The real ENTRY's closure against the real SCRIPTS dir - static for the
// process (neither changes at runtime), computed once here rather than
// once per property iteration inside copyScriptsTree.
const BASE_CLOSURE = closureOf(SCRIPTS, ENTRY);

// Every name copyScriptsTree writes into dest, for a caller (the step
// handler) that wants to assert on the expected set without duplicating
// copyScriptsTree's own list.
function expectedCopySetNames() {
  return [...BASE_CLOSURE, CLOSURE_LIB, CLOSURE_CLI];
}

function copyScriptsTree(dest) {
  for (const name of BASE_CLOSURE) {
    fs.copyFileSync(path.join(SCRIPTS, name), path.join(dest, name));
  }
  fs.copyFileSync(path.join(SCRIPTS, CLOSURE_LIB), path.join(dest, CLOSURE_LIB));
  fs.copyFileSync(path.join(SCRIPTS, CLOSURE_CLI), path.join(dest, CLOSURE_CLI));
  fs.mkdirSync(path.join(dest, 'test'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, RUNNER_REL), path.join(dest, RUNNER_REL));
}

// What the runner does for its copy step, run behaviourally via its real
// `--copy-into` flag against an arbitrary scratch scripts tree - never a
// parse of its source. Returns the raw spawn result plus the copied set;
// deliberately asserts NOTHING itself - the property test file's own
// call sites own that (BL-1695's invariant is about every assertion IN
// THE FILE naming its member/cause, so the assertion text itself stays
// there, not shared out here alongside the mechanics).
function runCopyInto(scriptsDir, dest) {
  const runnerPath = path.join(scriptsDir, RUNNER_REL);
  const run = spawnSync('bb', [runnerPath, '--copy-into', dest], { encoding: 'utf8' });
  const copied = run.status === 0 ? fs.readdirSync(dest).filter((f) => f.endsWith('.bb')).sort() : [];
  return { status: run.status, stderr: run.stderr, copied };
}

module.exports = {
  SCRIPTS,
  ENTRY,
  RUNNER_REL,
  CLOSURE_LIB,
  CLOSURE_CLI,
  BASE_CLOSURE,
  closureOf,
  expectedCopySetNames,
  copyScriptsTree,
  runCopyInto,
};
