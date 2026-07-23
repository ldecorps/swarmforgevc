'use strict';

// BL-233 slice 3: step handlers for the recruiter's qualify-via-battery-04
// scenario. The candidate-driving side (trialRunner) is faked per the
// TESTABLE-boundary constraint - actually driving an arbitrary candidate
// model through a representative task per role is unspecified, out of
// scope (same posture as recruiterAcquireSteps.js's faked SignupSource).
// The battery side is REAL (createComplianceBatteryGate, driving the real
// compliance_battery.bb), proving this scenario's own wording ("it runs
// the swarm-compliance battery") against genuine battery execution, not a
// fake. Uses the hardener/coordinator gates specifically because they need
// no git/tmux fixture scaffolding (mirrors
// complianceBatterySteps.js's own per-role-04 fixtures for those two
// roles). The shared Background step is already registered by
// recruiterDiscoverSteps.js (first-match registry) - not re-registered here.
const path = require('node:path');

const { qualifyCandidate } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'recruiter', 'qualify')
);
const { createComplianceBatteryGate } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'recruiter', 'complianceBatteryGate')
);

function candidateFixture() {
  return {
    model: 'free-model-mini',
    provider: 'acme-ai',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
  };
}

// Both gates below are KNOWN-PASSING fixture argument sets, matching
// complianceBatterySteps.js's own per-role-04 usage exactly - no git/tmux
// scaffolding needed for either.
function fakeTrialRunner() {
  return {
    async runTrials() {
      return [
        { role: 'hardener', gateArgs: ['2', '1.0', '0'] },
        { role: 'coordinator', gateArgs: ['1', '3', 'true'] },
      ];
    },
  };
}

function registerSteps(registry) {
  // ── qualify-via-battery-04 ───────────────────────────────────────────
  registry.define(/^a candidate whose access has been acquired$/, (ctx) => {
    ctx.candidate = candidateFixture();
  });

  registry.define(/^the recruiter qualifies it$/, async (ctx) => {
    ctx.outcome = await qualifyCandidate(ctx.candidate, {
      trialRunner: fakeTrialRunner(),
      battery: createComplianceBatteryGate(),
    });
  });

  registry.define(
    /^it runs the swarm-compliance battery and records the candidate's per-role scorecard$/,
    (ctx) => {
      if (ctx.outcome.model !== ctx.candidate.model) {
        throw new Error(`expected the scorecard to be recorded for "${ctx.candidate.model}", got: ${JSON.stringify(ctx.outcome)}`);
      }
      const { scorecard } = ctx.outcome;
      if (!scorecard || scorecard.entries.length !== 2) {
        throw new Error(`expected a per-role scorecard with 2 entries (hardener, coordinator), got: ${JSON.stringify(scorecard)}`);
      }
      const competencies = scorecard.entries.map((e) => e.competency).sort();
      if (JSON.stringify(competencies) !== JSON.stringify(['coordinator-gate', 'hardener-gate'])) {
        throw new Error(`expected entries for both trialled roles, got competencies: ${JSON.stringify(competencies)}`);
      }
      if (scorecard.overall !== 'swarm-compliant') {
        throw new Error(`expected the real battery to record this fully-compliant trial as swarm-compliant, got: ${scorecard.overall}`);
      }
    }
  );
}

module.exports = { registerSteps };
