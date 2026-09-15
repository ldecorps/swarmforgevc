'use strict';

// BL-1358: PROPERTY tests over the two invariants the ticket YAML declares
// (coder-authored first, per BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   P1 the-ceiling-never-silently-changes-a-verdict - a mutant that timed out
//      is reported as timed out, and NEVER folded into detected (test_failure)
//      or into surviving (test_success); and a mutant that did NOT time out
//      never acquires a timeout verdict it did not earn. The ceiling is a new
//      answer, not a new way to give an old one.
//   P2 one-timeout-never-invalidates-the-rest - every other mutant in a run
//      containing a hang carries exactly the outcome it carries in a run with
//      no hang at all. Not "some outcome" - the SAME one.
//
// Drives the REAL specs/pipeline/mutationWorker.js `handle` over the REAL
// runnerAdapter spawn, one worker request per mutant, exactly as the vendored
// gherkin-mutator drives it over stdio. A model of the decision would be
// green against the defect: the defect was that nothing bounded the wait, and
// a fake wait is bounded by construction.
//
// GENERATOR REACH is CONSTRUCTED and asserted. A hang is not a state a random
// scenario reaches, so runs are built with a hang at a DRAWN POSITION among
// ordinary mutants - first, middle and last all occur - and the no-hang
// control is its own pass. P2 is meaningless unless a mutant actually follows
// a timed-out one, so the last-position-only case would prove nothing; the
// run records the positions it exercised and fails if the hang was never
// followed by another mutant.
//
// BL-1581: the hang's position is one of three CELLS - first, middle, last -
// reached BY CONSTRUCTION with an outer loop and its own floor-sized run
// budget each (the BL-1578/BL-1580 shape), rather than hoped for by a
// uniform fc.nat({max:2}) draw over 3 runs, which missed a following mutant
// (P2) about one run in 23 (132 of 3000 simulated seeds). The draw budget
// of 3 and the 1000 ms ceiling are unchanged; only how the budget is spent
// changes.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { handle } = require('../../specs/pipeline/mutationWorker');

const FIXTURE_PREFIX = 'bl1358-property-';
const CEILING_MS = '1000';

// One kind per mutant. `hang` keeps a live interval so the event loop never
// drains - a bare unresolved promise does NOT hang, node:test cancels it as
// soon as the loop empties, and a fixture built that way would exercise
// nothing (learned in this parcel's own unit tests).
const STEP_BODIES = {
  pass: 'assert.equal(1, 1);',
  fail: 'assert.equal(1, 2);',
  hang: 'await new Promise(() => { setInterval(() => {}, 20); });',
};

function sweepFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function runMutant(kind, id) {
  // BL-1280: the swept helper, never a raw fs.mkdtempSync - its root is
  // registered with the suite's own sweep instead of relying on this file's.
  const dir = mkTmpDir(FIXTURE_PREFIX);
  try {
    const stepsPath = path.join(dir, 'steps.js');
    fs.writeFileSync(
      stepsPath,
      "'use strict';\n" +
        "const assert = require('node:assert/strict');\n" +
        'function registerSteps(registry) {\n' +
        `  registry.define(/^the mutant behaves$/, async () => { ${STEP_BODIES[kind]} });\n` +
        '}\n' +
        'module.exports = { registerSteps };\n',
      'utf8'
    );
    const featurePath = path.join(dir, 'feature.json');
    fs.writeFileSync(
      featurePath,
      JSON.stringify({
        name: `mutant ${id}`,
        scenarios: [{ name: 'behaves', steps: [{ keyword: 'Given', text: 'the mutant behaves' }] }],
      }),
      'utf8'
    );
    return handle({ id, feature_json: featurePath, work_dir: dir }, stepsPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// What a mutant of each kind is owed, with no hang anywhere near it.
const EXPECTED = {
  pass: 'test_success',
  fail: 'test_failure',
};

function withCeiling(fn) {
  const previous = process.env.GHERKIN_MUTATION_TIMEOUT_MS;
  process.env.GHERKIN_MUTATION_TIMEOUT_MS = CEILING_MS;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.GHERKIN_MUTATION_TIMEOUT_MS;
    else process.env.GHERKIN_MUTATION_TIMEOUT_MS = previous;
  }
}

test('BL-1358/BL-654 P1+P2: a timeout is its own verdict, and leaves every other mutant its ordinary one', () => {
  sweepFixtures();
  const ordinaryArb = fc.constantFrom('pass', 'fail');
  let hangFollowed = 0;
  let runs = 0;

  // BL-1581: first, middle, last - one cell each, runsPerCell(3, 3) draws
  // per cell. "middle" needs a genuine middle slot, so its ordinary array
  // is drawn at exactly length 2 (position 1 of 2); "first" and "last" keep
  // the original 1-2 length, with the position derived from the cell
  // rather than drawn.
  const POSITION_CELLS = ['first', 'middle', 'last'];
  // Independent of POSITION_CELLS on purpose: the floor must still name a
  // cell dropped from the loop above, never shrink to match whatever the
  // loop happens to iterate (qa_e2e_procedure step 3's break-then-restore).
  const REQUIRED_POSITIONS = ['first', 'middle', 'last'];
  const CELL_RUNS = runsPerCell(3, REQUIRED_POSITIONS.length);
  const counts = { first: 0, middle: 0, last: 0 };

  for (const cell of POSITION_CELLS) {
    const arrayArb =
      cell === 'middle'
        ? fc.array(ordinaryArb, { minLength: 2, maxLength: 2 })
        : fc.array(ordinaryArb, { minLength: 1, maxLength: 2 });

    fc.assert(
      fc.property(arrayArb, (ordinary) => {
        // Constructed: exactly one hang, at the position this cell fixes.
        // A hang is never reached by drawing scenario text.
        const position = cell === 'first' ? 0 : cell === 'middle' ? 1 : ordinary.length;
        const kinds = [...ordinary.slice(0, position), 'hang', ...ordinary.slice(position)];
        if (position < ordinary.length) hangFollowed += 1;
        runs += 1;
        counts[cell] += 1;

        const responses = withCeiling(() => kinds.map((kind, i) => runMutant(kind, `m${i}`)));

        responses.forEach((response, i) => {
          if (kinds[i] === 'hang') {
            // P1: its own verdict, never one of the other two.
            assert.equal(response.timed_out, true, `mutant ${i} hung but was not reported as timed out`);
            assert.equal(response.outcome, 'infrastructure_error');
            assert.notEqual(response.outcome, 'test_failure', 'a timeout was folded into detected');
            assert.notEqual(response.outcome, 'test_success', 'a timeout was folded into surviving');
            assert.match(String(response.error), new RegExp(`m${i}`), 'the timeout did not name the mutant');
            assert.match(String(response.error), new RegExp(CEILING_MS), 'the timeout did not name the ceiling');
          } else {
            // P2: exactly the outcome this kind carries with no hang in sight,
            // and no timeout verdict it did not earn (the other half of P1).
            assert.equal(
              response.outcome,
              EXPECTED[kinds[i]],
              `a ${kinds[i]} mutant next to a timeout reported ${response.outcome}`
            );
            assert.notEqual(response.timed_out, true, `a ${kinds[i]} mutant was reported as timed out`);
          }
        });
        return true;
      }),
      { numRuns: CELL_RUNS }
    );
  }

  assertReachFloor(counts, REQUIRED_POSITIONS, CELL_RUNS, 'position');
  assert.ok(runs > 0, 'no run was generated');
  // A hang in last position alone would prove nothing about the rest of the
  // run continuing, so the reach that matters is asserted specifically.
  assert.ok(hangFollowed > 0, 'the hang was never followed by another mutant - P2 was never actually exercised');
  console.log(
    `BL-1581 reach map (bl1358): ${JSON.stringify({ positions: POSITION_CELLS.length, minDrawsPerPosition: CELL_RUNS })}`
  );
});

test('BL-1358/BL-654 P1 control: with no hang anywhere, no mutant acquires a timeout verdict', () => {
  sweepFixtures();
  let reached = 0;

  fc.assert(
    fc.property(fc.array(fc.constantFrom('pass', 'fail'), { minLength: 1, maxLength: 3 }), (kinds) => {
      reached += 1;
      const responses = withCeiling(() => kinds.map((kind, i) => runMutant(kind, `c${i}`)));
      responses.forEach((response, i) => {
        assert.equal(response.outcome, EXPECTED[kinds[i]]);
        assert.notEqual(response.timed_out, true, 'a mutant that finished was reported as timed out');
      });
      return true;
    }),
    { numRuns: 3 }
  );

  assert.ok(reached > 0, 'never exercised the no-hang control');
});
