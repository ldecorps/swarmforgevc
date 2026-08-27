'use strict';

// BL-422: step handlers for "the vitest worker pool and per-worker heap are
// capped so a test run cannot OOM the box". Scenarios 01/02 drive the REAL
// vitest.config.mjs (dynamic import - it is ESM) to prove the wiring is
// real, not just re-test the pure predicate a second time; scenario 03
// drives the real computeWorkerMemoryBudget from the compiled module.
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const VITEST_CONFIG_PATH = path.join(EXTENSION_DIR, 'vitest.config.mjs');
const BUDGET_MODULE = path.join(EXTENSION_DIR, 'out', 'tools', 'vitest-worker-memory-budget.js');

// A host's real CPU count is the exact thing this ticket's cap must sit
// BELOW - if it did not, Vitest's own CPU-count default would satisfy the
// "explicit finite cap" check for the wrong reason.
const HOST_CPU_COUNT = os.cpus().length;

const WITHIN_BUDGET_KNOWN_VALUES = { within: true, over: false };

async function loadVitestConfig() {
  const mod = await import(pathToFileURL(VITEST_CONFIG_PATH).href);
  return mod.default;
}

function registerSteps(registry) {
  registry.define(/^the project's vitest worker-memory budget is read from the shared configuration$/, () => {
    // Non-behavioral Background: the real files are loaded lazily by each
    // scenario's own steps below, not fixtured here.
  });

  // ── vitest-mem-budget-01 ────────────────────────────────────────────────
  registry.define(/^the vitest configuration$/, async (ctx) => {
    ctx.config = await loadVitestConfig();
  });

  registry.define(/^the maximum worker count is read$/, (ctx) => {
    ctx.maxWorkers = ctx.config.test?.poolOptions?.forks?.maxForks;
  });

  registry.define(/^it is an explicit finite cap rather than the CPU-count default$/, (ctx) => {
    if (typeof ctx.maxWorkers !== 'number' || !Number.isFinite(ctx.maxWorkers)) {
      throw new Error(`expected an explicit finite maxForks, got: ${JSON.stringify(ctx.maxWorkers)}`);
    }
    if (ctx.maxWorkers >= HOST_CPU_COUNT) {
      throw new Error(`expected maxForks (${ctx.maxWorkers}) to sit below the host's CPU-count default (${HOST_CPU_COUNT}), not merely be a number`);
    }
  });

  // ── vitest-mem-budget-02 ────────────────────────────────────────────────
  registry.define(/^a worker's heap limit is read$/, (ctx) => {
    ctx.execArgv = ctx.config.test?.poolOptions?.forks?.execArgv || [];
  });

  registry.define(/^an explicit per-worker max-old-space-size cap is set$/, (ctx) => {
    const heapArg = ctx.execArgv.find((a) => /^--max-old-space-size=\d+$/.test(a));
    if (!heapArg) {
      throw new Error(`expected an explicit --max-old-space-size=<MB> in execArgv, got: ${JSON.stringify(ctx.execArgv)}`);
    }
  });

  // ── vitest-mem-budget-03 ────────────────────────────────────────────────
  registry.define(/^(\d+) capped workers each limited to (\d+) MB of heap$/, (ctx, workers, heapMb) => {
    ctx.maxWorkers = Number(workers);
    ctx.perWorkerHeapMB = Number(heapMb);
  });

  registry.define(/^a host with (\d+) MB of RAM$/, (ctx, hostMb) => {
    ctx.hostRamMB = Number(hostMb);
  });

  registry.define(/^the worst-case test-run footprint is evaluated$/, (ctx) => {
    delete require.cache[require.resolve(BUDGET_MODULE)];
    const { computeWorkerMemoryBudget } = require(BUDGET_MODULE);
    ctx.result = computeWorkerMemoryBudget({
      maxWorkers: ctx.maxWorkers,
      perWorkerHeapMB: ctx.perWorkerHeapMB,
      hostRamMB: ctx.hostRamMB,
    });
  });

  registry.define(/^it is reported as (within|over) the safe budget$/, (ctx, label) => {
    if (!(label in WITHIN_BUDGET_KNOWN_VALUES)) {
      throw new Error(`unknown within_budget example value: ${label}`);
    }
    const expected = WITHIN_BUDGET_KNOWN_VALUES[label];
    if (ctx.result.withinBudget !== expected) {
      throw new Error(`expected withinBudget=${expected} (${label}) for ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
