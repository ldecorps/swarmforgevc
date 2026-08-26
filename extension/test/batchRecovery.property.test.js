const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  planCleanSiblingReforward,
  planDefectiveRework,
  recoveryBranchExcludesContaminatedTip,
  validateWholeTreeLand,
} = require('../out/quality/batchRecovery');

// BL-588 invariant: a ticket verified clean is never blocked from landing by
// a sibling ticket's rework — the clean sibling's re-forward commit stays
// unchanged and landing refuses history-rewriting operations.

const commitArb = fc.stringMatching(/^[0-9a-f]{10}$/);
const ticketArb = fc.integer({ min: 1, max: 50 }).map((n) => `BL-${9000 + n}`);

test('property: unchanged re-forward always preserves the batch commit for the clean sibling', () => {
  fc.assert(
    fc.property(commitArb, ticketArb, ticketArb, (batchCommit, clean, defective) => {
      fc.pre(clean !== defective);
      const plan = planCleanSiblingReforward({
        ticket: clean,
        batchCommit,
        deferralCommit: batchCommit,
        defectiveTicket: defective,
      });
      assert.equal(plan.forwardCommit, batchCommit);
      assert.equal(plan.recoveryTicket, defective);
    })
  );
});

test('property: defective rework always excludes the contaminated batch tip as branch base', () => {
  fc.assert(
    fc.property(commitArb, commitArb, ticketArb, (batchCommit, ancestor, ticket) => {
      fc.pre(batchCommit !== ancestor);
      const plan = planDefectiveRework({ ticket, batchCommit, lastCleanAncestor: ancestor });
      assert.equal(recoveryBranchExcludesContaminatedTip(plan), true);
    })
  );
});

test('property: history-rewriting landing operations are always refused', () => {
  fc.assert(
    fc.property(commitArb, (verifiedCommit) => {
      for (const op of ['cherry-pick', 'rebase-to-land', 'partial-subset cherry-pick']) {
        const result = validateWholeTreeLand({ landingOperation: op, verifiedCommit });
        assert.equal(result.refused, true);
      }
    })
  );
});
