const assert = require('node:assert/strict');
const { proposePromptsFromSurvey } = require('../out/onboarding/promptProposal');

const FIXTURE_FACTS = {
  languages: ['TypeScript', 'Clojure'],
  layoutSummary: 'extension/ (VS Code host) + swarmforge/ (Babashka scripts)',
  readmeSummary: 'Never commit secrets; macOS/Linux only.',
  seedVision: 'A visual front-end for SwarmForge multi-agent orchestration',
  initialBacklogSummary: '3 seed tickets: launch panel, tiled agent view, stop command',
};

// BL-269 onboarding-generated-prompts-01
test('project.prompt reflects the surveyed seed vision', () => {
  const prompts = proposePromptsFromSurvey(FIXTURE_FACTS);

  assert.match(prompts.projectPrompt, /# Project/);
  assert.ok(prompts.projectPrompt.includes(FIXTURE_FACTS.seedVision));
});

test('project.prompt reflects the surveyed initial backlog as its goals', () => {
  const prompts = proposePromptsFromSurvey(FIXTURE_FACTS);

  assert.ok(prompts.projectPrompt.includes(FIXTURE_FACTS.initialBacklogSummary));
});

test('project.prompt is not the generic placeholder template', () => {
  const prompts = proposePromptsFromSurvey(FIXTURE_FACTS);

  assert.doesNotMatch(prompts.projectPrompt, /<what this project does and why>/);
  assert.doesNotMatch(prompts.projectPrompt, /<what you want built or fixed/);
});

// BL-269 onboarding-generated-prompts-02
test('engineering.prompt reflects the surveyed languages', () => {
  const prompts = proposePromptsFromSurvey(FIXTURE_FACTS);

  assert.match(prompts.engineeringPrompt, /# Tech Stack/);
  assert.ok(prompts.engineeringPrompt.includes('TypeScript'));
  assert.ok(prompts.engineeringPrompt.includes('Clojure'));
});

test('engineering.prompt reflects the surveyed repo layout', () => {
  const prompts = proposePromptsFromSurvey(FIXTURE_FACTS);

  assert.ok(prompts.engineeringPrompt.includes(FIXTURE_FACTS.layoutSummary));
});

test('engineering.prompt is not the generic placeholder template', () => {
  const prompts = proposePromptsFromSurvey(FIXTURE_FACTS);

  assert.doesNotMatch(prompts.engineeringPrompt, /<languages, frameworks, runtimes>/);
  assert.doesNotMatch(prompts.engineeringPrompt, /<naming, folder structure, testing approach>/);
});

test('degrades gracefully for an empty languages list (still non-blank, non-placeholder content)', () => {
  const prompts = proposePromptsFromSurvey({ ...FIXTURE_FACTS, languages: [] });

  assert.ok(prompts.engineeringPrompt.trim().length > 0);
  assert.doesNotMatch(prompts.engineeringPrompt, /<languages, frameworks, runtimes>/);
});
