'use strict';

// BL-1817: step handlers for "The property lane's default per-test budget
// scales with its own contention". Drives the REAL
// propertyLaneDefaultTimeoutMs resolver, never a reimplementation of its
// arithmetic. Handler lands in the SAME commit as the feature (BL-233).

const assert = require('node:assert/strict');
const path = require('node:path');

const HELPER = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'extension',
  'test',
  'helpers',
  'propertyLaneContentionBudget.js'
);
const { propertyLaneDefaultTimeoutMs } = require(HELPER);

const FEATURE = "BL-1817 The property lane's default per-test budget scales with its own contention";

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^the property lane's default per-test budget is resolved for (\d+) forks at a 1-minute load of (\d+(?:\.\d+)?)$/,
    (ctx, forks, load) => {
      ctx.resolved = propertyLaneDefaultTimeoutMs(20000, {
        forksFn: () => Number(forks),
        loadavg1mFn: () => Number(load),
      });
    }
  );

  scoped(/^it is (\d+) milliseconds$/, (ctx, expected) => {
    assert.equal(ctx.resolved, Number(expected));
  });
}

module.exports = { registerSteps };
