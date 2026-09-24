'use strict';

// BL-1365 declared invariants:
//
// 1. Candidates are computed OUTSIDE the ceremony on an independent cadence
//    and merely READ by it - a ceremony that does not run delays adjudication
//    and loses no measurement.
// 2. A ritual class an open ticket already names is never offered again: the
//    packet carries what is NEW, never a standing restatement that becomes
//    the alert nobody reads.
// 3. The ledger proposes and the specifier disposes - a candidate is evidence
//    for a ticket, never an auto-minted one.
//
// All three drive the REAL producer and the REAL ceremony over a REAL store on
// disk. A stub could not exhibit any of them: invariant 1 is a property of
// what survives in the store across skipped ceremonies, invariant 2 of what
// the assembler filters at read time, and invariant 3 of what the ceremony
// does NOT write.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const {
  RITUAL_CLASSES,
  RITUAL_VOLUME_FLOOR,
  RITUAL_DOMINANCE_CEILING,
  determinismCandidatesFromLedger,
} = require('../out/metrics/ritualLedger');
const {
  readPersistedRitualLedger,
  ritualLedgerStorePath,
  runRitualLedgerProducer,
} = require('../out/metrics/ritualLedgerProducer');
const { runClosingCeremony } = require('../out/metrics/closingCeremonyRun');

function withRoot(prefix, fn) {
  const root = mkTmpDir(prefix);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function logBody(entries) {
  return entries.map(({ subject, paths }) => [`COMMIT\t${subject}`, ...paths, ''].join('\n')).join('');
}

/** Commits under `cls` whose subjects all differ - the hand-made shape. */
function handMade(cls, n) {
  return Array.from({ length: n }, (_u, i) => ({
    subject: `hand written ${'w'.repeat(i + 1)}`,
    paths: [`${cls.pathPrefix}item-${i}.md`],
  }));
}

/** Commits under `cls` all sharing one generated subject - the scripted shape. */
function scripted(cls, n) {
  return Array.from({ length: n }, (_u, i) => ({
    subject: 'Close BL-1: move to done. By coordinator.',
    paths: [`${cls.pathPrefix}item-${i}.yaml`],
  }));
}

const classArb = fc.constantFrom(...RITUAL_CLASSES);
// Straddles the volume floor deliberately, so both the offered and the
// too-small cases are generated rather than hoped for.
const volumeArb = fc.integer({ min: 1, max: RITUAL_VOLUME_FLOOR * 2 });

function ceremonyWith(root, openTicketTexts, nowIso) {
  return runClosingCeremony(root, nowIso, {
    sendNote: () => undefined,
    readWindowModels: () => ({}),
    readOpenTicketTexts: () => openTicketTexts,
  });
}

// ── invariant 1 ──────────────────────────────────────────────────────────

test('property (invariant 1): skipped ceremonies lose no measurement', () => {
  // BL-1691: two cells over volume (candidate vs below-floor), each with a
  // ranFlags generator FILTERED to guarantee at least one skip - so every
  // draw in either cell also reaches skippedSome, no third cell needed.
  const VOLUME_CELLS = {
    hadCandidate: () => fc.integer({ min: RITUAL_VOLUME_FLOOR, max: RITUAL_VOLUME_FLOOR * 2 }),
    noCandidate: () => fc.integer({ min: 1, max: RITUAL_VOLUME_FLOOR - 1 }),
  };
  const CELLS = Object.keys(VOLUME_CELLS);
  const PER_CELL_RUNS = runsPerCell(25, CELLS.length);
  const RAN_FLAGS_WITH_SKIP = fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }).filter((arr) => arr.includes(false));
  const seen = { skippedSome: 0, hadCandidate: 0, noCandidate: 0 };

  for (const cell of CELLS) {
    fc.assert(
      fc.property(classArb, VOLUME_CELLS[cell](), RAN_FLAGS_WITH_SKIP, (cls, volume, ranFlags) => {
        const skipped = ranFlags.filter((ran) => !ran).length;
        assert.ok(skipped > 0, 'the ranFlags generator for this cell must guarantee at least one skip');
        seen.skippedSome += 1;

        withRoot('sfvc-bl1365-inv1-', (root) => {
          // The ledger accrues once, on its own cadence.
          runRitualLedgerProducer({
            repoRoot: root,
            nowIso: '2026-09-01T00:00:00.000Z',
            readLogFn: () => logBody(handMade(cls, volume)),
          });
          const stored = readPersistedRitualLedger(path.join(root, '.swarmforge', 'telemetry'));
          const expected = determinismCandidatesFromLedger(stored.ledger, []);
          assert.equal(
            expected.length > 0,
            cell === 'hadCandidate',
            `cell ${cell}'s own volume did not guarantee its own candidate shape (expected.length=${expected.length})`
          );
          seen[cell] += 1;

          // Some windows hold a ceremony, some hold none at all.
          ranFlags.forEach((ran, i) => {
            if (ran) {
              ceremonyWith(root, [], `2026-09-0${i + 2}T18:00:00.000Z`);
            }
          });

          // A LATER ceremony still offers exactly what the store supports.
          const later = ceremonyWith(root, [], '2026-09-20T18:00:00.000Z');
          assert.deepEqual(
            later.run.packet.determinismCandidates.map((c) => c.ritualClass),
            expected.map((c) => c.ritualClass),
            `skipping ${skipped} ceremony/ies changed what the later one could offer`
          );

          // ...and no ceremony ever rewrote the measurement it read.
          const after = readPersistedRitualLedger(path.join(root, '.swarmforge', 'telemetry'));
          assert.deepEqual(after, stored, 'a ceremony mutated the ledger it is only supposed to read');
        });
      }),
      { numRuns: PER_CELL_RUNS }
    );
  }

  assertReachFloor(seen, ['skippedSome', 'hadCandidate', 'noCandidate'], PER_CELL_RUNS, 'invariant-1-shape');
});

// ── invariant 2 ──────────────────────────────────────────────────────────

// The suppressing text is DERIVED from the class under test rather than drawn
// independently, so every generated pair is a suppression candidate by
// construction - drawing both sides freely would almost never collide and the
// property would pass while testing nothing.
const namingTextArb = classArb.chain((cls) =>
  fc.record({
    cls: fc.constant(cls),
    text: fc.constantFrom(
      `ritual_class: ${cls.id}\n`,
      `title: a ticket\nritual_class: ${cls.id}\nstatus: todo\n`,
      `ritual_class: [${cls.id}]\n`,
      `ritual_class: '${cls.id}'\n`
    ),
  })
);

test('property (invariant 2): a class an open ticket names is never offered', () => {
  // BL-1691: volume forced at-or-above the floor - "would have been
  // offered" (barring suppression) is now guaranteed rather than hoped
  // for; a below-floor draw would never offer the class either way and so
  // could never expose the suppression this invariant is actually about.
  const ABOVE_FLOOR_VOLUME_RUNS = runsPerCell(25, 1);
  const seen = { wouldHaveOffered: 0 };
  fc.assert(
    fc.property(namingTextArb, fc.integer({ min: RITUAL_VOLUME_FLOOR, max: RITUAL_VOLUME_FLOOR * 2 }), ({ cls, text }, volume) => {
      withRoot('sfvc-bl1365-inv2-', (root) => {
        runRitualLedgerProducer({
          repoRoot: root,
          nowIso: '2026-09-01T00:00:00.000Z',
          readLogFn: () => logBody(handMade(cls, volume)),
        });
        const stored = readPersistedRitualLedger(path.join(root, '.swarmforge', 'telemetry'));

        // Without the ticket, would this class have been offered at all?
        if (determinismCandidatesFromLedger(stored.ledger, []).some((c) => c.ritualClass === cls.id)) {
          seen.wouldHaveOffered += 1;
        }

        const offered = ceremonyWith(root, [text], '2026-09-20T18:00:00.000Z').run.packet.determinismCandidates;
        assert.ok(
          !offered.some((c) => c.ritualClass === cls.id),
          `${cls.id} is named by an open ticket but was still offered: ${JSON.stringify(offered)}`
        );
      });
    }),
    { numRuns: ABOVE_FLOOR_VOLUME_RUNS }
  );

  // Without this floor the property would pass on runs where the class was
  // below the volume floor anyway and suppression never did any work.
  assertReachFloor(seen, ['wouldHaveOffered'], 1, 'would-have-offered');
});

// ── invariant 3 ──────────────────────────────────────────────────────────

function backlogFileCount(root) {
  const dir = path.join(root, 'backlog');
  let count = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else count += 1;
    }
  };
  walk(dir);
  return count;
}

test('property (invariant 3): a candidate is evidence, never an auto-minted ticket', () => {
  // BL-1691: volume already draws only at-or-above the floor - a single
  // population, reach already guaranteed by that range rather than by
  // luck; runsPerCell(25,1) is the identity wrap the classifier expects.
  const WITH_CANDIDATE_RUNS = runsPerCell(25, 1);
  const seen = { withCandidate: 0 };
  fc.assert(
    fc.property(classArb, fc.integer({ min: RITUAL_VOLUME_FLOOR, max: RITUAL_VOLUME_FLOOR * 2 }), (cls, volume) => {
      withRoot('sfvc-bl1365-inv3-', (root) => {
        fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
        const before = backlogFileCount(root);

        runRitualLedgerProducer({
          repoRoot: root,
          nowIso: '2026-09-01T00:00:00.000Z',
          readLogFn: () => logBody(handMade(cls, volume)),
        });
        const result = ceremonyWith(root, [], '2026-09-20T18:00:00.000Z');
        const candidates = result.run.packet.determinismCandidates;
        if (candidates.length > 0) {
          seen.withCandidate += 1;
          // The specifier still has to judge it: the ceremony delivered the
          // packet and recorded NO outcome of its own.
          assert.equal(result.run.outcome, null, 'the ceremony decided a candidate by itself');
          assert.equal(result.status, 'created');
        }
        assert.equal(backlogFileCount(root), before, 'the ceremony wrote into backlog/ - that is minting');
      });
    }),
    { numRuns: WITH_CANDIDATE_RUNS }
  );

  assertReachFloor(seen, ['withCandidate'], 1, 'with-candidate');
});

// ── the thresholds are the only thing separating the two shapes ──────────

test('property (detector): scripted never offered, hand-made above the floor always is', () => {
  const BY_SCRIPT_CELLS = [true, false];
  const PER_CELL_RUNS = runsPerCell(25, BY_SCRIPT_CELLS.length);
  const seen = { scripted: 0, handMade: 0 };
  for (const byScript of BY_SCRIPT_CELLS) {
    fc.assert(
      fc.property(
        classArb,
        fc.integer({ min: RITUAL_VOLUME_FLOOR, max: RITUAL_VOLUME_FLOOR * 2 }),
        fc.constant(byScript),
        (cls, volume, byScript) => {
          withRoot('sfvc-bl1365-detector-', (root) => {
            const entries = byScript ? scripted(cls, volume) : handMade(cls, volume);
            runRitualLedgerProducer({
              repoRoot: root,
              nowIso: '2026-09-01T00:00:00.000Z',
              readLogFn: () => logBody(entries),
            });
            const stored = readPersistedRitualLedger(path.join(root, '.swarmforge', 'telemetry'));
            const row = stored.ledger.find((r) => r.ritualClass === cls.id);
            const offered = determinismCandidatesFromLedger(stored.ledger, []).some((c) => c.ritualClass === cls.id);
            if (byScript) {
              seen.scripted += 1;
              assert.ok(row.dominance >= RITUAL_DOMINANCE_CEILING, `scripted dominance was ${row.dominance}`);
              assert.equal(offered, false, 'a scripted ritual was offered as hand-made');
            } else {
              seen.handMade += 1;
              assert.ok(row.dominance < RITUAL_DOMINANCE_CEILING, `hand-made dominance was ${row.dominance}`);
              assert.equal(offered, true, 'a hand-made ritual above the floor was not offered');
            }
          });
        }
      ),
      { numRuns: PER_CELL_RUNS }
    );
  }

  assertReachFloor(seen, ['scripted', 'handMade'], PER_CELL_RUNS, 'ritual-origin');
});
