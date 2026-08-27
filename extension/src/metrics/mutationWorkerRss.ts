/**
 * BL-427: measure-first slice for a RAM-aware Stryker mutation-run
 * concurrency. extension/stryker.config.json today sets a fixed
 * "concurrency": 4 with no regard for free RAM; each unit of Stryker
 * concurrency is a separate worker process (Stryker's vitest-runner
 * hardcodes pool:'threads'+maxThreads:1, so a worker's RSS is roughly one
 * Vitest thread + Node heap). This module holds the two pure pieces the
 * adaptive follow-up ticket will wire in: reducing raw per-worker RSS
 * samples to each worker's PEAK, and recommending a concurrency from free
 * RAM headroom. Actually changing stryker.config.json's concurrency is
 * explicitly out of scope here (named follow-up, multi-slice-wiring rule).
 */

export interface RssSample {
  workerId: string;
  rssBytes: number;
  atMs: number;
}

// Pure: raw samples -> each worker's peak (max) RSS over its lifetime, never
// its last or first sample. An unseen worker is simply absent from the
// result, never defaulted to 0.
export function computePeakRssPerWorker(samples: RssSample[]): Record<string, number> {
  const peaks: Record<string, number> = {};
  for (const sample of samples) {
    const current = peaks[sample.workerId];
    if (current === undefined || sample.rssBytes > current) {
      peaks[sample.workerId] = sample.rssBytes;
    }
  }
  return peaks;
}

export interface ConcurrencyRecommendationInput {
  freeRamBytes: number;
  peakRssPerWorkerBytes: number;
  coreCount: number;
  reserveBytes: number;
}

// Pure: clamp(floor((freeRamBytes - reserveBytes) / peakRssPerWorkerBytes), 1,
// coreCount). Floored at 1 so a starved host still recommends running the
// mutation suite (never zero workers); capped at coreCount because RAM
// headroom can never buy more parallelism than the host has cores; the
// reserve margin is subtracted BEFORE dividing so a host is never sized to
// run to zero-free RAM.
export function recommendMutationConcurrency({
  freeRamBytes,
  peakRssPerWorkerBytes,
  coreCount,
  reserveBytes,
}: ConcurrencyRecommendationInput): number {
  const usableBytes = Math.max(0, freeRamBytes - reserveBytes);
  const workersByRam = Math.floor(usableBytes / peakRssPerWorkerBytes);
  return Math.max(1, Math.min(coreCount, workersByRam));
}
