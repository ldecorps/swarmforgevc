'use strict';

// BL-250 slice 2: step handlers for the bake-off's remaining scenarios
// (best-value-leaderboard-02, inaccessible-listed-04, recommend-not-
// adopt-05, key-never-committed-06). Every one of these REUSES BL-233's
// existing rank.ts/orchestrator.ts/recommend.ts/acquire.ts/secretStore.ts
// UNCHANGED, per the ticket's own scope line - no new production code in
// this slice, only fixture wiring proving that reuse actually runs for
// the bake-off's own three-provider-crossing context (not fabricated).
//
// STEP-TEXT COLLISIONS WITH BL-233 (deliberate, not a bug): the specifier
// wrote several of THIS feature's Then/Given steps with IDENTICAL text to
// recruiterRankRecommendSteps.js's/recruiterAcquireSteps.js's own steps,
// since both assert the SAME reused function's behavior. The step
// registry is first-match-wins and those BL-233 files register first, so
// those exact-text steps are answered by BL-233's EXISTING handlers, not
// duplicated here - this file's own Given/When steps feed them by using
// the SAME fixture literals (model names, the fake key string) those
// handlers already check, so "shared step text" really is "shared
// verification," true reuse at the acceptance layer too. Only this
// file's OWN non-colliding step text is registered below.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { rankForRole } = require(path.join(EXT_OUT, 'recruiter', 'rank'));
const { suggestConfChange } = require(path.join(EXT_OUT, 'recruiter', 'recommend'));
const { runRecruiter } = require(path.join(EXT_OUT, 'recruiter', 'orchestrator'));
const { createFileRosterSource } = require(path.join(EXT_OUT, 'recruiter', 'rosterSource'));
const { acquireAccess } = require(path.join(EXT_OUT, 'recruiter', 'acquire'));
const { createFileSecretStore } = require(path.join(EXT_OUT, 'recruiter', 'secretStore'));
const { labelCostTier } = require(path.join(EXT_OUT, 'recruiter', 'costTierLabel'));

const SWARMFORGE_CONF = path.join(__dirname, '..', '..', '..', 'swarmforge', 'swarmforge.conf');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function scoredCandidate(model, provider, { compliant, passCount, totalCount, amountUsd, unit }) {
  const entries = [];
  for (let i = 0; i < totalCount; i++) {
    entries.push({ competency: `gate-${i}`, status: i < passCount ? 'pass' : 'fail' });
  }
  return {
    candidate: {
      model,
      provider,
      planCost: { amountUsd, unit },
      signupPath: { url: `https://${provider}.example`, automation: 'automatable' },
      costTier: unit === 'free' ? 'free/eval-tier' : 'paid-only',
    },
    scorecard: { model, entries, overall: compliant ? 'swarm-compliant' : 'non-compliant' },
  };
}

function registerSteps(registry) {
  // ── best-value-leaderboard-02 ────────────────────────────────────────
  // Given/When text is unique to this feature (registered here); the
  // four Then steps that follow ("only battery-compliant...", "ordered
  // by capability...", "the current model...", "a best-value model...")
  // are IDENTICAL text to recruiterRankRecommendSteps.js's own and are
  // answered by that file's handlers - so this fixture deliberately uses
  // the SAME model names those handlers check (non-compliant-model/
  // high-capability-model/cheaper-model/pricier-model, with the SAME
  // capability/cost values), attributed across Claude/Mistral/GPT via the
  // provider field to prove the cross-provider case those handlers can't
  // see on their own (they only ever check .model, never .provider).
  registry.define(
    /^several candidates across Claude, Mistral, and GPT scored by the battery for a role$/,
    (ctx) => {
      ctx.role = 'coder';
      ctx.currentModel = 'incumbent-model';
      ctx.scoredCandidates = [
        scoredCandidate('non-compliant-model', 'openai', { compliant: false, passCount: 1, totalCount: 3, amountUsd: 0, unit: 'free' }),
        scoredCandidate('high-capability-model', 'anthropic', { compliant: true, passCount: 3, totalCount: 3, amountUsd: 10, unit: 'monthly' }),
        scoredCandidate('cheaper-model', 'mistral', { compliant: true, passCount: 2, totalCount: 3, amountUsd: 0, unit: 'free' }),
        scoredCandidate('pricier-model', 'openai', { compliant: true, passCount: 2, totalCount: 3, amountUsd: 5, unit: 'monthly' }),
      ];
    }
  );

  registry.define(/^the bake-off ranks them for that role$/, (ctx) => {
    ctx.leaderboard = rankForRole(ctx.role, ctx.scoredCandidates, ctx.currentModel);
  });

  // ── inaccessible-listed-04 ───────────────────────────────────────────
  registry.define(/^a rostered candidate the bake-off could not access$/, (ctx) => {
    const catalogDir = mkTmp('aps-bakeoff-inaccessible-');
    const catalogFile = path.join(catalogDir, 'catalog.json');
    fs.writeFileSync(
      catalogFile,
      JSON.stringify([
        {
          provider: 'openai',
          model: 'gpt-5-paid',
          planCost: { amountUsd: 20, unit: 'monthly' },
          signupPath: { url: 'https://openai.example', automation: 'payment-wall' },
          endpointType: 'chat',
          costTier: 'paid-only',
        },
      ])
    );
    ctx.runDeps = {
      discovery: createFileRosterSource(catalogFile),
      signup: { signUp: async () => { throw new Error('must never be called for a walled candidate'); } },
      secretStore: { store: async () => { throw new Error('must never be called for a walled candidate'); } },
      trialRunner: { runTrials: async () => [] },
      battery: {
        gate: async () => ({ competency: 'x-gate', status: 'pass' }),
        scorecard: async (model, entries) => ({ model, entries, overall: 'swarm-compliant' }),
      },
      currentModelByRole: {},
    };
  });

  // Shared by THREE scenarios (cost-tier-labeled-03, inaccessible-
  // listed-04, recommend-not-adopt-05) - all use the identical step text
  // "the bake-off emits its report", so this is the single registration
  // for it (the registry is first-match-wins); it branches on whichever
  // field that scenario's own Given populated.
  registry.define(/^the bake-off emits its report$/, async (ctx) => {
    if (ctx.runDeps) {
      ctx.report = await runRecruiter(ctx.runDeps);
    } else if (ctx.leaderboard) {
      ctx.suggestion = suggestConfChange(ctx.leaderboard);
    } else if (ctx.candidate) {
      ctx.label = labelCostTier(ctx.candidate);
    } else {
      throw new Error('no report-emission fixture was set up by this scenario\'s own Given step');
    }
  });

  registry.define(/^that candidate is listed as untested with the reason$/, (ctx) => {
    const untested = ctx.report.escalated.find((e) => e.model === 'gpt-5-paid');
    if (!untested) {
      throw new Error(`expected "gpt-5-paid" to be listed as untested (escalated), got: ${JSON.stringify(ctx.report.escalated)}`);
    }
    if (!untested.wall) {
      throw new Error(`expected the untested candidate to carry a reason (its wall type), got: ${JSON.stringify(untested)}`);
    }
    if (ctx.report.roles.length !== 0) {
      throw new Error('an inaccessible candidate must never appear in any role\'s ranking');
    }
  });

  // ── recommend-not-adopt-05 ───────────────────────────────────────────
  // "a best-value recommendation for a role" and "the report includes a
  // suggested swarmforge.conf --model change for that role" are IDENTICAL
  // text to recruiterRankRecommendSteps.js's own - that file's Given
  // already builds ctx.leaderboard/ctx.swarmforgeConfBefore, and its Then
  // already checks the resulting suggestion, so nothing is registered for
  // either here. Only "the bake-off does not modify swarmforge.conf..."
  // (this feature's own wording) is registered.
  registry.define(/^the bake-off does not modify swarmforge\.conf or bounce the swarm$/, (ctx) => {
    const after = fs.readFileSync(SWARMFORGE_CONF, 'utf8');
    if (after !== ctx.swarmforgeConfBefore) {
      throw new Error('expected swarmforge.conf to be byte-for-byte unchanged after emitting the report');
    }
  });

  // ── key-never-committed-06 ───────────────────────────────────────────
  // "the key is never written to the working tree or any commit" is
  // IDENTICAL text to recruiterAcquireSteps.js's own Then step, which
  // reads ctx.outcome and checks for ITS OWN hardcoded fake-key literal -
  // so this fixture stores the outcome under that same ctx.outcome field
  // and signs up with that SAME literal key, making the shared check
  // genuinely verify this scenario too (not a false pass against a key
  // string that could never appear here regardless of correctness).
  const SHARED_FAKE_API_KEY = 'sk-fake-test-key-do-not-use';

  registry.define(/^the bake-off acquires or uses a provider API key$/, (ctx) => {
    ctx.acquireCandidate = {
      model: 'claude-fable-5',
      provider: 'anthropic',
      planCost: { amountUsd: 0, unit: 'free' },
      signupPath: { url: 'https://console.anthropic.com', automation: 'automatable' },
      costTier: 'free/eval-tier',
    };
    // A SEPARATE tmpdir, outside ctx.workingTreeDir below - satisfies
    // createFileSecretStore's own "outside the target working directory"
    // guard, same posture as BL-233's own recruiterAcquireSteps.js.
    ctx.secretsFile = path.join(mkTmp('aps-bakeoff-secrets-'), 'secrets.json');
    ctx.workingTreeDir = mkTmp('aps-bakeoff-worktree-');
    fs.writeFileSync(path.join(ctx.workingTreeDir, 'placeholder.txt'), 'nothing secret here\n');
  });

  registry.define(/^it stores the key$/, async (ctx) => {
    const signup = { signUp: async () => SHARED_FAKE_API_KEY };
    const secretStore = createFileSecretStore(ctx.secretsFile, ctx.workingTreeDir);
    ctx.outcome = await acquireAccess(ctx.acquireCandidate, { signup, secretStore });
  });

  registry.define(/^the key is stored in the host secret store only$/, (ctx) => {
    if (ctx.outcome.status !== 'acquired') {
      throw new Error(`expected status "acquired", got: ${JSON.stringify(ctx.outcome)}`);
    }
    const stored = JSON.parse(fs.readFileSync(ctx.secretsFile, 'utf8'));
    if (stored['anthropic:claude-fable-5'] !== SHARED_FAKE_API_KEY) {
      throw new Error(`expected the key stored under "anthropic:claude-fable-5", got: ${JSON.stringify(stored)}`);
    }
  });
}

module.exports = { registerSteps };
