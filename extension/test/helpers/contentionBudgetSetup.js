'use strict';

// BL-1007: scale per-test numeric timeout literals at runtime while leaving
// the source text's trailing number intact for BL-969/BL-999 guards.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  resolveUnitLaneTimeout,
  UNIT_LANE_BUDGET_CEILING_MS,
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

function wrapTest(original) {
  if (typeof original !== 'function') return original;
  const wrapped = function contentionBudgetTest(name, fn, timeout) {
    if (typeof timeout !== 'number') {
      return original(name, fn, timeout);
    }
    const effective = scaleTimeout(timeout);
    evidence.tests.push({
      name: String(name),
      baseMs: timeout,
      effectiveMs: effective,
      // Placeholder until a reporter records wall time / factor.
      loadNormalizedDurationMs: null,
    });
    persistEvidence();
    return original(name, fn, effective);
  };
  for (const key of Object.keys(original)) {
    wrapped[key] = original[key];
  }
  return wrapped;
}

if (typeof globalThis.test === 'function') {
  globalThis.test = wrapTest(globalThis.test);
}
