const assert = require('node:assert/strict');
const { parseArgs, labelReportCostTiers } = require('../out/tools/bakeoff-run');

// BL-250 architect bounce (47ee1df386, "roster source has no CLI
// entrypoint"): createFileRosterSource had zero production callers -
// recruiter-run.ts (BL-233's CLI) is hardwired to createFileDiscoverySource,
// which neither attaches costTier nor filters non-chat endpoints, so it
// cannot correctly drive a bake-off catalog even though both implement the
// same DiscoverySource interface. parseArgs/labelReportCostTiers are pulled
// out of main() so they're exercised in-process (same "CLI main() run only
// via execFileSync is coverage-invisible" lesson recruiter-run.ts's own
// hardener split already established for this codebase).

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns all five files when every argument is present', () => {
  const args = parseArgs(['catalog.json', 'keys.json', 'trials.json', 'secrets.json', 'models.json']);

  assert.deepEqual(args, {
    catalogFile: 'catalog.json',
    signupKeysFile: 'keys.json',
    roleTrialsFile: 'trials.json',
    secretsFile: 'secrets.json',
    currentModelsFile: 'models.json',
  });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

for (const [label, index] of [
  ['catalog-file', 0],
  ['signup-keys-file', 1],
  ['role-trials-file', 2],
  ['secrets-file', 3],
  ['current-models-file', 4],
]) {
  test(`parseArgs returns null when only the ${label} is missing`, () => {
    const full = ['catalog.json', 'keys.json', 'trials.json', 'secrets.json', 'models.json'];
    full[index] = undefined;
    assert.equal(parseArgs(full), null);
  });
}

// ── labelReportCostTiers ──────────────────────────────────────────────────

function candidate(model, provider, costTier, amountUsd, unit) {
  return {
    model,
    provider,
    planCost: { amountUsd, unit },
    signupPath: { url: `https://${provider}.example`, automation: 'automatable' },
    costTier,
  };
}

test('attaches each ranked entry\'s cost tier by looking it up from the roster candidates', () => {
  const report = {
    roles: [
      {
        role: 'coder',
        leaderboard: {
          role: 'coder',
          reference: { model: 'incumbent-model' },
          ranked: [{ model: 'claude-fable-5', capability: 3, planCost: { amountUsd: 0, unit: 'free' } }],
          recommended: 'claude-fable-5',
        },
        suggestion: { role: 'coder', suggestedModel: 'claude-fable-5', swarmforgeConfLine: '--model claude-fable-5' },
      },
    ],
    escalated: [],
  };
  const candidates = [candidate('claude-fable-5', 'anthropic', 'free/eval-tier', 0, 'free')];

  const labeled = labelReportCostTiers(report, candidates);

  assert.equal(labeled.roles[0].leaderboard.ranked[0].costTier, 'free/eval-tier');
});

test('attaches cost tier to escalated (untested) candidates too - every candidate is labeled, not just ranked ones', () => {
  const report = { roles: [], escalated: [{ model: 'gpt-5-paid', wall: 'payment-wall' }] };
  const candidates = [candidate('gpt-5-paid', 'openai', 'paid-only', 20, 'monthly')];

  const labeled = labelReportCostTiers(report, candidates);

  assert.equal(labeled.escalated[0].costTier, 'paid-only');
  assert.equal(labeled.escalated[0].wall, 'payment-wall', 'the original escalation reason must be preserved');
});

test('a ranked model with no matching roster candidate gets a null cost tier, not a crash', () => {
  const report = {
    roles: [
      {
        role: 'coder',
        leaderboard: { role: 'coder', reference: { model: 'x' }, ranked: [{ model: 'unknown-model', capability: 1, planCost: { amountUsd: 0, unit: 'free' } }], recommended: 'unknown-model' },
        suggestion: null,
      },
    ],
    escalated: [],
  };

  const labeled = labelReportCostTiers(report, []);

  assert.equal(labeled.roles[0].leaderboard.ranked[0].costTier, null);
});

test('does not mutate the original report object', () => {
  const report = { roles: [], escalated: [{ model: 'gpt-5-paid', wall: 'payment-wall' }] };
  const candidates = [candidate('gpt-5-paid', 'openai', 'paid-only', 20, 'monthly')];

  labelReportCostTiers(report, candidates);

  assert.equal(report.escalated[0].costTier, undefined, 'the original report must be left untouched');
});
