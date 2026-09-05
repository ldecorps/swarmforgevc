'use strict';

const assert = require('node:assert/strict');
const {
  standingRedSignal,
  describeStandingRedSignal,
  readStandingRedThresholds,
  DEFAULT_STANDING_RED_MAX_COUNT,
  DEFAULT_STANDING_RED_MAX_AGE_DAYS,
} = require('../out/metrics/standingRedSignal');
const { mkTmpDir } = require('./helpers/tmpDir');
const fs = require('node:fs');
const path = require('node:path');

const THRESHOLDS = { maxCount: 10, maxAgeDays: 7 };

function report(overrides) {
  return { count: 0, oldest_age_days: null, unowned: [], ...overrides };
}

test('BL-1429: every threshold clear recommends nothing', () => {
  assert.equal(standingRedSignal(report({ count: 3, oldest_age_days: 2 }), THRESHOLDS), null);
});

test('BL-1429: count over threshold recommends cap 1, signal count', () => {
  assert.deepEqual(standingRedSignal(report({ count: 11 }), THRESHOLDS), { recommendedCap: 1, signal: 'count' });
});

test('BL-1429: count AT the threshold does not recommend (strictly "more than")', () => {
  assert.equal(standingRedSignal(report({ count: 10 }), THRESHOLDS), null);
});

test('BL-1429: age over threshold recommends cap 1, signal age', () => {
  assert.deepEqual(standingRedSignal(report({ count: 3, oldest_age_days: 8 }), THRESHOLDS), { recommendedCap: 1, signal: 'age' });
});

test('BL-1429: age AT the threshold does not recommend (strictly "older than")', () => {
  assert.equal(standingRedSignal(report({ count: 3, oldest_age_days: 7 }), THRESHOLDS), null);
});

test('BL-1429: any unowned row recommends cap 1, signal unowned, regardless of count/age', () => {
  assert.deepEqual(
    standingRedSignal(report({ count: 3, oldest_age_days: 2, unowned: [{ file: 'x' }] }), THRESHOLDS),
    { recommendedCap: 1, signal: 'unowned' }
  );
});

test('BL-1429: unowned takes priority when multiple thresholds cross at once', () => {
  assert.deepEqual(
    standingRedSignal(report({ count: 99, oldest_age_days: 99, unowned: [{ file: 'x' }] }), THRESHOLDS),
    { recommendedCap: 1, signal: 'unowned' }
  );
});

test('BL-1429: describeStandingRedSignal names each signal in plain language', () => {
  assert.equal(describeStandingRedSignal('count'), 'the red count');
  assert.equal(describeStandingRedSignal('age'), "the oldest red's age");
  assert.equal(describeStandingRedSignal('unowned'), 'an unowned red');
});

test('BL-1429: readStandingRedThresholds defaults to 10/7 when the conf is absent', () => {
  const root = mkTmpDir('bl1429-thresholds-');
  assert.deepEqual(readStandingRedThresholds(root), {
    maxCount: DEFAULT_STANDING_RED_MAX_COUNT,
    maxAgeDays: DEFAULT_STANDING_RED_MAX_AGE_DAYS,
  });
});

test('BL-1429: readStandingRedThresholds reads both keys from swarmforge.conf', () => {
  const root = mkTmpDir('bl1429-thresholds-');
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    'config standing_red_max_count 30\nconfig standing_red_max_age_days 14\n'
  );
  assert.deepEqual(readStandingRedThresholds(root), { maxCount: 30, maxAgeDays: 14 });
});

test('BL-1429: readStandingRedThresholds degrades a malformed value to the default', () => {
  const root = mkTmpDir('bl1429-thresholds-');
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config standing_red_max_count not-a-number\n');
  assert.deepEqual(readStandingRedThresholds(root), {
    maxCount: DEFAULT_STANDING_RED_MAX_COUNT,
    maxAgeDays: DEFAULT_STANDING_RED_MAX_AGE_DAYS,
  });
});
