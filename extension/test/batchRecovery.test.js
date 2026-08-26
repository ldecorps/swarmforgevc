const test = require('node:test');
const assert = require('node:assert/strict');
const {
  refuseNonWholeTreeLanding,
  planCleanSiblingReforward,
  planDefectiveRework,
  recoveryBranchExcludesContaminatedTip,
  validateWholeTreeLand,
  validateMergeUpBroadcast,
  validateCleanSiblingLandIsolation,
} = require('../out/quality/batchRecovery');

const BATCH = 'batch1234567';
const ANCESTOR = 'clean0000001';
const VERIFIED = 'verify123456';

test('refuseNonWholeTreeLanding allows merge only', () => {
  assert.deepEqual(refuseNonWholeTreeLanding('merge'), { refused: false });
});

test('refuseNonWholeTreeLanding refuses history-rewriting landing operations', () => {
  for (const op of ['cherry-pick', 'rebase-to-land', 'partial-subset cherry-pick']) {
    const result = refuseNonWholeTreeLanding(op);
    assert.equal(result.refused, true);
    assert.match(result.reason, /verified whole tree/i);
  }
});

test('planCleanSiblingReforward preserves the deferral commit unchanged', () => {
  const plan = planCleanSiblingReforward({
    ticket: 'BL-B',
    batchCommit: BATCH,
    deferralCommit: BATCH,
    defectiveTicket: 'BL-A',
  });
  assert.equal(plan.forwardCommit, BATCH);
  assert.equal(plan.recoveryTicket, 'BL-A');
});

test('planCleanSiblingReforward rejects a deferral commit that drifted from the batch', () => {
  assert.throws(
    () =>
      planCleanSiblingReforward({
        ticket: 'BL-B',
        batchCommit: BATCH,
        deferralCommit: 'other000001',
        defectiveTicket: 'BL-A',
      }),
    /unchanged re-forward/
  );
});

test('planDefectiveRework cuts from the last clean ancestor not the contaminated tip', () => {
  const plan = planDefectiveRework({ ticket: 'BL-A', batchCommit: BATCH, lastCleanAncestor: ANCESTOR });
  assert.equal(plan.branchBase, ANCESTOR);
  assert.equal(plan.contaminatedBatchTip, BATCH);
  assert.equal(recoveryBranchExcludesContaminatedTip(plan), true);
});

test('validateWholeTreeLand refuses cherry-pick even when a verified commit is named', () => {
  const result = validateWholeTreeLand({ landingOperation: 'cherry-pick', verifiedCommit: VERIFIED });
  assert.equal(result.refused, true);
});

test('validateMergeUpBroadcast requires the named commit to ancestor the land commit', () => {
  const bad = validateMergeUpBroadcast({
    ticket: 'BL-B',
    verifiedCommit: VERIFIED,
    landedCommit: 'land00000001',
    isAncestor: () => false,
  });
  assert.equal(bad.ok, false);

  const good = validateMergeUpBroadcast({
    ticket: 'BL-B',
    verifiedCommit: VERIFIED,
    landedCommit: 'land00000001',
    isAncestor: (desc, anc) => desc === 'land00000001' && anc === VERIFIED,
  });
  assert.equal(good.ok, true);
  assert.equal(good.namedCommit, VERIFIED);
});

test('validateCleanSiblingLandIsolation rejects merging the defective recovery tip with the clean landing', () => {
  const result = validateCleanSiblingLandIsolation({
    landedTicket: 'BL-B',
    landedCommit: VERIFIED,
    defectiveRecoveryTip: 'rework000001',
    mergeIncludesCommit: (c) => c === VERIFIED || c === 'rework000001',
  });
  assert.equal(result.ok, false);
});

test('validateCleanSiblingLandIsolation requires the verified commit in the landing merge', () => {
  const result = validateCleanSiblingLandIsolation({
    landedTicket: 'BL-B',
    landedCommit: VERIFIED,
    defectiveRecoveryTip: 'rework000001',
    mergeIncludesCommit: () => false,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /verified whole tree/i);
});

test('validateWholeTreeLand refuses merge when no verified commit is named', () => {
  const result = validateWholeTreeLand({ landingOperation: 'merge', verifiedCommit: '' });
  assert.equal(result.refused, true);
});

test('validateMergeUpBroadcast refuses when verified commit is absent', () => {
  const result = validateMergeUpBroadcast({
    ticket: 'BL-B',
    verifiedCommit: '',
    landedCommit: 'land00000001',
    isAncestor: () => true,
  });
  assert.equal(result.ok, false);
});

test('planDefectiveRework rejects when the ancestor equals the contaminated tip', () => {
  assert.throws(
    () => planDefectiveRework({ ticket: 'BL-A', batchCommit: BATCH, lastCleanAncestor: BATCH }),
    /precede the contaminated batch tip/
  );
});

test('refuseNonWholeTreeLanding refuses unsupported landing operations', () => {
  const result = refuseNonWholeTreeLanding('squash-merge');
  assert.equal(result.refused, true);
  assert.match(result.reason, /unsupported landing operation/i);
});
