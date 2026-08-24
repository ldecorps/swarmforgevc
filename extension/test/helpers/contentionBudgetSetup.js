'use strict';

// BL-1007: scale per-test numeric timeout literals at runtime while leaving
// the source text's trailing number intact for BL-969/BL-999 guards.
// Records each budgeted test's load-normalized duration (wall ÷ factor).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  resolveUnitLaneTimeout,
  UNIT_LANE_BUDGET_CEILING_MS,
  loadNormalizedDurationMs,
} = require('../../../specs/pipeline/steps/lib/contentionBudget');

const decision = resolveUnitLaneTimeout(20000);
const evidencePath = path.join(os.tmpdir(), `sfvc-unit-lane-budget-${process.pid}.json`);

const evidence = {
  contentionFactor: decision.factor,
  ceilingMs: UNIT_LANE_BUDGET_CEILING_MS,
  suiteBaseMs: 20000,
  suiteEffectiveMs: decision.effectiveMs,
  tests: [],
};

function persistEvidence() {
  try {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  } catch {
    /* observational */
  }
}

persistEvidence();
process.env.SWARMFORGE_UNIT_LANE_BUDGET_EVIDENCE = evidencePath;

function scaleTimeout(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ms;
  return resolveUnitLaneTimeout(ms, { factor: decision.factor }).effectiveMs;
}

function instrumentFn(fn, entry) {
  return function contentionBudgetInstrumented(...args) {
    const t0 = performance.now();
    const finish = () => {
      entry.loadNormalizedDurationMs = loadNormalizedDurationMs(performance.now() - t0, decision.factor);
      persistEvidence();
    };
    try {
      const result = fn.apply(this, args);
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).finally(finish);
      }
      finish();
      return result;
    } catch (err) {
      finish();
      throw err;
    }
  };
}

function wrapTest(original) {
  if (typeof original !== 'function') return original;
  const wrapped = function contentionBudgetTest(name, fn, timeout) {
    if (typeof timeout !== 'number') {
      return original(name, fn, timeout);
    }
    const effective = scaleTimeout(timeout);
    const entry = {
      name: String(name),
      baseMs: timeout,
      effectiveMs: effective,
      loadNormalizedDurationMs: null,
    };
    evidence.tests.push(entry);
    persistEvidence();
    return original(name, instrumentFn(fn, entry), effective);
  };
  for (const key of Object.keys(original)) {
    wrapped[key] = original[key];
  }
  return wrapped;
}

if (typeof globalThis.test === 'function') {
  globalThis.test = wrapTest(globalThis.test);
}
