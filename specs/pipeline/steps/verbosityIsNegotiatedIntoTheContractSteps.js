'use strict';

// BL-382: step handlers for "How much the agents say is negotiated into
// the contract". Drives the REAL compiled proposePromptsFromSurvey/
// resolveVerbosity (extension/src/onboarding/promptProposal.ts) directly
// against fixture survey facts - both are pure and testable with no VS
// Code, no network, no live swarm (this ticket's own scope note), mirrors
// onboardingPromptsSteps.js's own in-process pattern.
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { proposePromptsFromSurvey } = require(path.join(EXT_DIR, 'out', 'onboarding', 'promptProposal'));

const FIXTURE_SURVEY_FACTS = {
  languages: ['TypeScript', 'Clojure'],
  layoutSummary: 'extension/ (VS Code host) + swarmforge/ (Babashka scripts)',
  readmeSummary: 'Never commit secrets; macOS/Linux only.',
  seedVision: 'A visual front-end for SwarmForge multi-agent orchestration',
  initialBacklogSummary: '3 seed tickets: launch panel, tiled agent view, stop command',
};

// BL-382's own explicit warning: the Scenario Outline's <verbosity> column
// (and its literal-wording twins in scenarios 03/04) must be validated
// against an explicit KNOWN_VALUES lookup, never a bare passthrough - an
// unrecognized value (including a gherkin-mutator mutant) throws here
// rather than silently taking some default branch. Scenario 02's OWN
// Given deliberately does NOT go through this lookup - its whole point is
// to supply a value outside the offered set.
const KNOWN_VERBOSITY_VALUES = new Set(['concise', 'normal', 'detailed']);

function knownVerbosity(value) {
  if (!KNOWN_VERBOSITY_VALUES.has(value)) {
    throw new Error(`verbosity-is-negotiated-into-the-contract: unrecognized <verbosity> example value "${value}"`);
  }
  return value;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a target repo has an agreed contract$/, (ctx) => {
    ctx.facts = FIXTURE_SURVEY_FACTS;
    ctx.verbosity = undefined;
  });

  // ── verbosity-is-negotiated-into-the-contract-01 (Scenario Outline) /
  //    -04's first Given (identical wording, verbosity="concise") ───────
  registry.define(/^the contract's agreed verbosity is (concise|normal|detailed)$/, (ctx, verbosity) => {
    ctx.verbosity = knownVerbosity(verbosity);
  });

  // ── verbosity-is-negotiated-into-the-contract-02 ────────────────────
  // Deliberately a fixed, unvalidated bad value - NOT the Outline's own
  // parameterized Given above (this is the case that lookup exists to
  // reject in production, not in the test's own setup).
  registry.define(/^the contract states a verbosity that is not one of the offered levels$/, (ctx) => {
    ctx.verbosity = 'extremely chatty';
  });

  // ── verbosity-is-negotiated-into-the-contract-03 ────────────────────
  registry.define(/^the contract states no verbosity at all$/, (ctx) => {
    ctx.verbosity = undefined;
  });

  // ── verbosity-is-negotiated-into-the-contract-04 (second Given) ─────
  registry.define(/^the human negotiates the verbosity to (concise|normal|detailed)$/, (ctx, verbosity) => {
    ctx.verbosity = knownVerbosity(verbosity);
  });

  // ── shared When ──────────────────────────────────────────────────────
  registry.define(/^the target's prompts are generated$/, (ctx) => {
    try {
      ctx.prompts = proposePromptsFromSurvey(ctx.facts, ctx.verbosity);
      ctx.refusalError = null;
    } catch (err) {
      ctx.prompts = null;
      ctx.refusalError = err;
    }
  });

  // ── verbosity-is-negotiated-into-the-contract-01/03/04 (shared Then,
  //    ONE handler for the Outline and its literal-wording twins) ─────
  registry.define(/^the generated prompts tell the agents to be (concise|normal|detailed)$/, (ctx, verbosity) => {
    knownVerbosity(verbosity);
    if (!ctx.prompts) {
      throw new Error(`expected prompts to have been generated, but generation was refused: ${ctx.refusalError && ctx.refusalError.message}`);
    }
    for (const key of ['projectPrompt', 'engineeringPrompt']) {
      if (!ctx.prompts[key].includes(`Be ${verbosity}`)) {
        throw new Error(`expected ${key} to tell the agents to be ${verbosity}, got: ${ctx.prompts[key]}`);
      }
    }
  });

  // ── verbosity-is-negotiated-into-the-contract-02 ────────────────────
  registry.define(/^the contract is refused as invalid$/, (ctx) => {
    if (!ctx.refusalError) {
      throw new Error('expected prompt generation to have been refused, but it succeeded');
    }
    if (ctx.prompts) {
      throw new Error('expected no prompts to have been generated on refusal');
    }
  });
}

module.exports = { registerSteps };
