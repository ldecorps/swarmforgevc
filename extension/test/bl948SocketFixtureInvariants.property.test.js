'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { assertReachFloor } = require('./helpers/reachFloors');
const { findSocketFixtureRootViolation } = require('../../specs/pipeline/steps/lib/socketFixtureRootGuard');
const {
  mkSocketFixtureRoot,
  SOCKET_PATH_GUARD_LIMIT,
  WORST_CASE_SOCKET_SUFFIX,
} = require('../../specs/pipeline/steps/lib/socketFixtureRoot');

// BL-948 declared invariants (property authorship rests with the coder,
// first pass - BL-654).
//
// Invariant 1: "The gate defines the adoption set; no hand-maintained list
// of file names does. A fixture is in scope because it builds a control
// socket under its root, decided by inspection at gate time." P1 generates
// step-file bodies from independent ingredients - a socket reference (in
// code, in a comment, or absent) crossed with a root creation (long base,
// helper, or absent) plus filler - and asserts the classifier's verdict is
// exactly (socket-in-code AND long-base-root), for every combination. The
// generator draws each axis independently, so every cell of the truth
// table is common by construction.
//
// Invariant 2: "A fixture root is removed in a finally, not after the last
// assertion." P2 spawns REAL child node processes that create a root
// through the helper and then die at a generated point - a clean exit, a
// thrown error, or a nonzero process.exit - and asserts the root is gone
// afterwards in every case. Child spawns are real work, so the run count
// is modest (12 - four per death shape).
//
// BL-1062: that count used to be 12 UNIFORM draws from fc.constantFrom, and
// the line above used to claim every death shape was covered "by
// construction". It was not: P(some shape missing) = 3*(2/3)^12 - 3*(1/3)^12
// ~= 2.3% per run, and the observed red drew only `nonzero, throw`. The shapes
// are now iterated and the random draw layered on top, so the floor below is
// satisfied by construction for real - and it stays, because it is what fails
// if a shape ever stops being exercised.
//
// Non-vacuity proven at authoring time (2026-08-20), each break restored:
//   - classifier's socket-reference check inverted to also match comments
//     (stripFullLineComments dropped) -> P1 failed on comment-only draws;
//   - the helper's exit hook removal dropped -> P2 failed on every
//     throwing/nonzero-exit draw (root left behind).

const SOCKET_SNIPPETS = {
  none: '',
  comment: '// this fixture deliberately builds no tmux-socket at all\n',
  code: "fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), 'x');\n",
};

const ROOT_SNIPPETS = {
  none: '',
  helper: "const root = mkSocketFixtureRoot('p-');\n",
  longBase: "const root = fs.mkdtemp" + "Sync(path.join(os." + "tmpdir(), 'p-'));\n",
};

const FILLERS = ['', "'use strict';\n", 'const x = 1;\n// a stray note\n'];

test('BL-948 invariant 1 (property): the gate flags exactly socket-in-code AND long-base-root, over every generated file shape', () => {
  const coverage = new Map();
  fc.assert(
    fc.property(
      fc.constantFrom('none', 'comment', 'code'),
      fc.constantFrom('none', 'helper', 'longBase'),
      fc.constantFrom(...FILLERS),
      fc.boolean(),
      (socketKind, rootKind, filler, socketFirst) => {
        const parts = socketFirst
          ? [SOCKET_SNIPPETS[socketKind], ROOT_SNIPPETS[rootKind]]
          : [ROOT_SNIPPETS[rootKind], SOCKET_SNIPPETS[socketKind]];
        const text = filler + parts.join('');
        const verdict = findSocketFixtureRootViolation('genSteps.js', text);
        const expected = socketKind === 'code' && rootKind === 'longBase';
        coverage.set(`${socketKind}/${rootKind}`, (coverage.get(`${socketKind}/${rootKind}`) ?? 0) + 1);
        assert.equal(
          Boolean(verdict),
          expected,
          `socket=${socketKind} root=${rootKind}: expected flagged=${expected}, got ${JSON.stringify(verdict)}`
        );
      }
    ),
    { numRuns: 200 }
  );
  // Generator-reach floor: every cell of the 3x3 truth table drawn.
  assert.equal(coverage.size, 9, `expected all 9 truth-table cells reached, got ${[...coverage.keys()].join(', ')}`);
});

test('BL-948 invariant 2 (property): a helper root is removed whatever way the scenario dies - clean exit, throw, or nonzero exit', () => {
  const deaths = {
    clean: 'process.exit(0);',
    throw: "throw new Error('scenario failed before its cleanup');",
    nonzero: 'process.exit(3);',
  };
  const drawn = new Set();
  // BL-1062: iterate the (tiny, exhaustible) death-shape space and layer the
  // random draw inside it, rather than sampling the space and hoping the draw
  // covered it. Same total child spawns as before - 3 shapes x 4 runs = 12 -
  // so the lane's wall clock is unchanged.
  const DEATH_SHAPES = ['clean', 'throw', 'nonzero'];
  const RUNS_PER_SHAPE = 4;
  for (const deathShape of DEATH_SHAPES) {
  fc.assert(
    fc.property(fc.constant(deathShape), (death) => {
      drawn.add(death);
      const helperPath = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'socketFixtureRoot.js');
      const script =
        `const { mkSocketFixtureRoot } = require(${JSON.stringify(helperPath)});\n` +
        `const root = mkSocketFixtureRoot('bl948-p2-');\n` +
        `console.log(root);\n` +
        deaths[death];
      let stdout = '';
      try {
        stdout = execFileSync('node', ['-e', script], { encoding: 'utf8' });
      } catch (err) {
        stdout = err.stdout || '';
      }
      const root = stdout.trim().split('\n').pop();
      assert.ok(root && root.startsWith('/'), `child did not report its root, got: ${JSON.stringify(stdout)}`);
      assert.ok(!fs.existsSync(root), `expected the ${death}-death child's root to be removed, but ${root} survives`);
    }),
    { numRuns: RUNS_PER_SHAPE }
  );
  }
  // The floor STAYS (BL-1062 invariant 2): dropping it is never the remedy.
  // It is now satisfied by construction on a correct implementation, and still
  // goes red - naming the missing shape - if DEATH_SHAPES ever stops covering
  // the space this assertion names. Same shared assertion bl968 uses.
  const drawnCounts = {};
  for (const shape of drawn) {
    drawnCounts[shape] = 1;
  }
  assertReachFloor(drawnCounts, ['clean', 'throw', 'nonzero'], 1, 'death shape');
  assert.equal(drawn.size, 3, `expected every death shape drawn, got ${[...drawn].join(', ')}`);
});

test('BL-948 helper arithmetic: a fresh root leaves the worst-case socket path within the guard limit, with margin', () => {
  const root = mkSocketFixtureRoot('bl948-arith-');
  try {
    const worst = `${root}${WORST_CASE_SOCKET_SUFFIX}`;
    assert.ok(
      worst.length <= SOCKET_PATH_GUARD_LIMIT - 10,
      `expected >=10 chars of margin under ${SOCKET_PATH_GUARD_LIMIT}, got ${worst.length} for ${worst}`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
