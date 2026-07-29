const assert = require('node:assert/strict');
const { detectProgressLocale } = require('../out/bridge/progressLocale');

test('detectProgressLocale picks French for accented prompts', () => {
  assert.equal(detectProgressLocale('tu es là ?'), 'fr');
  assert.equal(detectProgressLocale('explique-moi ce bug'), 'fr');
});

test('detectProgressLocale picks English for plain English prompts', () => {
  assert.equal(detectProgressLocale('are you there?'), 'en');
  assert.equal(detectProgressLocale('please fix the notifier'), 'en');
});

test('detectProgressLocale defaults to English on empty input', () => {
  assert.equal(detectProgressLocale(''), 'en');
});
