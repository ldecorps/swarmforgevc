const assert = require('node:assert/strict');
const { rankForRole } = require('../out/recruiter/rank');

// BL-233 slice 4 (best-value-ranking-05). rankForRole is a pure function
// over already-produced scorecards (slice 3's own output) - no battery/IO
// here, matching the ticket's "REUSE, don't reimplement" scope.

function scoredCandidate(model, { compliant = true, passCount = 2, totalCount = 2, amountUsd = 0, unit = 'free' } = {}) {
  const entries = [];
  for (let i = 0; i < totalCount; i++) {
    entries.push({ competency: `gate-${i}`, status: i < passCount ? 'pass' : 'fail' });
  }
  return {
    candidate: {
      model,
      provider: 'acme-ai',
      planCost: { amountUsd, unit },
      signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
    },
    scorecard: { model, entries, overall: compliant ? 'swarm-compliant' : 'non-compliant' },
  };
}

test('only battery-compliant candidates are ranked', () => {
  const candidates = [scoredCandidate('compliant-model', { compliant: true }), scoredCandidate('non-compliant-model', { compliant: false })];

  const leaderboard = rankForRole('coder', candidates, 'reference-model');

  assert.deepEqual(leaderboard.ranked.map((e) => e.model), ['compliant-model']);
});

test('candidates are ordered by capability (battery pass count) descending', () => {
  const candidates = [
    scoredCandidate('low-capability', { passCount: 1, totalCount: 3 }),
    scoredCandidate('high-capability', { passCount: 3, totalCount: 3 }),
  ];

  const leaderboard = rankForRole('coder', candidates, 'reference-model');

  assert.deepEqual(leaderboard.ranked.map((e) => e.model), ['high-capability', 'low-capability']);
});

test('equal capability breaks ties on the cheapest plan cost', () => {
  const candidates = [scoredCandidate('pricier', { amountUsd: 10, unit: 'monthly' }), scoredCandidate('cheaper', { amountUsd: 5, unit: 'monthly' })];

  const leaderboard = rankForRole('coder', candidates, 'reference-model');

  assert.deepEqual(leaderboard.ranked.map((e) => e.model), ['cheaper', 'pricier']);
});

test('pure capability is visible on each ranked entry, not just the ordering', () => {
  const candidates = [scoredCandidate('candidate-a', { passCount: 2, totalCount: 3 })];

  const leaderboard = rankForRole('coder', candidates, 'reference-model');

  assert.equal(leaderboard.ranked[0].capability, 2);
});

test('the current model appears as the reference baseline', () => {
  const leaderboard = rankForRole('coder', [scoredCandidate('candidate-a')], 'incumbent-model');

  assert.deepEqual(leaderboard.reference, { model: 'incumbent-model' });
});

test('the top-ranked candidate is the recommended pick', () => {
  const candidates = [
    scoredCandidate('runner-up', { passCount: 1, totalCount: 3 }),
    scoredCandidate('winner', { passCount: 3, totalCount: 3 }),
  ];

  const leaderboard = rankForRole('coder', candidates, 'reference-model');

  assert.equal(leaderboard.recommended, 'winner');
});

test('no compliant candidates yields an empty leaderboard and no recommendation, not a crash', () => {
  const leaderboard = rankForRole('coder', [scoredCandidate('bad', { compliant: false })], 'reference-model');

  assert.deepEqual(leaderboard.ranked, []);
  assert.equal(leaderboard.recommended, null);
});

test('the role name is carried on the returned leaderboard', () => {
  const leaderboard = rankForRole('architect', [scoredCandidate('candidate-a')], 'reference-model');

  assert.equal(leaderboard.role, 'architect');
});
