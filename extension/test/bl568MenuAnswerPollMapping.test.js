'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  bl568MenuAnswerPollMapping,
  bl568PlanMenuAnswerDrive,
  bl568FingerprintMatches,
  bl568TextFallbackMessage,
} = require('../out/notify/telegramClient');

test('BL-568 bl568MenuAnswerPollMapping records menu-answer kind', () => {
  const m = bl568MenuAnswerPollMapping({
    role: 'coder',
    paneId: 'p',
    options: ['a', 'b'],
    fingerprint: 'fp',
    multiSelect: true,
    freeTextOptionIndexes: [1],
  });
  assert.equal(m.kind, 'menu-answer');
  assert.equal(m.role, 'coder');
  assert.equal(m.multiSelect, true);
  assert.deepEqual(m.freeTextOptionIndexes, [1]);
});

test('BL-568 stale fingerprint drops without inject', () => {
  const m = bl568MenuAnswerPollMapping({
    role: 'coder',
    paneId: 'p',
    options: ['a'],
    fingerprint: 'old',
  });
  const plan = bl568PlanMenuAnswerDrive({ mapping: m, liveFingerprint: 'new', optionIds: [0] });
  assert.equal(plan.action, 'drop');
  assert.equal(plan.reason, 'stale-fingerprint');
});

test('BL-568 matching fingerprint injects voted indexes', () => {
  const m = bl568MenuAnswerPollMapping({
    role: 'coder',
    paneId: 'p',
    options: ['a', 'Type something'],
    fingerprint: 'fp',
    freeTextOptionIndexes: [1],
  });
  assert.equal(bl568FingerprintMatches('fp', 'fp'), true);
  const plan = bl568PlanMenuAnswerDrive({ mapping: m, liveFingerprint: 'fp', optionIds: [1] });
  assert.equal(plan.action, 'inject');
  assert.equal(plan.freeTextFollowUp, true);
});

test('BL-568 text fallback names RC', () => {
  assert.match(bl568TextFallbackMessage('Q?', 'too-many-options', 'session_x'), /session_x/);
});
