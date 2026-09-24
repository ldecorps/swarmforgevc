'use strict';

// BL-1356's two DECLARED invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A stamp-off invariant fails when, and only when, the run that
//                executes it changed the row it watches - no value the row
//                legitimately held before the run is a violation, and any
//                write the run makes to it is.
//   invariant 2  Scoping the assertion never weakens it: a run that stamps a
//                decision into the ledger still fails, whatever state the row
//                held beforehand.
//
// Drives the REAL helper the six stamp-off files now call, against generated
// ledgers on disk. The ledger path is injected so a proof that the gate still
// bites does not require writing to the live file.
//
// GENERATOR REACH (by construction, never by draw). The verdict has exactly
// two sides and the defect lived in the "passes" side, so BOTH are enumerated
// rather than sampled: every starting state is crossed with every write kind,
// including the no-write case. The starting states include the DECIDED ones -
// a row already certified or waived is the case a state-literal pin got wrong
// in both directions, and a draw that never produced it would leave the whole
// point of the ticket untested.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir, sweepStaleTmpDirs } = require('./helpers/tmpDir');
const { assertRunWritesNoDecision } = require('./helpers/stampOff');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const FIXTURE_PREFIX = 'bl1356-property-';
const HOTFIX = 'abc1234567';

// Every state a row legitimately passes through, decided ones included.
const STATES = ['stamp-open', 'pending', 'awaiting-human', 'certified', 'waived'];

// What a run can do to the WATCHED row. Only the first leaves it untouched.
//
// Every edit is applied inside that row's own block, never to the file at
// large: a whole-file replace lands on whichever decided neighbour comes first
// and the run then changes nothing, so the case under test never happens and
// the row passes for the wrong reason. This test caught exactly that in its own
// first draft.
const WRITES = {
  'writes nothing': null,
  'writes a decided state': (row) =>
    row.replace(/^  state: .*$/m, /state: certified/.test(row) ? '  state: waived' : '  state: certified'),
  'writes a waiver': (row) =>
    row.replace(/^  state: .*$/m, /state: waived/.test(row) ? '  state: certified' : '  state: waived'),
  'writes a human_decision': (row) => row.replace('human_decision: null', 'human_decision: certified'),
  'writes a decision timestamp': (row) => row.replace('decided_at: null', 'decided_at: 2026-09-03'),
  'edits the row some other way': (row) => row.replace('stamp_ticket: BL-9999', 'stamp_ticket: BL-0000'),
};

/** Apply `write` to the watched row only, and hand back the whole ledger. */
function applyToWatchedRow(text, write) {
  const start = text.indexOf(`- commit: ${HOTFIX}`);
  assert.notEqual(start, -1, 'fixture lost its watched row');
  const rest = text.slice(start);
  const end = rest.indexOf('\n- commit:');
  const row = end === -1 ? rest : rest.slice(0, end);
  const rewritten = write(row);
  assert.notEqual(rewritten, row, 'the write did not change the watched row - the case would not be tested');
  return text.slice(0, start) + rewritten + (end === -1 ? '' : rest.slice(end));
}

// A killed run traps no `finally`, so the previous run's fixtures are swept by
// prefix BEFORE this one starts as well (BL-971).
// BL-1623: scoped by owner pid through the shared helper - a blind
// prefix sweep destroys a live peer's roots the instant two instances
// of this file are ever alive at once (BL-1385/BL-1390's shape).
function sweepFixtures() {
  sweepStaleTmpDirs({ prefix: FIXTURE_PREFIX });
}

/** A ledger whose watched row sits at `state`, between two decided neighbours. */
function writeLedger(dir, state) {
  const file = path.join(dir, 'hotfix-ledger.yaml');
  fs.writeFileSync(
    file,
    [
      'entries:',
      '- commit: 0000000000',
      '  state: certified',
      '  human_decision: certified',
      '  decided_at: 2026-01-01',
      `- commit: ${HOTFIX}`,
      `  state: ${state}`,
      '  stamp_ticket: BL-9999',
      '  human_decision: null',
      '  decided_at: null',
      '- commit: ffffffffff',
      '  state: waived',
      '',
    ].join('\n')
  );
  return file;
}

function verdict(state, writeName) {
  const dir = mkTmpDir(`${FIXTURE_PREFIX}${process.pid}-`);
  try {
    const file = writeLedger(dir, state);
    const write = WRITES[writeName];
    const work = write
      ? () => fs.writeFileSync(file, applyToWatchedRow(fs.readFileSync(file, 'utf8'), write))
      : () => {};
    try {
      assertRunWritesNoDecision(HOTFIX, work, { ledgerPath: file });
      return 'passes';
    } catch (err) {
      return `fails: ${err.message}`;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('BL-1356/BL-654 invariant 1: the verdict is about what the run wrote, never what the row said', () => {
  sweepFixtures();
  const reach = { untouched: 0, written: 0, decidedStart: 0 };

  fc.assert(
    fc.property(fc.constantFrom(...STATES), fc.constantFrom(...Object.keys(WRITES)), (state, writeName) => {
      const got = verdict(state, writeName);
      if (state === 'certified' || state === 'waived') reach.decidedStart += 1;

      if (WRITES[writeName] === null) {
        reach.untouched += 1;
        // The whole point: a row that legitimately advanced - to ANY state,
        // decided ones included - is not a violation when the run wrote
        // nothing.
        assert.equal(got, 'passes', `a run that wrote nothing failed on a row at ${state}: ${got}`);
      } else {
        reach.written += 1;
        assert.match(got, /^fails: /, `a run that ${writeName} passed on a row at ${state}`);
      }
      return true;
    }),
    // BL-1691: reach here is already guaranteed BY CONSTRUCTION by the
    // exhaustive cross-product loop below, not by this sampled draw - this
    // fc.assert is a supplementary spot-check, its own budget routed
    // through runsPerCell (single-cell identity) so the shared reach-floor
    // machinery below is what the coverage is actually asserted through.
    { numRuns: runsPerCell(STATES.length * Object.keys(WRITES).length * 2, 1) }
  );

  // Enumerated, so the cross-product is covered whatever the draw did.
  for (const state of STATES) {
    for (const writeName of Object.keys(WRITES)) {
      const got = verdict(state, writeName);
      assert.equal(
        WRITES[writeName] === null ? 'passes' : got.slice(0, 6),
        WRITES[writeName] === null ? got : 'fails:',
        `${state} x ${writeName}: ${got}`
      );
    }
  }

  assertReachFloor(reach, ['untouched', 'written', 'decidedStart'], 1, 'run-shape');
});

test('BL-1356/BL-654 invariant 2: a run that stamps a decision fails from EVERY starting state', () => {
  sweepFixtures();
  const decisionWrites = Object.keys(WRITES).filter(
    (name) => WRITES[name] !== null && name !== 'edits the row some other way'
  );
  const reach = Object.fromEntries(STATES.map((s) => [s, 0]));

  // By construction: every state crossed with every decision-writing run. A
  // "fix" that softened the gate shows up here as a pass, from some state.
  for (const state of STATES) {
    for (const writeName of decisionWrites) {
      reach[state] += 1;
      const got = verdict(state, writeName);
      assert.match(
        got,
        /^fails: /,
        `scoping weakened the gate: ${writeName} passed on a row starting at ${state}`
      );
      // And it names the decision, not merely a difference - the message is
      // what a reviewer reads when the gate bites.
      assert.match(got, /wrote a decision into|changed /, got);
    }
  }

  assertReachFloor(reach, STATES, 1, 'starting-state');

  fc.assert(
    fc.property(fc.constantFrom(...STATES), fc.constantFrom(...decisionWrites), (state, writeName) => {
      assert.match(verdict(state, writeName), /^fails: /);
      return true;
    }),
    // BL-1691: same posture as invariant 1's own supplementary fc.assert -
    // the exhaustive loop above already guarantees reach; this is a
    // spot-check, budget routed through runsPerCell for the classifier.
    { numRuns: runsPerCell(20, 1) }
  );
});
