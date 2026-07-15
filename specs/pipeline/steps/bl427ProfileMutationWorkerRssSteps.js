'use strict';

// BL-427: step handlers for "recommend a mutation-run worker concurrency
// from free-RAM headroom". Drives the REAL compiled
// mutationWorkerRss.js (recommendMutationConcurrency, computePeakRssPerWorker)
// so the acceptance run proves the same module the unit tests cover, never a
// parallel reimplementation of the formula.
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'mutationWorkerRss.js');
const MB = 1024 * 1024;

function registerSteps(registry) {
  // ── profile-mutation-worker-rss-01 (Scenario Outline) ───────────────────
  registry.define(/^(\d+) MB of free RAM$/, (ctx, freeMb) => {
    ctx.freeMb = Number(freeMb);
  });

  registry.define(/^a reserve margin of (\d+) MB$/, (ctx, reserveMb) => {
    ctx.reserveMb = Number(reserveMb);
  });

  registry.define(/^a measured peak per-worker RSS of (\d+) MB$/, (ctx, peakMb) => {
    ctx.peakMb = Number(peakMb);
  });

  registry.define(/^(\d+) CPU cores$/, (ctx, cores) => {
    ctx.cores = Number(cores);
  });

  registry.define(/^the recommended mutation concurrency is computed$/, (ctx) => {
    const { recommendMutationConcurrency } = require(MODULE_PATH);
    ctx.recommendedWorkers = recommendMutationConcurrency({
      freeRamBytes: ctx.freeMb * MB,
      reserveBytes: ctx.reserveMb * MB,
      peakRssPerWorkerBytes: ctx.peakMb * MB,
      coreCount: ctx.cores,
    });
  });

  registry.define(/^the recommendation is (\d+) workers$/, (ctx, workers) => {
    const expected = Number(workers);
    if (ctx.recommendedWorkers !== expected) {
      throw new Error(`expected a recommendation of ${expected} workers, got ${ctx.recommendedWorkers}`);
    }
  });

  // ── profile-mutation-worker-rss-02 ───────────────────────────────────────
  registry.define(/^a stream of per-worker RSS samples over a run$/, (ctx) => {
    // Non-monotonic per worker (peak is neither first nor last sample) so a
    // parser that returns the last/first sample instead of the true max
    // fails this scenario.
    ctx.samples = [
      { workerId: 'w1', rssBytes: 200 * MB, atMs: 1000 },
      { workerId: 'w2', rssBytes: 150 * MB, atMs: 1000 },
      { workerId: 'w1', rssBytes: 500 * MB, atMs: 2000 },
      { workerId: 'w2', rssBytes: 600 * MB, atMs: 2000 },
      { workerId: 'w1', rssBytes: 350 * MB, atMs: 3000 },
      { workerId: 'w2', rssBytes: 400 * MB, atMs: 3000 },
    ];
    ctx.expectedPeaks = { w1: 500 * MB, w2: 600 * MB };
  });

  registry.define(/^the samples are reduced to a per-worker figure$/, (ctx) => {
    const { computePeakRssPerWorker } = require(MODULE_PATH);
    ctx.peaks = computePeakRssPerWorker(ctx.samples);
  });

  registry.define(/^each worker's recorded RSS is the maximum sample seen for that worker$/, (ctx) => {
    for (const [workerId, expectedPeak] of Object.entries(ctx.expectedPeaks)) {
      if (ctx.peaks[workerId] !== expectedPeak) {
        throw new Error(
          `expected worker ${workerId}'s peak to be ${expectedPeak}, got ${ctx.peaks[workerId]} (all peaks: ${JSON.stringify(ctx.peaks)})`
        );
      }
    }
  });
}

module.exports = { registerSteps };
