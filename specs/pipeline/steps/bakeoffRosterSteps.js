'use strict';

// BL-250: step handlers for roster-enumerates-01. Drives the REAL
// createFileRosterSource - no hand-simulated logic. cost-tier-labeled-03
// (which shares this file's Background) has its own "the bake-off
// enumerates..."-adjacent Given/Then steps here, but its shared
// "the bake-off emits its report" step is registered centrally in
// bakeoffPipelineSteps.js (see that file's own header) since three
// scenarios share that exact step text and the registry is
// first-match-wins.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { createFileRosterSource } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'recruiter', 'rosterSource')
);

function mkCatalogFile(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bakeoff-roster-'));
  const file = path.join(dir, 'catalog.json');
  fs.writeFileSync(file, JSON.stringify(entries));
  return file;
}

function chatEntry(overrides = {}) {
  return {
    provider: 'anthropic',
    model: 'claude-fable-5',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://console.anthropic.com', automation: 'automatable' },
    endpointType: 'chat',
    costTier: 'free/eval-tier',
    ...overrides,
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^the bake-off runs out-of-band over a fixed Claude, Mistral, and GPT candidate set, reusing the compliance battery, the provider abstraction, and the recruiter ranking, without modifying live swarm config$/,
    () => {
      // Documents the bake-off's posture (mirrors BL-233's recruiter: no
      // worktree/mailbox/pipeline role, no swarmforge.conf mutation) -
      // each scenario's own Given below builds the fixture it needs.
    }
  );

  // ── roster-enumerates-01 ─────────────────────────────────────────────
  registry.define(/^the bake-off enumerates the available models for Claude, Mistral, and GPT$/, (ctx) => {
    ctx.catalogFile = mkCatalogFile([
      chatEntry({ provider: 'anthropic', model: 'claude-fable-5', costTier: 'free/eval-tier', planCost: { amountUsd: 0, unit: 'free' } }),
      chatEntry({ provider: 'mistral', model: 'mistral-large', costTier: 'paid-only', planCost: { amountUsd: 9, unit: 'monthly' } }),
      chatEntry({ provider: 'openai', model: 'gpt-5', costTier: 'paid-only', planCost: { amountUsd: 20, unit: 'monthly' } }),
      // Non-chat endpoints, present in the catalog but must never reach the roster.
      chatEntry({ provider: 'anthropic', model: 'claude-embed', endpointType: 'embeddings' }),
      chatEntry({ provider: 'openai', model: 'dall-e', endpointType: 'image' }),
    ]);
  });

  registry.define(/^roster discovery completes$/, async (ctx) => {
    const source = createFileRosterSource(ctx.catalogFile);
    ctx.candidates = await source.discover();
  });

  registry.define(/^it lists each candidate's provider, model id, and plan cost$/, (ctx) => {
    if (!ctx.candidates || ctx.candidates.length === 0) {
      throw new Error('expected roster discovery to report at least one candidate, got none');
    }
    for (const candidate of ctx.candidates) {
      if (!candidate.provider || !candidate.model || !candidate.planCost) {
        throw new Error(`expected every candidate to carry provider/model/planCost, got: ${JSON.stringify(candidate)}`);
      }
    }
    const providers = new Set(ctx.candidates.map((c) => c.provider));
    for (const expected of ['anthropic', 'mistral', 'openai']) {
      if (!providers.has(expected)) {
        throw new Error(`expected the roster to cover provider "${expected}", got: ${JSON.stringify([...providers])}`);
      }
    }
  });

  registry.define(/^each candidate is marked as paid-only or free\/eval-tier$/, (ctx) => {
    for (const candidate of ctx.candidates) {
      if (candidate.costTier !== 'paid-only' && candidate.costTier !== 'free/eval-tier') {
        throw new Error(`expected every candidate to carry a paid-only/free-eval-tier costTier, got: ${JSON.stringify(candidate)}`);
      }
    }
  });

  registry.define(/^non-chat endpoints are excluded from the roster$/, (ctx) => {
    const nonChatModels = ['claude-embed', 'dall-e'];
    for (const model of nonChatModels) {
      if (ctx.candidates.some((c) => c.model === model)) {
        throw new Error(`expected non-chat endpoint "${model}" to be excluded from the roster`);
      }
    }
  });

  // ── cost-tier-labeled-03 ─────────────────────────────────────────────
  // Hardener fix (BL-113 Gherkin mutation): validate against the exact
  // known CostTier set rather than accepting any string verbatim - a
  // Given/Then pair that both read the SAME Examples cell can never
  // desync from a mutated value (whatever garbled string flows into
  // Given also flows into Then's expectation and trivially matches), so
  // survivor detection here depends on the Given step itself rejecting
  // anything outside the real value set, same as recruiterAcquireSteps.js's
  // WALL_TEXT_TO_AUTOMATION lookup for BL-233's acquire-wall-escalates-03.
  const KNOWN_COST_TIERS = ['paid-only', 'free/eval-tier'];

  registry.define(/^a compliant candidate whose cost tier is "([^"]+)"$/, (ctx, tier) => {
    if (!KNOWN_COST_TIERS.includes(tier)) {
      throw new Error(`unrecognized cost tier "${tier}" - expected one of: ${KNOWN_COST_TIERS.join(', ')}`);
    }
    ctx.candidate = chatEntry({
      costTier: tier,
      planCost: tier === 'paid-only' ? { amountUsd: 20, unit: 'monthly' } : { amountUsd: 0, unit: 'free' },
    });
    // labelCostTier consumes a ModelCandidate, not the raw catalog entry shape.
    ctx.candidate = {
      model: ctx.candidate.model,
      provider: ctx.candidate.provider,
      planCost: ctx.candidate.planCost,
      signupPath: ctx.candidate.signupPath,
      costTier: ctx.candidate.costTier,
    };
    ctx.expectedTier = tier;
  });

  // "the bake-off emits its report" is registered once, centrally, in
  // bakeoffPipelineSteps.js - three scenarios (this one, inaccessible-
  // listed-04, recommend-not-adopt-05) share that exact step text, and
  // the registry is first-match-wins, so only ONE registration may exist
  // for it; that handler branches on which Given populated ctx.

  registry.define(/^the report labels that candidate "([^"]+)" and shows its plan cost$/, (ctx, expected) => {
    if (ctx.label.costTier !== expected) {
      throw new Error(`expected the report to label the candidate "${expected}", got "${ctx.label.costTier}"`);
    }
    if (!ctx.label.planCost) {
      throw new Error('expected the report to show the candidate\'s plan cost');
    }
    if (JSON.stringify(ctx.label.planCost) !== JSON.stringify(ctx.candidate.planCost)) {
      throw new Error(
        `expected the labeled plan cost to match the candidate's own, got ${JSON.stringify(ctx.label.planCost)} vs ${JSON.stringify(ctx.candidate.planCost)}`
      );
    }
  });
}

module.exports = { registerSteps };
