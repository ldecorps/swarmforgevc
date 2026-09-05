'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  assessRelandNotes,
  hadPriorLandWithoutReceipt,
  acceptanceExecutedForFeature,
  ACCEPTANCE_NOT_EXECUTED_REFUSAL,
} = require('../out/tools/pilotAcceptanceExecution');

test('BL-735: acceptanceExecutedForFeature requires an exact feature path match', () => {
  assert.equal(acceptanceExecutedForFeature('/repo/specs/a.feature', '/repo/specs/a.feature'), true);
  assert.equal(acceptanceExecutedForFeature(undefined, '/repo/specs/a.feature'), false);
  assert.equal(acceptanceExecutedForFeature('/repo/specs/b.feature', '/repo/specs/a.feature'), false);
});

test('BL-735: hadPriorLandWithoutReceipt is true only when notes record a receiptless prior land', () => {
  const notes = 'Previously landed to backlog/done without an acceptance receipt; reverted.';
  assert.equal(hadPriorLandWithoutReceipt(notes, false), true);
  assert.equal(hadPriorLandWithoutReceipt(notes, true), false);
  assert.equal(hadPriorLandWithoutReceipt('ordinary notes', false), false);
});

test('property: revert-reland tickets with explanatory notes satisfy assessRelandNotes', () => {
  const goodNotes = fc.constantFrom(
    'First landing reverted because acceptance never ran. Re-land is warranted because BL-727 gate now executes acceptance.',
    'Reverted from done after a bad land; second land warranted because acceptance now runs.'
  );
  fc.assert(
    fc.property(goodNotes, (notes) => {
      assert.equal(assessRelandNotes(notes).satisfied, true);
    }),
    { numRuns: 20 }
  );
});

test('property: revert-reland tickets without why/warrant notes fail assessRelandNotes', () => {
  const badNotes = fc.constantFrom('Re-land after revert.', 'Reverted. Re-land soon.');
  fc.assert(
    fc.property(badNotes, (notes) => {
      assert.equal(assessRelandNotes(notes).satisfied, false);
    }),
    { numRuns: 20 }
  );
});

test('non-vacuity: broken acceptanceExecutedForFeature would let declaration-only lands through', () => {
  const broken = true;
  const shouldLand = acceptanceExecutedForFeature(undefined, '/repo/specs/a.feature');
  assert.notEqual(broken, shouldLand);
  assert.match(ACCEPTANCE_NOT_EXECUTED_REFUSAL, /not executed/);
});
