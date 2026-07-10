'use strict';

// BL-233 slice 1 (discover-candidates-01): step handlers for the recruiter
// discovery scenario only. This ticket is explicitly DELIVER-IN-SLICES
// (spec: "Ship slice 1 first") - slices 2-4 (auto-acquire + secret store,
// battery qualification, best-value ranking + report) are NOT implemented
// yet, so this file intentionally does not register handlers for the
// feature file's other scenarios (auto-acquire-free-02,
// acquire-wall-escalates-03, qualify-via-battery-04, best-value-ranking-05,
// recommend-not-adopt-06) or the shared Background. Running the full
// feature file will report "no step handler matched" for those until a
// later slice lands - expected, not a regression in this slice.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { createFileDiscoverySource } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'recruiter', 'discoverySource')
);

function writeCandidatesFixture(candidates) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-recruiter-discover-'));
  const file = path.join(dir, 'candidates.json');
  fs.writeFileSync(file, JSON.stringify(candidates));
  return file;
}

function registerSteps(registry) {
  // ── Background (shared by every scenario in the feature file, including
  // the slice-2-4 scenarios this file does not otherwise implement) ──────
  registry.define(
    /^the recruiter runs out-of-band, reusing the swarm-compliance battery and the provider abstraction, without modifying live swarm config$/,
    () => {
      // Documents the recruiter's posture (mirrors BL-231's battery: no
      // worktree/mailbox/pipeline role, no swarmforge.conf mutation) -
      // each scenario's own Given below builds the fixture it needs.
    }
  );

  // ── discover-candidates-01 ───────────────────────────────────────────
  registry.define(/^the recruiter searches for free or cheap model plans$/, (ctx) => {
    ctx.candidatesFile = writeCandidatesFixture([
      {
        model: 'free-model-mini',
        provider: 'acme-ai',
        planCost: { amountUsd: 0, unit: 'free' },
        signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
      },
      {
        model: 'cheap-model-pro',
        provider: 'beta-labs',
        planCost: { amountUsd: 5, unit: 'monthly' },
        signupPath: { url: 'https://beta.example/signup', automation: 'payment-wall' },
      },
    ]);
  });

  registry.define(/^discovery completes$/, async (ctx) => {
    const source = createFileDiscoverySource(ctx.candidatesFile);
    ctx.candidates = await source.discover();
  });

  registry.define(/^it reports each candidate's model, provider, plan cost, and signup path$/, (ctx) => {
    if (!ctx.candidates || ctx.candidates.length === 0) {
      throw new Error('expected discovery to report at least one candidate, got none');
    }
    for (const candidate of ctx.candidates) {
      if (!candidate.model || !candidate.provider || !candidate.planCost || !candidate.signupPath) {
        throw new Error(`expected every candidate to carry model/provider/planCost/signupPath, got: ${JSON.stringify(candidate)}`);
      }
    }
  });
}

module.exports = { registerSteps };
