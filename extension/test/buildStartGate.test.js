const assert = require('node:assert/strict');
const { evaluateBuildStartGate } = require('../out/onboarding/buildStartGate');
const { renderContractYaml } = require('../out/onboarding/contractView');

const BASE_CONTRACT = {
  scope: ['Build the thing.'],
  outOfScope: ['Rewrite the stack.'],
  boundaries: ['Respect the README.'],
  initialBacklogSummary: '3 tickets queued.',
};

function contractYaml(agreement) {
  return renderContractYaml({ ...BASE_CONTRACT, agreement });
}

// BL-262 gate-decides-by-agreement-state-02 (Scenario Outline, all 5 rows)
test('evaluateBuildStartGate allows dispatch for an agreed contract', () => {
  const decision = evaluateBuildStartGate(contractYaml('agreed'));

  assert.deepEqual(decision, { decision: 'allow' });
});

test('evaluateBuildStartGate holds for a proposed contract, naming the reason', () => {
  const decision = evaluateBuildStartGate(contractYaml('proposed'));

  assert.equal(decision.decision, 'hold');
  assert.match(decision.reason, /proposed/);
});

test('evaluateBuildStartGate holds for a pending contract, naming the reason', () => {
  const decision = evaluateBuildStartGate(contractYaml('pending'));

  assert.equal(decision.decision, 'hold');
  assert.match(decision.reason, /pending/);
});

test('evaluateBuildStartGate holds when the contract is missing (undefined input), never crashing', () => {
  const decision = evaluateBuildStartGate(undefined);

  assert.equal(decision.decision, 'hold');
  assert.match(decision.reason, /missing/);
});

test('evaluateBuildStartGate holds when the contract is malformed, never crashing', () => {
  const decision = evaluateBuildStartGate('scope: [unclosed');

  assert.equal(decision.decision, 'hold');
  assert.match(decision.reason, /malformed/);
});

// BL-262 reopen-reholds-gate-04
test('flipping an agreed contract back to pending re-holds the gate', () => {
  const agreed = evaluateBuildStartGate(contractYaml('agreed'));
  assert.equal(agreed.decision, 'allow');

  const reopened = evaluateBuildStartGate(contractYaml('pending'));
  assert.equal(reopened.decision, 'hold');
});

test('evaluateBuildStartGate holds for an unknown agreement value rather than defaulting to allow', () => {
  const yaml = renderContractYaml({ ...BASE_CONTRACT, agreement: 'sort-of' });

  const decision = evaluateBuildStartGate(yaml);

  assert.equal(decision.decision, 'hold');
});
