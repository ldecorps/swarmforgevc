const assert = require('node:assert/strict');
const { proposeContractFromSurvey } = require('../out/onboarding/contractSurvey');

const FIXTURE_FACTS = {
  languages: ['TypeScript', 'Clojure'],
  layoutSummary: 'extension/ (VS Code host) + swarmforge/ (Babashka scripts)',
  readmeSummary: 'Never commit secrets; macOS/Linux only.',
  seedVision: 'A visual front-end for SwarmForge',
  initialBacklogSummary: '3 tickets: launch panel, tiled agent view, stop command',
};

// BL-262 survey-proposes-populated-contract-01
test('proposeContractFromSurvey populates scope from the survey, not a blank placeholder', () => {
  const contract = proposeContractFromSurvey(FIXTURE_FACTS);

  assert.ok(contract.scope.length > 0);
  assert.ok(contract.scope.some((line) => line.includes(FIXTURE_FACTS.seedVision)));
  assert.ok(contract.scope.some((line) => line.includes('TypeScript') && line.includes('Clojure')));
});

test('proposeContractFromSurvey populates out-of-scope from the survey, not a blank placeholder', () => {
  const contract = proposeContractFromSurvey(FIXTURE_FACTS);

  assert.ok(contract.outOfScope.length > 0);
  assert.ok(contract.outOfScope.some((line) => line.includes('TypeScript') || line.includes('Clojure')));
});

test('proposeContractFromSurvey populates boundaries from the survey, not a blank placeholder', () => {
  const contract = proposeContractFromSurvey(FIXTURE_FACTS);

  assert.ok(contract.boundaries.length > 0);
  assert.ok(contract.boundaries.some((line) => line.includes(FIXTURE_FACTS.readmeSummary)));
});

test('proposeContractFromSurvey carries the surveyed initial backlog summary through unchanged', () => {
  const contract = proposeContractFromSurvey(FIXTURE_FACTS);

  assert.equal(contract.initialBacklogSummary, FIXTURE_FACTS.initialBacklogSummary);
});

test('proposeContractFromSurvey always proposes, awaiting agreement', () => {
  const contract = proposeContractFromSurvey(FIXTURE_FACTS);

  assert.equal(contract.agreement, 'proposed');
});

test('proposeContractFromSurvey degrades gracefully for an empty languages list (still non-blank scope)', () => {
  const contract = proposeContractFromSurvey({ ...FIXTURE_FACTS, languages: [] });

  assert.ok(contract.scope.length > 0);
  assert.ok(contract.scope.every((line) => line.trim().length > 0));
});
