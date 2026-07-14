'use strict';

// BL-233 slice 4: step handlers for the recruiter's best-value-ranking-05
// and recommend-not-adopt-06 scenarios. rankForRole/suggestConfChange are
// both pure functions over already-produced data (slice 3's scorecards) -
// no injectable seam needed here, unlike acquire/qualify's provider-facing
// slices. The shared Background step is already registered by
// recruiterDiscoverSteps.js (first-match registry) - not re-registered here.
const path = require('node:path');
const fs = require('node:fs');

const { rankForRole } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'recruiter', 'rank'));
const { suggestConfChange } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'recruiter', 'recommend')
);

const SWARMFORGE_CONF = path.join(__dirname, '..', '..', '..', 'swarmforge', 'swarmforge.conf');

function scoredCandidate(model, { compliant, passCount, totalCount, amountUsd, unit }) {
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

function registerSteps(registry) {
  // ── best-value-ranking-05 ────────────────────────────────────────────
  registry.define(/^several candidates scored by the battery for a role$/, (ctx) => {
    ctx.role = 'coder';
    ctx.currentModel = 'incumbent-model';
    ctx.scoredCandidates = [
      // Non-compliant - must be excluded from the ranking entirely.
      scoredCandidate('non-compliant-model', { compliant: false, passCount: 1, totalCount: 3, amountUsd: 0, unit: 'free' }),
      // Highest capability - wins outright regardless of cost.
      scoredCandidate('high-capability-model', { compliant: true, passCount: 3, totalCount: 3, amountUsd: 10, unit: 'monthly' }),
      // Equal (lower) capability, but cheaper - proves the tiebreak.
      scoredCandidate('cheaper-model', { compliant: true, passCount: 2, totalCount: 3, amountUsd: 0, unit: 'free' }),
      scoredCandidate('pricier-model', { compliant: true, passCount: 2, totalCount: 3, amountUsd: 5, unit: 'monthly' }),
    ];
  });

  registry.define(/^the recruiter ranks them for that role$/, (ctx) => {
    ctx.leaderboard = rankForRole(ctx.role, ctx.scoredCandidates, ctx.currentModel);
  });

  registry.define(/^only battery-compliant candidates are ranked$/, (ctx) => {
    if (ctx.leaderboard.ranked.some((entry) => entry.model === 'non-compliant-model')) {
      throw new Error(`expected the non-compliant candidate to be excluded, got: ${JSON.stringify(ctx.leaderboard.ranked)}`);
    }
    if (ctx.leaderboard.ranked.length !== 3) {
      throw new Error(`expected exactly the 3 compliant candidates to be ranked, got: ${JSON.stringify(ctx.leaderboard.ranked)}`);
    }
  });

  registry.define(
    /^they are ordered by capability weighted against plan cost, cheapest breaking ties$/,
    (ctx) => {
      const order = ctx.leaderboard.ranked.map((entry) => entry.model);
      const expected = ['high-capability-model', 'cheaper-model', 'pricier-model'];
      if (JSON.stringify(order) !== JSON.stringify(expected)) {
        throw new Error(`expected ranking order ${JSON.stringify(expected)} (highest capability first, cheapest breaking ties), got: ${JSON.stringify(order)}`);
      }
    }
  );

  registry.define(/^the current model for that role appears as the reference baseline$/, (ctx) => {
    if (ctx.leaderboard.reference.model !== ctx.currentModel) {
      throw new Error(`expected the reference baseline to be "${ctx.currentModel}", got: ${JSON.stringify(ctx.leaderboard.reference)}`);
    }
  });

  registry.define(/^a best-value model is recommended for that role$/, (ctx) => {
    if (ctx.leaderboard.recommended !== 'high-capability-model') {
      throw new Error(`expected the recommended pick to be "high-capability-model", got: ${ctx.leaderboard.recommended}`);
    }
  });

  // ── recommend-not-adopt-06 ───────────────────────────────────────────
  registry.define(/^a best-value recommendation for a role$/, (ctx) => {
    ctx.leaderboard = {
      role: 'coder',
      reference: { model: 'incumbent-model' },
      ranked: [{ model: 'winner-model', capability: 3, planCost: { amountUsd: 0, unit: 'free' } }],
      recommended: 'winner-model',
    };
    ctx.swarmforgeConfBefore = fs.readFileSync(SWARMFORGE_CONF, 'utf8');
  });

  registry.define(/^the recruiter emits its report$/, (ctx) => {
    ctx.suggestion = suggestConfChange(ctx.leaderboard);
  });

  registry.define(/^the report includes a suggested swarmforge\.conf --model change for that role$/, (ctx) => {
    if (!ctx.suggestion || ctx.suggestion.role !== 'coder' || !/--model winner-model/.test(ctx.suggestion.swarmforgeConfLine)) {
      throw new Error(`expected a suggested --model line naming "winner-model" for role "coder", got: ${JSON.stringify(ctx.suggestion)}`);
    }
  });

  registry.define(/^the recruiter does not modify swarmforge\.conf or bounce the swarm$/, (ctx) => {
    const after = fs.readFileSync(SWARMFORGE_CONF, 'utf8');
    if (after !== ctx.swarmforgeConfBefore) {
      throw new Error('expected swarmforge.conf to be byte-for-byte unchanged after emitting the report');
    }
  });
}

module.exports = { registerSteps };
