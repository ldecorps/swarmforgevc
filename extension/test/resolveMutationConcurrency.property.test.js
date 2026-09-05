'use strict';

const assert = require('node:assert/strict');
const {
  resolveMutationConcurrency,
  readConcurrencyPinFromEnv,
  withStrykerConcurrencyFlag,
  formatMutationConcurrencyReport,
} = require('../out/tools/resolve-mutation-concurrency');
const {
  DECLARED_PEAK_RSS_PER_WORKER_BYTES,
  DEFAULT_RESERVE_BYTES,
} = require('../out/metrics/mutationConcurrencyConstants');

const MB = 1024 * 1024;

test('resolveMutationConcurrency matches BL-786 host examples at declared peak', () => {
  const cases = [
    { cores: 20, freeMb: 10282, expected: 10 },
    { cores: 20, freeMb: 1024, expected: 1 },
    { cores: 4, freeMb: 32768, expected: 4 },
  ];
  for (const { cores, freeMb, expected } of cases) {
    const out = resolveMutationConcurrency({
      freeRamBytes: freeMb * MB,
      coreCount: cores,
      peakRssPerWorkerBytes: DECLARED_PEAK_RSS_PER_WORKER_BYTES,
      reserveBytes: DEFAULT_RESERVE_BYTES,
    });
    assert.equal(out.concurrency, expected, `cores=${cores} freeMb=${freeMb}`);
    assert.equal(out.source, 'computed');
  }
});

test('pin beats computed value', () => {
  const out = resolveMutationConcurrency({
    freeRamBytes: 10282 * MB,
    coreCount: 20,
    peakRssPerWorkerBytes: DECLARED_PEAK_RSS_PER_WORKER_BYTES,
    reserveBytes: DEFAULT_RESERVE_BYTES,
    pin: 1,
  });
  assert.equal(out.concurrency, 1);
  assert.equal(out.source, 'pinned');
});

test('withStrykerConcurrencyFlag appends or replaces --concurrency', () => {
  assert.deepEqual(withStrykerConcurrencyFlag(['run'], 10), ['run', '--concurrency', '10']);
  assert.deepEqual(withStrykerConcurrencyFlag(['run', '--concurrency', '1'], 10), ['run', '--concurrency', '10']);
});

test('readConcurrencyPinFromEnv reads MUTATION_CONCURRENCY pin', () => {
  assert.equal(readConcurrencyPinFromEnv({ MUTATION_CONCURRENCY: '3' }), 3);
  assert.equal(readConcurrencyPinFromEnv({ MUTATION_CONCURRENCY: '' }), undefined);
  assert.equal(readConcurrencyPinFromEnv({}), undefined);
});

test('formatMutationConcurrencyReport includes computed source and inputs', () => {
  const report = formatMutationConcurrencyReport({
    concurrency: 10,
    source: 'computed',
    freeRamBytes: 10282 * MB,
    coreCount: 20,
    peakRssPerWorkerBytes: DECLARED_PEAK_RSS_PER_WORKER_BYTES,
    reserveBytes: DEFAULT_RESERVE_BYTES,
  });
  assert.match(report, /mutation-concurrency: 10 \(computed\)/);
  assert.match(report, /free_ram_mb=10282/);
  assert.match(report, /cores=20/);
});
