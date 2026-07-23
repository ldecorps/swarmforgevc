'use strict';

// BL-382: step handlers for "How much the agents say is negotiated into
// the contract". Drives the REAL compiled propose-onboarding-prompts.js
// CLI end to end against a real scratch git target repo (writes
// .swarmforge/contract.yaml, runs the CLI, reads the materialized
// project.prompt/engineering.prompt back off disk) rather than calling
// proposePromptsFromSurvey in-memory - the 2nd QA bounce on this ticket
// named that in-memory shortcut as the exact reason the CLI's own
// existence-only idempotency bug (already-materialized prompts never
// refreshed on a contract change-of-mind) was invisible to this feature's
// own acceptance run.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const CLI_PATH = path.join(EXT_DIR, 'out', 'tools', 'propose-onboarding-prompts.js');
const { renderContractYaml } = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractView'));

const FIXTURE_SURVEY_FACTS = {
  languages: ['TypeScript', 'Clojure'],
  layoutSummary: 'extension/ (VS Code host) + swarmforge/ (Babashka scripts)',
  readmeSummary: 'Never commit secrets; macOS/Linux only.',
  seedVision: 'A visual front-end for SwarmForge multi-agent orchestration',
  initialBacklogSummary: '3 seed tickets: launch panel, tiled agent view, stop command',
  useCaseObservations: [],
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

function mkGitTargetRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-verbosity-contract-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  return root;
}

// Writes an always-agreed contract (this feature's own scope is verbosity
// reaching the generated prompts, not the agreement gate itself - that is
// BL-269's own feature) with the given raw verbosity, `undefined` meaning
// "the field is absent entirely" (scenario 03).
function writeContract(targetPath, rawVerbosity) {
  const contract = {
    scope: [],
    outOfScope: [],
    boundaries: [],
    initialBacklogSummary: '',
    agreement: 'agreed',
  };
  if (rawVerbosity !== undefined) {
    contract.verbosity = rawVerbosity;
  }
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'contract.yaml'), renderContractYaml(contract));
}

function surveyFactsPath(targetPath) {
  const surveyPath = path.join(targetPath, 'survey-facts.json');
  if (!fs.existsSync(surveyPath)) {
    fs.writeFileSync(surveyPath, JSON.stringify(FIXTURE_SURVEY_FACTS));
  }
  return surveyPath;
}

function generatePrompts(ctx) {
  execFileSync('node', [CLI_PATH, ctx.targetPath, surveyFactsPath(ctx.targetPath)], { encoding: 'utf8' });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a target repo has an agreed contract$/, (ctx) => {
    ctx.targetPath = mkGitTargetRepo();
    ctx.rawVerbosity = undefined;
    writeContract(ctx.targetPath, ctx.rawVerbosity);
  });

  // ── verbosity-is-negotiated-into-the-contract-01 (Scenario Outline) /
  //    -04's first Given (identical wording, verbosity="concise") ───────
  // Materializes the prompts immediately, not just the contract term: an
  // "agreed" contract's verbosity, as a GIVEN precondition, describes a
  // target that has ALREADY been through onboarding (BL-269's own gate
  // releases the prompts for commit the moment agreement holds) - so this
  // scenario starts from prompts already on disk, not from a blank target.
  // That materialization is exactly what makes scenario 04's later
  // regeneration a real regeneration of EXISTING content (the ticket's own
  // E2E QA procedure: generate once, assert, re-negotiate, regenerate,
  // assert again) rather than a disguised first-time write that can never
  // exercise the 2nd-bounce defect regardless of what the step handler
  // calls into.
  registry.define(/^the contract's agreed verbosity is (concise|normal|detailed)$/, (ctx, verbosity) => {
    ctx.rawVerbosity = knownVerbosity(verbosity);
    writeContract(ctx.targetPath, ctx.rawVerbosity);
    generatePrompts(ctx);
  });

  // ── verbosity-is-negotiated-into-the-contract-02 ────────────────────
  // Deliberately a fixed, unvalidated bad value - NOT the Outline's own
  // parameterized Given above (this is the case that lookup exists to
  // reject in production, not in the test's own setup).
  registry.define(/^the contract states a verbosity that is not one of the offered levels$/, (ctx) => {
    ctx.rawVerbosity = 'extremely chatty';
    writeContract(ctx.targetPath, ctx.rawVerbosity);
  });

  // ── verbosity-is-negotiated-into-the-contract-03 ────────────────────
  registry.define(/^the contract states no verbosity at all$/, (ctx) => {
    ctx.rawVerbosity = undefined;
    writeContract(ctx.targetPath, ctx.rawVerbosity);
  });

  // ── verbosity-is-negotiated-into-the-contract-04 (second Given) ─────
  // The human's change of mind - re-negotiating REWRITES the same
  // contract.yaml the Background/first Given already wrote, exactly like a
  // real negotiation round would (BL-344's updateTargetContract).
  registry.define(/^the human negotiates the verbosity to (concise|normal|detailed)$/, (ctx, verbosity) => {
    ctx.rawVerbosity = knownVerbosity(verbosity);
    writeContract(ctx.targetPath, ctx.rawVerbosity);
  });

  // ── shared When ──────────────────────────────────────────────────────
  registry.define(/^the target's prompts are generated$/, (ctx) => {
    try {
      generatePrompts(ctx);
      ctx.refusalError = null;
    } catch (err) {
      ctx.refusalError = err;
    }
  });

  // ── verbosity-is-negotiated-into-the-contract-01/03/04 (shared Then,
  //    ONE handler for the Outline and its literal-wording twins) ─────
  registry.define(/^the generated prompts tell the agents to be (concise|normal|detailed)$/, (ctx, verbosity) => {
    knownVerbosity(verbosity);
    if (ctx.refusalError) {
      throw new Error(`expected prompts to have been generated, but generation was refused: ${ctx.refusalError.message}`);
    }
    for (const fileName of ['project.prompt', 'engineering.prompt']) {
      const content = fs.readFileSync(path.join(ctx.targetPath, fileName), 'utf8');
      if (!content.includes(`Be ${verbosity}`)) {
        throw new Error(`expected ${fileName} to tell the agents to be ${verbosity}, got: ${content}`);
      }
    }
  });

  // ── verbosity-is-negotiated-into-the-contract-02 ────────────────────
  registry.define(/^the contract is refused as invalid$/, (ctx) => {
    if (!ctx.refusalError) {
      throw new Error('expected prompt generation to have been refused, but it succeeded');
    }
    if (fs.existsSync(path.join(ctx.targetPath, 'project.prompt'))) {
      throw new Error('expected no prompts to have been generated on refusal');
    }
  });
}

module.exports = { registerSteps };
