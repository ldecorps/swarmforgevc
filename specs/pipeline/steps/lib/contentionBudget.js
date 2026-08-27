'use strict';

// BL-1007: load-relative unit-lane budgets. Compile-free CommonJS so
// extension/vitest.config.mjs can require it before tsc (same posture as
// testTimeoutParser.js). Pure arithmetic + optional injected load readers.

const os = require('node:os');

/** Absolute ceiling (ms). Implementer call: covers 45000×2 spill, clamps extremes. */
const UNIT_LANE_BUDGET_CEILING_MS = 120000;

function sampleContentionFactor(loadavg1mFn, cpuCountFn) {
  const loadFn = typeof loadavg1mFn === 'function' ? loadavg1mFn : () => os.loadavg()[0];
  const coresFn = typeof cpuCountFn === 'function' ? cpuCountFn : () => os.cpus().length;
  try {
    const load = Number(loadFn());
    const cores = Number(coresFn());
    if (!Number.isFinite(load) || !Number.isFinite(cores) || cores <= 0) return null;
    return load / cores;
  } catch {
    return null;
  }
}

function usableFactor(factor) {
  if (factor === null || factor === undefined || factor === 'unusable') return null;
  const f = Number(factor);
  if (!Number.isFinite(f) || f <= 0) return null;
  return f;
}

/**
 * Wall-clock duration divided by the applied contention factor (floored at 1).
 * Unusable factor → wall unchanged (quiet-host baseline).
 */
function loadNormalizedDurationMs(wallMs, factor) {
  const wall = Number(wallMs);
  if (!Number.isFinite(wall) || wall < 0) return null;
  const f = usableFactor(factor);
  const denom = f === null ? 1 : Math.max(1, f);
  return wall / denom;
}

/**
 * Effective wall-clock budget from a statically parseable base.
 * factor < 1 or unusable → base; else min(ceiling, base * factor) with factor
 * floored at 1 (Examples: 0.25→base, 2→2×base, 1000→ceiling).
 */
function effectiveBudgetMs(baseMs, factor, ceilingMs = UNIT_LANE_BUDGET_CEILING_MS) {
  const base = Number(baseMs);
  const ceil = Number(ceilingMs);
  if (!Number.isFinite(base) || base <= 0) return baseMs;
  if (!Number.isFinite(ceil) || ceil <= 0) return base;
  const f = usableFactor(factor);
  if (f === null) return base;
  return Math.min(ceil, Math.round(base * Math.max(1, f)));
}

function resolveUnitLaneTimeout(baseMs, opts = {}) {
  const factor =
    'factor' in opts ? opts.factor : sampleContentionFactor(opts.loadavg1mFn, opts.cpuCountFn);
  const ceiling = opts.ceilingMs ?? UNIT_LANE_BUDGET_CEILING_MS;
  return {
    baseMs: Number(baseMs),
    factor,
    ceilingMs: ceiling,
    effectiveMs: effectiveBudgetMs(baseMs, factor, ceiling),
  };
}

/** True iff every budgeted test entry carries a finite load-normalized duration. */
function evidenceTestsAreAttributable(tests) {
  if (!Array.isArray(tests) || tests.length === 0) return false;
  return tests.every(
    (t) =>
      t != null &&
      typeof t.loadNormalizedDurationMs === 'number' &&
      Number.isFinite(t.loadNormalizedDurationMs)
  );
}

module.exports = {
  UNIT_LANE_BUDGET_CEILING_MS,
  sampleContentionFactor,
  usableFactor,
  loadNormalizedDurationMs,
  effectiveBudgetMs,
  resolveUnitLaneTimeout,
  evidenceTestsAreAttributable,
};
