'use strict';

// BL-1294 declared invariants (BL-654, coder-authored).
//
//   Invariant 1: "A fixture's scripts tree is never quietly smaller than the
//   closure it was asked for: a dependency the builder cannot resolve fails
//   the build naming it."
//
//   Invariant 2: "A dependency's location within the scripts tree survives
//   the copy - a fixture resolves every load-file exactly as the live tree
//   does."
//
// Both properties drive copyScriptClosure over a real (scratch) filesystem
// tree - the function is only pure over an injected READER for the closure
// walk itself; the copy step does real fs.existsSync/copyFileSync calls, so a
// property that only exercised resolveScriptClosure would not reach the bug
// this ticket fixes (the copy, not the walk, used to swallow the miss).
//
// REACH (BL-654's generator-reach clause): the dependency path is generated
// with zero, one, or two directory segments ahead of the filename, so both
// properties are asserted to actually meet a NESTED path a meaningful
// fraction of the time - a generator that only ever produced flat basenames
// would pass both properties trivially, since a flat name's "location" is
// just the scripts root either way.
//
// Non-vacuity (authoring, verified manually, not re-asserted every run):
//   P1 against the PARENT commit's `continue` (silent skip) ... FAILS, no
//     throw is raised for the missing dependency.
//   P2 against a `path.basename(dep)`-only resolver (the BL-1240 shape this
//     ticket's sibling invariant already closed) ... FAILS, the fixture gets
//     the file at the flat root instead of its nested path.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { copyScriptClosure } = require('./helpers/pinnedRepoFixture');
const { mkTmpDir } = require('./helpers/tmpDir');

const RUNS = 30;

const segmentArb = fc.constantFrom('test', 'sub', 'deepsub');
const filenameArb = fc.constantFrom('dep_alpha.bb', 'dep_beta.bb', 'dep_gamma.bb');
const depPathArb = fc
  .tuple(fc.array(segmentArb, { minLength: 0, maxLength: 2 }), filenameArb)
  .map(([segs, file]) => [...segs, file].join('/'));

function loadFileLine(depPath) {
  const quoted = depPath.split('/').map((p) => `"${p}"`).join(' ');
  return `(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ${quoted})))`;
}

function scratchDirs() {
  const liveDir = mkTmpDir('bl1294-prop-live-');
  const fixtureRoot = mkTmpDir('bl1294-prop-fixture-');
  return { liveDir, targetScripts: path.join(fixtureRoot, 'scripts'), fixtureRoot };
}

test('BL-1294 P1: an unresolvable dependency fails the copy naming it, never silently shrinking the fixture', () => {
  let reached = 0;
  let sawNested = 0;
  fc.assert(
    fc.property(depPathArb, (depPath) => {
      const { liveDir, targetScripts, fixtureRoot } = scratchDirs();
      try {
        fs.writeFileSync(path.join(liveDir, 'caller.bb'), loadFileLine(depPath));
        // Deliberately NOT creating depPath in liveDir - the unresolvable case.
        const escaped = depPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.throws(
          () => copyScriptClosure(liveDir, targetScripts, ['caller.bb']),
          new RegExp(escaped),
          `expected the copy to fail naming ${depPath}`
        );
        if (depPath.includes('/')) sawNested += 1;
        reached += 1;
      } finally {
        fs.rmSync(liveDir, { recursive: true, force: true });
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }),
    { numRuns: RUNS }
  );
  assert.ok(reached >= RUNS, `expected every run to reach the assertion, got ${reached}`);
  assert.ok(sawNested >= 8, `generator must reach nested dependency paths, saw only ${sawNested}`);
});

test('BL-1294 P2: a dependency\'s location survives the copy - never flattened to its basename', () => {
  let reached = 0;
  let sawNested = 0;
  fc.assert(
    fc.property(depPathArb, (depPath) => {
      const { liveDir, targetScripts, fixtureRoot } = scratchDirs();
      try {
        fs.writeFileSync(path.join(liveDir, 'caller.bb'), loadFileLine(depPath));
        fs.mkdirSync(path.dirname(path.join(liveDir, depPath)), { recursive: true });
        fs.writeFileSync(path.join(liveDir, depPath), '(defn f [])');

        const copied = copyScriptClosure(liveDir, targetScripts, ['caller.bb']);

        assert.ok(
          copied.includes(depPath),
          `closure must record the dependency at its real path ${depPath}, got ${JSON.stringify(copied)}`
        );
        assert.ok(
          fs.existsSync(path.join(targetScripts, depPath)),
          `the fixture must have a file at ${depPath}, not just its basename`
        );
        if (depPath.includes('/')) {
          sawNested += 1;
          // The negative check that actually distinguishes this from a
          // basename-only resolver: nothing was dropped at the flat root.
          assert.ok(
            !fs.existsSync(path.join(targetScripts, path.basename(depPath))) || depPath === path.basename(depPath),
            `a nested dependency must not ALSO (or instead) land flattened at the scripts root`
          );
        }
        reached += 1;
      } finally {
        fs.rmSync(liveDir, { recursive: true, force: true });
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }),
    { numRuns: RUNS }
  );
  assert.ok(reached >= RUNS, `expected every run to reach the assertion, got ${reached}`);
  assert.ok(sawNested >= 8, `generator must reach nested dependency paths, saw only ${sawNested}`);
});
