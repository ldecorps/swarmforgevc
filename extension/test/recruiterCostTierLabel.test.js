const assert = require('node:assert/strict');
const { labelCostTier } = require('../out/recruiter/costTierLabel');

// BL-250 cost-tier-labeled-03: the bake-off's report labels each
// candidate paid-only or free/eval-tier with its plan cost - a pure,
// additive function reused wherever the report assembles a candidate row,
// never modifying rank.ts/recommend.ts (both stay BL-233-unchanged).

function candidate(overrides = {}) {
  return {
    model: 'claude-fable-5',
    provider: 'anthropic',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://console.anthropic.com', automation: 'automatable' },
    costTier: 'free/eval-tier',
    ...overrides,
  };
}

for (const tier of ['paid-only', 'free/eval-tier']) {
  test(`labels a "${tier}" candidate with its cost tier and plan cost`, () => {
    const label = labelCostTier(candidate({ costTier: tier, planCost: { amountUsd: tier === 'paid-only' ? 20 : 0, unit: tier === 'paid-only' ? 'monthly' : 'free' } }));

    assert.equal(label.model, 'claude-fable-5');
    assert.equal(label.costTier, tier);
    assert.deepEqual(label.planCost, { amountUsd: tier === 'paid-only' ? 20 : 0, unit: tier === 'paid-only' ? 'monthly' : 'free' });
  });
}

test('throws a clear error for a candidate with no cost tier set (a roster-source bug, not silently mislabeled)', () => {
  const untagged = candidate();
  delete untagged.costTier;

  assert.throws(() => labelCostTier(untagged), /no cost tier/i);
});
