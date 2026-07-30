const assert = require('node:assert/strict');
const {
  operatorDangerTier,
  decideOperatorVerbConfirm,
  decideOperatorConfirmCallback,
  decideOperatorConfirmCallbackVerb,
  OPERATOR_CALLBACK_DATA,
} = require('../out/tools/telegramCursorOperatorCore');

test('BL-702: soft verbs are light-confirm tier', () => {
  assert.equal(operatorDangerTier('/compile'), 'soft');
  assert.equal(operatorDangerTier('/pull'), 'soft');
  assert.equal(operatorDangerTier('/pause'), 'soft');
  assert.equal(operatorDangerTier('/redeploy'), 'soft');
});

test('BL-702: hard verbs need two-step confirm tier', () => {
  assert.equal(operatorDangerTier('/restart'), 'hard');
  assert.equal(operatorDangerTier('/bounce bridge'), 'hard');
  assert.equal(operatorDangerTier('/ensure'), 'hard');
});

test('BL-702: read verbs execute without confirm', () => {
  const d = decideOperatorVerbConfirm('/status', undefined);
  assert.deepEqual(d, { action: 'execute', verb: '/status', args: undefined });
  const doctor = decideOperatorVerbConfirm('/doctor', undefined);
  assert.deepEqual(doctor, { action: 'execute', verb: '/doctor', args: undefined });
});

test('BL-702: soft verb prompts light confirm', () => {
  const d = decideOperatorVerbConfirm('/compile', undefined);
  assert.deepEqual(d, { action: 'prompt-confirm', tier: 'soft', verb: '/compile', args: undefined });
});

test('BL-702: /confirm-off clears pending', () => {
  const d = decideOperatorVerbConfirm('/confirm-off', { tier: 'hard', verb: '/bounce' });
  assert.deepEqual(d, { action: 'clear-pending' });
});

test('BL-702: confirm callback executes only when pending exists', () => {
  const ok = decideOperatorConfirmCallback({ tier: 'hard', verb: '/restart' }, OPERATOR_CALLBACK_DATA.confirm);
  assert.deepEqual(ok, { action: 'execute', verb: '/restart', args: undefined });
  const stale = decideOperatorConfirmCallback(undefined, OPERATOR_CALLBACK_DATA.confirm);
  assert.deepEqual(stale, { action: 'ignore' });
  const cancel = decideOperatorConfirmCallback({ tier: 'soft', verb: '/compile' }, OPERATOR_CALLBACK_DATA.cancel);
  assert.deepEqual(cancel, { action: 'cancel-pending' });
});

test('BL-702: legacy verb-match confirm helper still works', () => {
  const ok = decideOperatorConfirmCallbackVerb({ tier: 'hard', verb: '/restart' }, '/restart');
  assert.deepEqual(ok, { action: 'execute', verb: '/restart', args: undefined });
  const stale = decideOperatorConfirmCallbackVerb({ tier: 'hard', verb: '/restart' }, '/bounce');
  assert.deepEqual(stale, { action: 'ignore' });
});
