const assert = require('node:assert/strict');
const { computePeakRssPerWorker, recommendMutationConcurrency } = require('../out/metrics/mutationWorkerRss');

// ── computePeakRssPerWorker (pure) - BL-427 profile-mutation-worker-rss-02 ──

test('a single worker with multiple samples records its maximum sample, not its last', () => {
  const samples = [
    { workerId: '111', rssBytes: 100, atMs: 1 },
    { workerId: '111', rssBytes: 300, atMs: 2 },
    { workerId: '111', rssBytes: 200, atMs: 3 },
  ];
  assert.deepEqual(computePeakRssPerWorker(samples), { '111': 300 });
});

test('each worker gets its own independent peak, not a shared/merged one', () => {
  const samples = [
    { workerId: '111', rssBytes: 500, atMs: 1 },
    { workerId: '222', rssBytes: 100, atMs: 1 },
    { workerId: '222', rssBytes: 900, atMs: 2 },
    { workerId: '111', rssBytes: 200, atMs: 2 },
  ];
  assert.deepEqual(computePeakRssPerWorker(samples), { '111': 500, '222': 900 });
});

test('an empty sample stream produces an empty peak map', () => {
  assert.deepEqual(computePeakRssPerWorker([]), {});
});

test('a single sample is its own peak', () => {
  assert.deepEqual(computePeakRssPerWorker([{ workerId: 'w', rssBytes: 42, atMs: 1 }]), { w: 42 });
});

// ── recommendMutationConcurrency (pure) - BL-427 profile-mutation-worker-rss-01 ──
// Boundary fixtures mirror the feature file's Examples table exactly (MB
// values x 1024*1024, matching production bytes usage) so a mutated example
// value and a mutated formula both fail the same assertions.

const MB = 1024 * 1024;

test('headroom below one worker\'s peak still recommends at least one worker (floor at 1, never 0)', () => {
  const workers = recommendMutationConcurrency({
    freeRamBytes: 3000 * MB,
    reserveBytes: 1000 * MB,
    peakRssPerWorkerBytes: 4000 * MB,
    coreCount: 20,
  });
  assert.equal(workers, 1);
});

test('headroom for exactly 2 workers (just under 3) recommends 2, not 3 (floor division, k-vs-k+1 boundary)', () => {
  const workers = recommendMutationConcurrency({
    freeRamBytes: 9000 * MB,
    reserveBytes: 1000 * MB,
    peakRssPerWorkerBytes: 4000 * MB,
    coreCount: 20,
  });
  assert.equal(workers, 2);
});

test('headroom for exactly 3 workers recommends 3', () => {
  const workers = recommendMutationConcurrency({
    freeRamBytes: 13000 * MB,
    reserveBytes: 1000 * MB,
    peakRssPerWorkerBytes: 4000 * MB,
    coreCount: 20,
  });
  assert.equal(workers, 3);
});

test('headroom for far more workers than cores caps at coreCount, never exceeds it', () => {
  const workers = recommendMutationConcurrency({
    freeRamBytes: 90000 * MB,
    reserveBytes: 1000 * MB,
    peakRssPerWorkerBytes: 4000 * MB,
    coreCount: 20,
  });
  assert.equal(workers, 20);
});

test('the reserve margin is subtracted before dividing, not ignored', () => {
  // Same free RAM and peak as the k=2 boundary case above, but with NO
  // reserve the naive (unreserved) division would recommend one worker
  // more (10000MB / 4000MB = 2.5 -> 2 either way at this exact value, so
  // pick numbers where reserve vs no-reserve diverge): 12000MB free,
  // 4000MB peak, 20 cores. With a 0 reserve: floor(12000/4000) = 3. With a
  // 1000MB reserve: floor(11000/4000) = 2. A recommendation that ignored
  // the reserve would return 3 instead of 2.
  const withoutReserve = recommendMutationConcurrency({
    freeRamBytes: 12000 * MB,
    reserveBytes: 0,
    peakRssPerWorkerBytes: 4000 * MB,
    coreCount: 20,
  });
  const withReserve = recommendMutationConcurrency({
    freeRamBytes: 12000 * MB,
    reserveBytes: 1000 * MB,
    peakRssPerWorkerBytes: 4000 * MB,
    coreCount: 20,
  });
  assert.equal(withoutReserve, 3);
  assert.equal(withReserve, 2);
});

test('a reserve at or above total free RAM still floors at one worker, never zero or negative', () => {
  const workers = recommendMutationConcurrency({
    freeRamBytes: 2000 * MB,
    reserveBytes: 5000 * MB,
    peakRssPerWorkerBytes: 4000 * MB,
    coreCount: 20,
  });
  assert.equal(workers, 1);
});

test('exactly enough headroom for coreCount workers (no more, no less) recommends coreCount, proving the cap boundary is <=, not <', () => {
  const workers = recommendMutationConcurrency({
    freeRamBytes: 1000 * MB + 20 * 4000 * MB,
    reserveBytes: 1000 * MB,
    peakRssPerWorkerBytes: 4000 * MB,
    coreCount: 20,
  });
  assert.equal(workers, 20);
});
