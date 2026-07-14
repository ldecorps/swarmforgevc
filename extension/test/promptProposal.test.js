const assert = require('node:assert/strict');
const { proposePromptsFromSurvey, resolveVerbosity } = require('../out/onboarding/promptProposal');

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

// ── BL-382: resolveVerbosity (pure) ──────────────────────────────────────

test('resolveVerbosity resolves each of the three offered levels unchanged', () => {
  assert.equal(resolveVerbosity('concise'), 'concise');
  assert.equal(resolveVerbosity('normal'), 'normal');
  assert.equal(resolveVerbosity('detailed'), 'detailed');
});

test('resolveVerbosity defaults to normal when the contract never mentioned it', () => {
  assert.equal(resolveVerbosity(undefined), 'normal');
});

test('resolveVerbosity throws on a value that is not one of the offered levels, never a silent passthrough', () => {
  assert.throws(() => resolveVerbosity('chatty'), /invalid contract verbosity "chatty"/);
});

// ── BL-382: proposePromptsFromSurvey's verbosity term ────────────────────

test('BL-382 verbosity-is-negotiated-into-the-contract-01: an agreed verbosity reaches both generated prompts', () => {
  const prompts = proposePromptsFromSurvey(FIXTURE_FACTS, 'concise');

  assert.match(prompts.projectPrompt, /Be concise/);
  assert.match(prompts.engineeringPrompt, /Be concise/);
});

test('BL-382 verbosity-is-negotiated-into-the-contract-02: a verbosity nobody offered is refused, no prompts generated', () => {
  assert.throws(() => proposePromptsFromSurvey(FIXTURE_FACTS, 'extremely chatty'), /invalid contract verbosity/);
});

test('BL-382 verbosity-is-negotiated-into-the-contract-03: a contract that never mentioned verbosity still generates prompts, defaulting to normal', () => {
  const prompts = proposePromptsFromSurvey(FIXTURE_FACTS);

  assert.match(prompts.projectPrompt, /Be normal/);
  assert.match(prompts.engineeringPrompt, /Be normal/);
});

test('BL-382 verbosity-is-negotiated-into-the-contract-04: re-proposing with a changed verbosity changes the generated prompts', () => {
  const concise = proposePromptsFromSurvey(FIXTURE_FACTS, 'concise');
  const detailed = proposePromptsFromSurvey(FIXTURE_FACTS, 'detailed');

  assert.match(concise.projectPrompt, /Be concise/);
  assert.match(detailed.projectPrompt, /Be detailed/);
  assert.doesNotMatch(detailed.projectPrompt, /Be concise/);
});
