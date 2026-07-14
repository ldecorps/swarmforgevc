'use strict';

// BL-262 slice 1: step handlers for the onboarding-contract feature. Drives
// the REAL compiled modules in-process (mirrors gateAnswerSteps.js's own
// pattern) - every capability under test here (survey->propose mapping, the
// build-start gate, YAML parse/render, the legible view) is a PURE function,
// so no live swarm, real repo, or real timer is needed. The SURVEY of a live
// target repo is swarm/agent behavior, not unit-testable code (per the
// ticket itself) - these steps exercise the pure boundary just past that:
// already-gathered survey facts in, a proposed contract out.
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { proposeContractFromSurvey } = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractSurvey'));
const { evaluateBuildStartGate } = require(path.join(EXT_DIR, 'out', 'onboarding', 'buildStartGate'));
const {
  renderContractYaml,
  generateContractMarkdown,
} = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractView'));

const FIXTURE_SURVEY_FACTS = {
  languages: ['TypeScript', 'Clojure'],
  layoutSummary: 'extension/ (VS Code host) + swarmforge/ (Babashka scripts)',
  readmeSummary: 'Never commit secrets; macOS/Linux only.',
  seedVision: 'A visual front-end for SwarmForge multi-agent orchestration',
  initialBacklogSummary: '3 seed tickets: launch panel, tiled agent view, stop command',
};

function contractYaml(agreement) {
  return renderContractYaml({
    scope: ['Build the thing.'],
    outOfScope: ['Rewrite the stack.'],
    boundaries: ['Respect the README.'],
    initialBacklogSummary: '3 tickets queued.',
    agreement,
  });
}

// BL-262 constraint / engineering-article Acceptance Pipeline rule: every
// Scenario Outline Examples column value is validated against an explicit
// KNOWN_VALUES lookup, never a passthrough - "missing" and "malformed" are
// test-fixture markers (no file / unparseable YAML), not real
// ContractAgreementState values, so they get their own fixture builders here.
const KNOWN_AGREEMENT_STATE_FIXTURES = {
  agreed: () => contractYaml('agreed'),
  proposed: () => contractYaml('proposed'),
  pending: () => contractYaml('pending'),
  missing: () => undefined,
  malformed: () => 'scope: [unclosed',
};

const KNOWN_GATE_DECISIONS = new Set(['allow', 'hold']);

function registerSteps(registry) {
  registry.define(/^a target repo the swarm is being onboarded onto$/, () => {
    // Framing only - no fixture state needed until a scenario names what the
    // repo carries or what contract state it's in.
  });

  // ── survey-proposes-populated-contract-01 ───────────────────────────
  registry.define(/^the repo carries code and structure and a seed vision and an initial backlog$/, (ctx) => {
    ctx.surveyFacts = FIXTURE_SURVEY_FACTS;
  });

  registry.define(/^the swarm onboards the target$/, (ctx) => {
    ctx.proposedContract = proposeContractFromSurvey(ctx.surveyFacts);
  });

  registry.define(
    /^it proposes a contract whose scope, out-of-scope, and boundaries are populated from the survey rather than left blank$/,
    (ctx) => {
      const { scope, outOfScope, boundaries } = ctx.proposedContract;
      if (scope.length === 0 || outOfScope.length === 0 || boundaries.length === 0) {
        throw new Error('expected scope/outOfScope/boundaries to be non-blank');
      }
      // Each section is grounded in SOME survey fact - not necessarily the
      // SAME fact in every section (boundaries legitimately derives from
      // readmeSummary rather than languages/seedVision).
      const anySurveyFact = [ctx.surveyFacts.seedVision, ...ctx.surveyFacts.languages, ctx.surveyFacts.readmeSummary];
      const referencesSurvey = (section) => section.some((line) => anySurveyFact.some((fact) => line.includes(fact)));
      if (!referencesSurvey(scope) || !referencesSurvey(outOfScope) || !referencesSurvey(boundaries)) {
        throw new Error(
          `expected scope/outOfScope/boundaries to each be populated FROM the survey (${anySurveyFact.join(' | ')}), got: ${JSON.stringify({ scope, outOfScope, boundaries })}`
        );
      }
    }
  );

  registry.define(/^the proposed contract's initial-backlog summary reflects the surveyed backlog$/, (ctx) => {
    if (ctx.proposedContract.initialBacklogSummary !== ctx.surveyFacts.initialBacklogSummary) {
      throw new Error('expected the proposed contract to carry the surveyed initial backlog summary through unchanged');
    }
  });

  registry.define(/^the contract is left marked as proposed, awaiting the operator's agreement$/, (ctx) => {
    if (ctx.proposedContract.agreement !== 'proposed') {
      throw new Error(`expected agreement to be "proposed", got: "${ctx.proposedContract.agreement}"`);
    }
  });

  // ── gate-decides-by-agreement-state-02 (Scenario Outline) ───────────
  registry.define(/^a contract whose agreement state is "(.+)"$/, (ctx, agreementState) => {
    if (!(agreementState in KNOWN_AGREEMENT_STATE_FIXTURES)) {
      throw new Error(`unknown agreement_state example value: "${agreementState}" (known: ${Object.keys(KNOWN_AGREEMENT_STATE_FIXTURES).join(', ')})`);
    }
    ctx.rawContractYaml = KNOWN_AGREEMENT_STATE_FIXTURES[agreementState]();
  });

  registry.define(/^the coordinator evaluates the build-start gate$/, (ctx) => {
    ctx.gateDecision = evaluateBuildStartGate(ctx.rawContractYaml);
  });

  registry.define(/^the gate decision is "(.+)"$/, (ctx, gateDecision) => {
    if (!KNOWN_GATE_DECISIONS.has(gateDecision)) {
      throw new Error(`unknown gate_decision example value: "${gateDecision}" (known: ${[...KNOWN_GATE_DECISIONS].join(', ')})`);
    }
    if (ctx.gateDecision.decision !== gateDecision) {
      throw new Error(`expected gate decision "${gateDecision}", got "${ctx.gateDecision.decision}"`);
    }
  });

  registry.define(/^a held decision names the unagreed contract as the reason without crashing$/, (ctx) => {
    if (ctx.gateDecision.decision === 'hold' && !ctx.gateDecision.reason) {
      throw new Error('expected a held decision to name a reason');
    }
    // "without crashing" is proven by construction: evaluateBuildStartGate
    // above already returned a plain decision object rather than throwing.
  });

  // ── legible-view-mirrors-source-03 ───────────────────────────────────
  registry.define(/^a contract source with a scope and an agreement state$/, (ctx) => {
    ctx.contractSource = {
      scope: ['Build the thing.'],
      outOfScope: ['Rewrite the stack.'],
      boundaries: ['Respect the README.'],
      initialBacklogSummary: '3 tickets queued.',
      agreement: 'proposed',
    };
  });

  registry.define(/^the legible CONTRACT\.md view is generated$/, (ctx) => {
    ctx.legibleView = generateContractMarkdown(ctx.contractSource);
  });

  registry.define(
    /^it shows the same scope and agreement state as the source so the two do not diverge$/,
    (ctx) => {
      const view = ctx.legibleView;
      if (!view.includes(`Agreement: ${ctx.contractSource.agreement}`)) {
        throw new Error(`expected the legible view to show the source's agreement state; got: ${view}`);
      }
      for (const scopeLine of ctx.contractSource.scope) {
        if (!view.includes(scopeLine)) {
          throw new Error(`expected the legible view to show the source's scope line "${scopeLine}"; got: ${view}`);
        }
      }
    }
  );

  // ── reopen-reholds-gate-04 ───────────────────────────────────────────
  registry.define(/^an agreed contract that currently allows dispatch$/, (ctx) => {
    ctx.rawContractYaml = contractYaml('agreed');
    const decision = evaluateBuildStartGate(ctx.rawContractYaml);
    if (decision.decision !== 'allow') {
      throw new Error('expected the agreed fixture to allow dispatch before the reopen');
    }
  });

  registry.define(/^the operator flips the agreement marker back to pending for a scope change$/, (ctx) => {
    ctx.rawContractYaml = contractYaml('pending');
  });

  registry.define(/^the build-start gate holds dispatch again until the contract is re-agreed$/, (ctx) => {
    const decision = evaluateBuildStartGate(ctx.rawContractYaml);
    if (decision.decision !== 'hold') {
      throw new Error(`expected the gate to hold after reopening to pending, got: "${decision.decision}"`);
    }
  });
}

module.exports = { registerSteps };
