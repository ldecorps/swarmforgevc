import * as assert from 'assert';
import { evaluateClaimLiveness, ClaimRecord, ClaimLivenessConfig } from '../../src/metrics/claimLiveness';

describe('claimLiveness', () => {
  const config: ClaimLivenessConfig = {
    idleReclaimThreshold: 1,
    nudgeThreshold: 2,
    reassignThreshold: 3,
    haltThreshold: 4,
  };

  it('returns ok when there is progress', () => {
    const record: ClaimRecord = {
      role: 'coder',
      task: 'BL-528',
      claimCount: 5,
      lastClaimMs: Date.now(),
      hasProgress: true,
    };
    assert.strictEqual(evaluateClaimLiveness(record, config), 'ok');
  });

  it('returns ok when claimCount is below nudgeThreshold', () => {
    const record: ClaimRecord = {
      role: 'coder',
      task: 'BL-528',
      claimCount: 1,
      lastClaimMs: Date.now(),
      hasProgress: false,
    };
    assert.strictEqual(evaluateClaimLiveness(record, config), 'ok');
  });

  it('returns nudge when claimCount reaches nudgeThreshold', () => {
    const record: ClaimRecord = {
      role: 'coder',
      task: 'BL-528',
      claimCount: 2,
      lastClaimMs: Date.now(),
      hasProgress: false,
    };
    assert.strictEqual(evaluateClaimLiveness(record, config), 'nudge');
  });

  it('returns reassign when claimCount reaches reassignThreshold', () => {
    const record: ClaimRecord = {
      role: 'coder',
      task: 'BL-528',
      claimCount: 3,
      lastClaimMs: Date.now(),
      hasProgress: false,
    };
    assert.strictEqual(evaluateClaimLiveness(record, config), 'reassign');
  });

  it('returns halt when claimCount reaches haltThreshold', () => {
    const record: ClaimRecord = {
      role: 'coder',
      task: 'BL-528',
      claimCount: 4,
      lastClaimMs: Date.now(),
      hasProgress: false,
    };
    assert.strictEqual(evaluateClaimLiveness(record, config), 'halt');
  });
});
