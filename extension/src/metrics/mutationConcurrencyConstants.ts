/**
 * BL-786 / BL-427: single declared per-worker peak RSS for mutation concurrency
 * sizing. Source: docs/reference/BL-427-mutation-worker-rss-measurement.md
 * (821121024 bytes ≈ 783 MB on the 2026-07-16 reference run).
 */
export const DECLARED_PEAK_RSS_PER_WORKER_BYTES = 821121024;

/** BL-427 reserve margin subtracted before sizing workers from free RAM. */
export const DEFAULT_RESERVE_MB = 2048;

export const DEFAULT_RESERVE_BYTES = DEFAULT_RESERVE_MB * 1024 * 1024;
