const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  readBounceRecords,
  readRawBounceRecords,
  appendBounceRecordIfNew,
  appendBounceCorrectionIfNew,
  bouncesDir,
} = require('../out/metrics/bounceStore');
const { recordsFromQaBounceJsonl } = require('../out/metrics/failureModeInventory');

// BL-990 declared invariants (coder-authored first, BL-654):
//
//   1. "A bounce record's attribution can be corrected after the fact, and
//      every consumer of the store reports the corrected attribution rather
//      than the original."
//   2. "The store stays append-only: a correction is a new record that
//      supersedes an earlier one, never an edit or deletion of it."
//
// Generator reach is CONSTRUCTED. Corrections are not drawn independently of
// the bounces - a correction generated at random would essentially never
// name a bounce that exists, and the property would pass hundreds of runs
// having tested nothing. Each correction is DERIVED from a bounce actually
// in the store, and a deliberate fraction targets bounces that are NOT
// (so the inert case is reached too). Both categories' counts are asserted
// as floors at the end.
//
// Invariant 1 is checked across BOTH JSONL read paths, because they are
// genuinely separate implementations: bounceStore's readBounceRecords and
// failureModeInventory's own parse. A property that only checked one would
// pass against exactly the bug the ticket describes.

const ROLES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter'];
const CLASSES = ['acceptance', 'unit', 'compile', 'behavior'];

const arbBounce = fc.record({
  ticketNum: fc.integer({ min: 1, max: 40 }),
  producingRole: fc.constantFrom(...ROLES),
  failureClass: fc.constantFrom(...CLASSES),
  commitNum: fc.integer({ min: 1, max: 40 }),
  day: fc.integer({ min: 10, max: 28 }),
});

const arbCase = fc.record({
  bounces: fc.array(arbBounce, { minLength: 1, maxLength: 6 }),
  // Which of the store's own bounces get corrected, by index; plus a flag
  // per correction deciding whether to aim it at a real bounce or a
  // guaranteed-absent one.
  corrections: fc.array(fc.record({ pick: fc.nat(), real: fc.boolean() }), { minLength: 0, maxLength: 4 }),
});

function materialise(spec) {
  return {
    ticket: `BL-${100 + spec.ticketNum}`,
    producingRole: spec.producingRole,
    ticketType: 'defect',
    failureClass: spec.failureClass,
    commit: `c${String(spec.commitNum).padStart(9, '0')}`,
    by: 'QA',
    at: `2026-08-${spec.day}T12:00:00.000Z`,
  };
}

const monthFileOf = (root) => path.join(bouncesDir(root), '2026-08.jsonl');
const linesOf = (root) => {
  try {
    return fs.readFileSync(monthFileOf(root), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

test('property (BL-990 invariants 1 and 2): a correction withdraws exactly its target from every reader, and never edits a line', () => {
  const reached = { realTarget: 0, absentTarget: 0, noCorrections: 0 };

  fc.assert(
    fc.property(arbCase, (spec) => {
      const root = mkTmpDir('bl990-prop-');
      const written = [];
      for (const b of spec.bounces.map(materialise)) {
        if (appendBounceRecordIfNew(root, b)) {
          written.push(b);
        }
      }
      const linesBefore = linesOf(root);
      assert.equal(linesBefore.length, written.length);

      if (spec.corrections.length === 0) {
        reached.noCorrections += 1;
      }
      const targets = [];
      for (const c of spec.corrections) {
        const target = c.real
          ? written[c.pick % written.length]
          : { ticket: 'BL-ABSENT', commit: 'zzzzzzzzzz' };
        reached[c.real ? 'realTarget' : 'absentTarget'] += 1;
        targets.push(target);
        appendBounceCorrectionIfNew(root, {
          kind: 'bounce-correction',
          ticket: target.ticket,
          commit: target.commit,
          at: '2026-08-28T18:00:00.000Z',
          by: 'QA',
          reason: 'generated correction',
        });
      }

      // ── Invariant 2: append-only ──────────────────────────────────────
      const linesAfter = linesOf(root);
      assert.deepEqual(
        linesAfter.slice(0, linesBefore.length),
        linesBefore,
        'every original line survives byte-for-byte, in its original position'
      );
      assert.ok(linesAfter.length >= linesBefore.length, 'the store never shrinks');
      assert.deepEqual(readRawBounceRecords(root), written, 'the raw history still holds every bounce ever recorded');

      // ── Invariant 1: every reader reports the corrected attribution ────
      const correctedKeys = new Set(targets.map((t) => `${t.ticket}|${t.commit}`));
      const expected = written.filter((b) => !correctedKeys.has(`${b.ticket}|${b.commit}`));

      assert.deepEqual(readBounceRecords(root), expected, 'readBounceRecords withdraws exactly the corrected bounces');

      const inventory = recordsFromQaBounceJsonl(fs.readFileSync(monthFileOf(root), 'utf8'));
      assert.deepEqual(
        inventory.map((r) => r.signature).sort(),
        expected.map((b) => `qa_bounce:${b.failureClass}:${b.producingRole}`).sort(),
        'failureModeInventory - a separate parse - agrees exactly with readBounceRecords'
      );
    }),
    { numRuns: 250 }
  );

  assert.ok(reached.realTarget >= 60, `reachability floor: corrections aimed at a REAL bounce only ${reached.realTarget}`);
  assert.ok(reached.absentTarget >= 60, `reachability floor: corrections aimed at an absent bounce only ${reached.absentTarget}`);
  assert.ok(reached.noCorrections >= 20, `reachability floor: the no-correction case only ${reached.noCorrections}`);
});
