'use strict';

// BL-1538 declared invariants (BL-654, coder-authored).
//
//   Invariant 1: "The fixture's copy set is DERIVED from the entry point it
//   drives, never hand-listed: a load-file edge added upstream tomorrow is
//   picked up with no edit to the runner."
//
//   Invariant 2: "The closure guard reads what a fixture actually copies,
//   never what its source says it copies: a runner whose printed set and
//   real copy set disagree fails the guard."
//
// Both properties drive the REAL runner's `--copy-into` flag - the behaviour
// bbFixtureClosureGate.js's 'bb-copy' kind runs to obtain a bb-authored
// fixture's effective list - against a scratch scripts tree; this is the
// bb-side sibling of BL-1279's front-desk property test over the same
// bbFixtureClosureGate.js module, which drives the shell-side 'shell-copy'
// kind the same way.
//
// REACH (BL-654's generator-reach clause):
//   Invariant 1's new load-file edge is drawn at two depths - hung off the
//   entry point itself, and hung off a lib the entry point loads - each with
//   its own floor, because an implementation that only walked one level deep
//   would pass a depth-1-only property forever.
//   Invariant 2's dropped closure member is drawn over the closure itself
//   (finite and enumerable), so every member is removed in turn rather than
//   sampled - a guard keyed to one specific filename would look just as
//   green otherwise.
//
// Non-vacuity (authoring, verified manually 2026-09-14, not re-asserted
// every run):
//   Invariant 1 against the parent commit's five-name hand list ... FAILS at
//     both depths: the new edge is never in the copy set.
//   Invariant 2 against a `--copy-into` that also read a decoy "nothing
//     missing" comment instead of running the real copy step ... the decoy
//     is exactly what this test injects, and the real read still catches the
//     dropped member, proving the guard is not fooled by it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { spawnSync } = require('node:child_process');
const { mkSharedTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const EXTENSION_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.dirname(EXTENSION_ROOT);
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ENTRY = 'promotion_gates_cli.bb';
const RUNNER_REL = path.join('test', 'bl1028_promotion_refusal_property_runner.bb');

const LOAD_LINE = (name) =>
  `(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${name}")))`;

function closureOf(scriptsDir, entry) {
  const out = spawnSync('bb', [path.join(scriptsDir, 'bb_load_closure_cli.bb'), scriptsDir, entry], {
    encoding: 'utf8',
  });
  assert.equal(out.status, 0, `closure CLI failed: ${out.stderr}`);
  return out.stdout.split('\n').filter(Boolean).sort();
}

// What the runner does for its copy step, run behaviourally via its real
// `--copy-into` flag against an arbitrary scratch scripts tree - never a
// parse of its source.
function derivedCopySet(scriptsDir, dest) {
  const runnerPath = path.join(scriptsDir, RUNNER_REL);
  const run = spawnSync('bb', [runnerPath, '--copy-into', dest], { encoding: 'utf8' });
  assert.equal(run.status, 0, `--copy-into failed: ${run.stderr}`);
  return fs.readdirSync(dest).filter((f) => f.endsWith('.bb')).sort();
}

function copyScriptsTree(dest) {
  for (const name of fs.readdirSync(SCRIPTS)) {
    const from = path.join(SCRIPTS, name);
    if (fs.statSync(from).isFile()) {
      fs.copyFileSync(from, path.join(dest, name));
    }
  }
  // The runner derives scripts-dir from its OWN location (parent of parent),
  // so the scratch copy must sit at the same depth under the scratch tree.
  fs.mkdirSync(path.join(dest, 'test'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, RUNNER_REL), path.join(dest, RUNNER_REL));
}

const DEPTHS = ['at the entry point', 'inside a lib it loads'];
// BL-1586: the per-cell run count expressed through runsPerCell rather than
// a bare literal, budget unchanged (3 per depth, 6 total).
const DEPTH_FLOOR = runsPerCell(DEPTHS.length * 3, DEPTHS.length);

describe('BL-1538 invariant 1: the copy set is derived from the closure, never hand-listed', () => {
  it('copies exactly the closure however the tree gains load-file edges', () => {
    const coverage = {};
    // One fc.assert per depth: the floor is then met by construction, not by
    // hoping a uniform constantFrom draw covered both.
    for (const drawnDepth of DEPTHS) {
      fc.assert(
        fc.property(fc.constant(drawnDepth), fc.integer({ min: 1, max: 3 }), (depth, extra) => {
          coverage[depth] = (coverage[depth] || 0) + 1;
          const root = mkSharedTmpDir('bl1538-prop-src-');
          const dest = mkSharedTmpDir('bl1538-prop-dest-');
          try {
            copyScriptsTree(root);
            const added = [];
            for (let i = 0; i < extra; i += 1) {
              const name = `bl1538_prop_edge_${depth === DEPTHS[0] ? 'entry' : 'lib'}_${i}.bb`;
              fs.writeFileSync(path.join(root, name), `(def bl1538-prop-${i} true)\n`);
              added.push(name);
            }
            // Depth 1 hangs the new edges off the entry point; depth 2 hangs
            // them off a lib the entry point loads, so only a TRANSITIVE
            // walk reaches them.
            const host = depth === DEPTHS[0] ? ENTRY : 'promotion_gates_lib.bb';
            const hostPath = path.join(root, host);
            const anchor = depth === DEPTHS[0] ? LOAD_LINE('backlog_depth_lib.bb') : null;
            const source = fs.readFileSync(hostPath, 'utf8');
            const injected = added.map(LOAD_LINE).join('\n');
            if (anchor) {
              assert.ok(source.includes(anchor), 'the load-file idiom this property extends has changed');
              fs.writeFileSync(hostPath, source.replace(anchor, `${anchor}\n${injected}`));
            } else {
              // A lib has no (-main); prepending is safe and keeps the edge
              // transitive rather than direct.
              fs.writeFileSync(hostPath, `${injected}\n${source}`);
            }

            const copied = derivedCopySet(root, dest);
            const closure = closureOf(root, ENTRY);

            assert.deepEqual(copied, closure, 'the copy set and the closure disagree');
            for (const name of added) {
              assert.ok(copied.includes(name), `${name} (${depth}) was not derived into the fixture root`);
            }
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(dest, { recursive: true, force: true });
          }
          return true;
        }),
        { numRuns: DEPTH_FLOOR }
      );
    }
    assertReachFloor(coverage, DEPTHS, DEPTH_FLOOR, 'new-edge depth');
  });
});

describe('BL-1538 invariant 2: the guard reads what the fixture actually copies, never what its source claims', () => {
  const closure = closureOf(SCRIPTS, ENTRY);
  const COPY_ANCHOR =
    '(doseq [dep promotion-gate-deps]\n      (fs/copy (fs/path scripts-dir dep) (fs/path dest dep) {:replace-existing true}))';

  it('a dropped closure member is caught, however loudly the source claims full coverage', () => {
    const coverage = {};
    // The domain is the closure itself: finite and enumerable, so each
    // member is removed from the ACTUAL copy in turn rather than sampled -
    // a guard keyed to one specific filename would look just as green.
    // BL-1586: the per-member run count expressed through runsPerCell rather
    // than a bare literal, budget unchanged (1 per member).
    const CLOSURE_CELL_RUNS = runsPerCell(closure.length, closure.length);
    for (const member of closure) {
      fc.assert(
        fc.property(fc.constant(member), (removed) => {
          coverage[removed] = (coverage[removed] || 0) + 1;
          const root = mkSharedTmpDir('bl1538-prop-broken-src-');
          const dest = mkSharedTmpDir('bl1538-prop-broken-dest-');
          try {
            copyScriptsTree(root);
            const runnerPath = path.join(root, RUNNER_REL);
            const source = fs.readFileSync(runnerPath, 'utf8');
            assert.ok(source.includes(COPY_ANCHOR), 'the --copy-into doseq shape this property patches has changed');
            // A DECOY claim, textually present in the source, asserting the
            // opposite of what is about to be true - exactly the shape a
            // "kept in sync" comment takes. A source-reading guard would
            // believe it; a behavioural one cannot.
            const decoy =
              `;; BL-1538 status (decoy, injected by a property test): this fixture\n` +
              `;; copies its entry point's full closure - nothing is ever missing.\n`;
            const broken = source
              .replace(COPY_ANCHOR, COPY_ANCHOR.replace('promotion-gate-deps]', `(remove #{"${removed}"} promotion-gate-deps)]`))
              .replace('(def promotion-gate-deps', `${decoy}(def promotion-gate-deps`);
            fs.writeFileSync(runnerPath, broken);

            const copied = derivedCopySet(root, dest);
            const have = new Set(copied);

            assert.ok(!have.has(removed), `${removed} was expected to be dropped from the real copy but is present`);
            // This IS the guard's own comparison (bbFixtureClosureGate.js's
            // missingFromList): the closure member not present in what was
            // actually copied.
            const missing = [...closure].filter((f) => !have.has(f));
            assert.ok(missing.includes(removed), `the guard's own comparison did not name ${removed}: ${missing.join(', ')}`);
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(dest, { recursive: true, force: true });
          }
          return true;
        }),
        { numRuns: CLOSURE_CELL_RUNS }
      );
    }
    assertReachFloor(coverage, closure, CLOSURE_CELL_RUNS, 'closure member dropped');
  });
});
