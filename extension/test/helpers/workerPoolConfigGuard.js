'use strict';

// BL-871 invariant 2: "Neither lane carries its own copy of the worker
// ceiling or heap numbers: both read the one shared budget module, so a
// change to the caps cannot apply to one lane and not the other." This is
// the pure check the property test fuzzes and the
// BL-871-property-lane-worker-pool-cap-02 acceptance scenario applies to
// the real vitest.properties.config.mjs. Source-text based (not import) -
// works without compiled out/ present and never executes the config's
// side effects (os.totalmem(), etc), same rationale as
// isolationSetupFilesGuard.js.
const BUDGET_MODULE_BASENAME = 'vitest-worker-memory-budget';
const REQUIRED_BUDGET_SYMBOLS = Object.freeze(['resolveWorkerPoolSize', 'PER_WORKER_HEAP_MB']);

function importsSharedBudgetModule(configSourceText) {
  return configSourceText.includes(BUDGET_MODULE_BASENAME) && REQUIRED_BUDGET_SYMBOLS.every((symbol) => configSourceText.includes(symbol));
}

// A hardcoded copy of the worker ceiling would show up as `maxForks: <bare
// number>` rather than an identifier/expression sourced from the shared
// module's resolved value.
function hasHardcodedMaxForks(configSourceText) {
  return /maxForks\s*:\s*\d/.test(configSourceText);
}

// Likewise for the heap cap: a hardcoded copy would show up as a bare
// numeric literal inside the --max-old-space-size flag rather than an
// interpolated variable sourced from PER_WORKER_HEAP_MB.
function hasHardcodedHeapSize(configSourceText) {
  return /--max-old-space-size=\d/.test(configSourceText);
}

function readsSharedWorkerBudgetOnly(configSourceText) {
  return importsSharedBudgetModule(configSourceText) && !hasHardcodedMaxForks(configSourceText) && !hasHardcodedHeapSize(configSourceText);
}

module.exports = { importsSharedBudgetModule, hasHardcodedMaxForks, hasHardcodedHeapSize, readsSharedWorkerBudgetOnly };
