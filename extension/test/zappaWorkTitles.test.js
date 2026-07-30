const assert = require('node:assert/strict');
const { ZAPPA_WORK_TITLES } = require('../out/bridge/zappaWorkTitlesData');
const { pickZappaWorkTitle, stableIndex, zappaPhraseForTool } = require('../out/bridge/zappaWorkTitles');

test('ZAPPA_WORK_TITLES is a large baked-in catalog', () => {
  assert.ok(ZAPPA_WORK_TITLES.length >= 700);
  assert.ok(ZAPPA_WORK_TITLES.includes('Peaches En Regalia'));
  assert.ok(!ZAPPA_WORK_TITLES.includes('---'));
});

test('pickZappaWorkTitle is stable for the same seed', () => {
  const a = pickZappaWorkTitle('grep');
  const b = pickZappaWorkTitle('grep');
  assert.equal(a, b);
  assert.notEqual(pickZappaWorkTitle('grep'), pickZappaWorkTitle('glob'));
});

test('zappaPhraseForTool localizes fallback tool verbs', () => {
  assert.match(zappaPhraseForTool('WeirdTool', 'fr', 'running'), /-ise «WeirdTool»/);
  assert.match(zappaPhraseForTool('WeirdTool', 'en', 'running'), /-ing «WeirdTool»/);
});

test('stableIndex stays in range', () => {
  assert.ok(stableIndex('x', 10) < 10);
});
