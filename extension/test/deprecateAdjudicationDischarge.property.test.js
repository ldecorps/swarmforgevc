'use strict';

// BL-1267's two declared invariants.
//
// Invariant 1: "A recorded adjudication clears the gate only for the exact
// ticket content it was made against: amend the ticket after adjudicating and
// the check holds again." The failure this guards is a discharge that outlives
// the content it was made against, so the generator must reach BOTH sides of
// that boundary - matching and mismatched fingerprints - and the mismatched
// side must be CONSTRUCTED rather than hoped for. Drawing two independent
// ticket texts and hoping they collide is the collision-generator mistake in
// reverse: here the interesting state is the MATCH, which a naive generator
// reaches essentially never. So the fingerprint is derived from the ticket by
// the same transformation the code uses, and the mismatch is made by amending
// the ticket afterwards - every drawn pair is a real before/after pair.
//
// Invariant 2: "No discharge is ambient or anonymous: every allow that came
// from an adjudication names the durable record it came from, and no
// environment variable, flag, or caller argument can produce one without that
// record." Encoded two ways: every discharged allow carries its record's path,
// and the decision is invariant under arbitrary environment variables -
// including the plausible bypass names a future implementer might reach for.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  computeTicketFingerprint,
  applyAdjudication,
  evaluateDeprecatorFreshness,
} = require('../out/tools/deprecate-check');

const OUTCOMES = ['confirm_promote', 'amend', 'retire', 'split'];
const RECORD_PATH = '/fixture/.swarmforge/deprecator/adjudications/BL-77.json';

const ticketTextArb = fc
  .record({
    id: fc.integer({ min: 1, max: 9999 }),
    body: fc.string({ minLength: 0, maxLength: 40 }),
    claim: fc.constantFrom('superseded', 'retired', 'obsolete'),
  })
  .map(({ id, body, claim }) => `id: BL-${id}\nstatus: ${claim}\ndescription: ${JSON.stringify(body)}\n`);

const amendmentArb = fc.constantFrom('\n', '# note\n', ' ', '\nnotes: |\n  amended\n');

function heldFacts(yamlText, adjudication) {
  return {
    ticketId: 'BL-77',
    yamlText,
    pausedPathExists: true,
    dependsOnIds: [],
    dependsOnAllDone: false,
    doneClosureExists: false,
    retiredSurfaceHits: [],
    specGapBounceCount: 0,
    adjudication,
  };
}

function presentRecord(fingerprint, outcome = 'confirm_promote') {
  return {
    status: 'present',
    path: RECORD_PATH,
    record: {
      ticket: 'BL-77',
      outcome,
      adjudicated_by: 'specifier',
      adjudicated_at: '2026-08-29T12:00:00.000Z',
      content_fingerprint: fingerprint,
    },
  };
}

const HELD = { decision: 'hold', reason: 'stale premise: the original reason' };

test('property: a discharge clears the content it was made against, and nothing else', () => {
  let sawMatch = 0;
  let sawAmended = 0;
  fc.assert(
    fc.property(ticketTextArb, amendmentArb, fc.boolean(), (yamlText, amendment, amend) => {
      // Constructed, not hoped for: the fingerprint is always the one the
      // adjudication was really made against.
      const record = presentRecord(computeTicketFingerprint(yamlText));
      if (!amend) {
        sawMatch += 1;
        const decision = applyAdjudication(HELD, heldFacts(yamlText, record));
        assert.equal(decision.decision, 'allow');
        return;
      }
      sawAmended += 1;
      const decision = applyAdjudication(HELD, heldFacts(yamlText + amendment, record));
      assert.equal(decision.decision, 'hold', `an amended ticket rode a stale clearance:\n${yamlText}`);
      assert.match(decision.reason, /no longer matches the ticket content/);
    }),
    { numRuns: 300 }
  );
  // Reachability floor: both sides of the boundary must actually be drawn.
  assert.ok(sawMatch > 50, `expected unamended tickets to be drawn, saw ${sawMatch}`);
  assert.ok(sawAmended > 50, `expected amended tickets to be drawn, saw ${sawAmended}`);
});

test('property: only confirm_promote discharges, whatever the content', () => {
  let sawDischarging = 0;
  let sawOther = 0;
  fc.assert(
    fc.property(ticketTextArb, fc.constantFrom(...OUTCOMES), (yamlText, outcome) => {
      const record = presentRecord(computeTicketFingerprint(yamlText), outcome);
      const decision = applyAdjudication(HELD, heldFacts(yamlText, record));
      if (outcome === 'confirm_promote') {
        sawDischarging += 1;
        assert.equal(decision.decision, 'allow');
        return;
      }
      sawOther += 1;
      assert.equal(decision.decision, 'hold', `${outcome} discharged a hold`);
      // A non-discharging outcome must not repaint the original reason either.
      assert.equal(decision.reason, HELD.reason);
    }),
    { numRuns: 240 }
  );
  assert.ok(sawDischarging > 30, `expected confirm_promote draws, saw ${sawDischarging}`);
  assert.ok(sawOther > 90, `expected non-discharging draws, saw ${sawOther}`);
});

test('property: every discharge names its record, and an unusable one never allows', () => {
  let sawPresent = 0;
  let sawUnusable = 0;
  fc.assert(
    fc.property(
      ticketTextArb,
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.boolean(),
      (yamlText, problem, usable) => {
        if (usable) {
          sawPresent += 1;
          const decision = applyAdjudication(HELD, heldFacts(yamlText, presentRecord(computeTicketFingerprint(yamlText))));
          assert.equal(decision.decision, 'allow');
          assert.ok(decision.reason && decision.reason.includes(RECORD_PATH), 'an anonymous allow');
          assert.ok(decision.reason.includes('specifier'), 'the allow does not name who adjudicated');
          return;
        }
        sawUnusable += 1;
        const decision = applyAdjudication(
          HELD,
          heldFacts(yamlText, { status: 'unusable', path: RECORD_PATH, problem })
        );
        assert.equal(decision.decision, 'hold');
        assert.match(decision.reason, /unusable adjudication record/);
      }
    ),
    { numRuns: 200 }
  );
  assert.ok(sawPresent > 40, `expected usable records, saw ${sawPresent}`);
  assert.ok(sawUnusable > 40, `expected unusable records, saw ${sawUnusable}`);
});

test('property: no environment variable can produce an allow', () => {
  // The bypass names a future implementer might plausibly reach for, plus
  // arbitrary ones. BL-1248: a control that silences the alarm along with the
  // action is the defect, so the decision must not read the environment at all.
  const BYPASS_NAMES = [
    'DEPRECATE_CHECK_SKIP',
    'SWARMFORGE_SKIP_DEPRECATE_CHECK',
    'DEPRECATOR_FRESHNESS_FORCE_RESULT',
    'SWARMFORGE_FRESHNESS_ALLOW',
    'FORCE_PROMOTE',
  ];
  let sawSet = 0;
  fc.assert(
    fc.property(
      ticketTextArb,
      fc.constantFrom(...BYPASS_NAMES),
      fc.constantFrom('1', 'true', 'allow', 'yes'),
      (yamlText, name, value) => {
        const before = evaluateDeprecatorFreshness(heldFacts(yamlText, { status: 'absent' }));
        const had = Object.prototype.hasOwnProperty.call(process.env, name);
        const previous = process.env[name];
        process.env[name] = value;
        try {
          sawSet += 1;
          const after = evaluateDeprecatorFreshness(heldFacts(yamlText, { status: 'absent' }));
          assert.deepEqual(after, before, `${name}=${value} changed the decision`);
          assert.equal(after.decision, 'hold');
        } finally {
          if (had) {
            process.env[name] = previous;
          } else {
            delete process.env[name];
          }
        }
      }
    ),
    { numRuns: 150 }
  );
  assert.ok(sawSet > 100, `expected environment variables to be set during the run, saw ${sawSet}`);
});
