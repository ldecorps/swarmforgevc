'use strict';

// BL-269: step handlers for the onboarding-generates-target-prompts
// feature. Drives the REAL compiled modules in-process (mirrors
// onboardingContractSteps.js's own BL-262 pattern) - proposePromptsFromSurvey
// (pure survey->prompts mapping), evaluateBuildStartGate (the SAME gate
// BL-262's contract already rides), and initializeTargetPrompts (the
// gated release into a real scratch git target repo). No live repo scan.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { proposePromptsFromSurvey } = require(path.join(EXT_DIR, 'out', 'onboarding', 'promptProposal'));
const { evaluateBuildStartGate } = require(path.join(EXT_DIR, 'out', 'onboarding', 'buildStartGate'));
const { renderContractYaml } = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractView'));
const { initializeTargetPrompts } = require(path.join(EXT_DIR, 'out', 'config', 'targetBootstrap'));

const FIXTURE_SURVEY_FACTS = {
  languages: ['TypeScript', 'Clojure'],
  layoutSummary: 'extension/ (VS Code host) + swarmforge/ (Babashka scripts)',
  readmeSummary: 'Never commit secrets; macOS/Linux only.',
  seedVision: 'A visual front-end for SwarmForge multi-agent orchestration',
  initialBacklogSummary: '3 seed tickets: launch panel, tiled agent view, stop command',
};

function mkGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-onboarding-prompts-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  return root;
}

// BL-269 constraint: the Scenario Outline's <state>/<disposition> columns
// are validated against explicit KNOWN_VALUES lookups, never a
// passthrough, so a gherkin-mutator mutation of either value fails the
// acceptance run.
const KNOWN_AGREEMENT_STATE_FIXTURES = {
  agreed: () => renderContractYaml({ scope: [], outOfScope: [], boundaries: [], initialBacklogSummary: '', agreement: 'agreed' }),
  proposed: () => renderContractYaml({ scope: [], outOfScope: [], boundaries: [], initialBacklogSummary: '', agreement: 'proposed' }),
  pending: () => renderContractYaml({ scope: [], outOfScope: [], boundaries: [], initialBacklogSummary: '', agreement: 'pending' }),
};

const KNOWN_DISPOSITIONS = new Set(['withheld from', 'released for commit to']);

function registerSteps(registry) {
  registry.define(
    /^a repo survey of a target repo has gathered its facts \(languages, layout, README, seed vision, initial backlog\)$/,
    (ctx) => {
      ctx.surveyFacts = FIXTURE_SURVEY_FACTS;
    }
  );

  // ── onboarding-generated-prompts-01 / -02 ────────────────────────────
  registry.define(/^the onboarding negotiation proposes the target's prompt artifacts$/, (ctx) => {
    ctx.proposedPrompts = proposePromptsFromSurvey(ctx.surveyFacts);
  });

  registry.define(/^the proposed project\.prompt content reflects the surveyed seed vision and product scope$/, (ctx) => {
    ctx.lastChecked = 'projectPrompt';
    const content = ctx.proposedPrompts.projectPrompt;
    if (!content.includes(ctx.surveyFacts.seedVision)) {
      throw new Error(`expected project.prompt to include the surveyed seed vision; got: ${content}`);
    }
    if (!content.includes(ctx.surveyFacts.initialBacklogSummary)) {
      throw new Error(`expected project.prompt to reflect the surveyed product scope (initial backlog); got: ${content}`);
    }
  });

  registry.define(/^the proposed engineering\.prompt content reflects the surveyed languages and repo layout$/, (ctx) => {
    ctx.lastChecked = 'engineeringPrompt';
    const content = ctx.proposedPrompts.engineeringPrompt;
    for (const language of ctx.surveyFacts.languages) {
      if (!content.includes(language)) {
        throw new Error(`expected engineering.prompt to include the surveyed language "${language}"; got: ${content}`);
      }
    }
    if (!content.includes(ctx.surveyFacts.layoutSummary)) {
      throw new Error(`expected engineering.prompt to reflect the surveyed repo layout; got: ${content}`);
    }
  });

  registry.define(/^it is not a generic placeholder template$/, (ctx) => {
    const content = ctx.proposedPrompts[ctx.lastChecked];
    if (/<[^>]+>/.test(content)) {
      throw new Error(`expected no angle-bracket placeholder text (the generic template's own marker); got: ${content}`);
    }
  });

  // ── onboarding-generated-prompts-03 (Scenario Outline) ────────────────
  registry.define(/^the proposed project\.prompt and engineering\.prompt are part of the onboarding contract$/, (ctx) => {
    ctx.targetPath = mkGitRepo();
    ctx.proposedPrompts = proposePromptsFromSurvey(FIXTURE_SURVEY_FACTS);
  });

  registry.define(/^the contract agreement is "?(.+?)"?$/, async (ctx, state) => {
    if (!(state in KNOWN_AGREEMENT_STATE_FIXTURES)) {
      throw new Error(`unknown agreement state example value: "${state}" (known: ${Object.keys(KNOWN_AGREEMENT_STATE_FIXTURES).join(', ')})`);
    }
    const rawContractYaml = KNOWN_AGREEMENT_STATE_FIXTURES[state]();
    const gateDecision = evaluateBuildStartGate(rawContractYaml);
    ctx.releaseResult = await initializeTargetPrompts(ctx.targetPath, ctx.proposedPrompts, gateDecision);
  });

  registry.define(/^the generated prompts are "?(.+?)"? the target repo$/, (ctx, disposition) => {
    if (!KNOWN_DISPOSITIONS.has(disposition)) {
      throw new Error(`unknown disposition example value: "${disposition}" (known: ${[...KNOWN_DISPOSITIONS].join(', ')})`);
    }
    const projectPromptExists = fs.existsSync(path.join(ctx.targetPath, 'project.prompt'));
    const engineeringPromptExists = fs.existsSync(path.join(ctx.targetPath, 'engineering.prompt'));

    if (disposition === 'withheld from') {
      if (ctx.releaseResult.withheld !== true || projectPromptExists || engineeringPromptExists) {
        throw new Error(
          `expected the prompts to be withheld (no files written); got withheld=${ctx.releaseResult.withheld}, projectPromptExists=${projectPromptExists}, engineeringPromptExists=${engineeringPromptExists}`
        );
      }
    } else {
      if (ctx.releaseResult.withheld !== false || !ctx.releaseResult.committed || !projectPromptExists || !engineeringPromptExists) {
        throw new Error(
          `expected the prompts to be released and committed; got: ${JSON.stringify(ctx.releaseResult)}, projectPromptExists=${projectPromptExists}, engineeringPromptExists=${engineeringPromptExists}`
        );
      }
    }
  });
}

module.exports = { registerSteps };
