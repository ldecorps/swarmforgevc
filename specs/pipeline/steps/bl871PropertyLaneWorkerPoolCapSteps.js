'use strict';

// BL-871: step handlers for "the property lane bounds its worker pool the
// same way the unit lane does". Scenarios 01/02 drive the REAL vitest
// config files (dynamic import - both are ESM) to prove the wiring is
// real, not a second re-test of a pure predicate - same pattern as
// vitestWorkerMemoryBudgetSteps.js's scenario 01/02 and
// bl868PropertyLaneIsolationGuardsSteps.js's scenario 04. Scenario 03
// drives the real resolveWorkerPoolSize from the compiled budget module.
// Scenario 04 runs the REAL `npm run test:properties` (the whole 65-file
// lane) - the one scenario slow enough to earn its own long timeout, per
// this ticket's own approval_context ("Scenario 04 is a full-suite run...
// it earns its place: scenarios 01-03 can all pass on a config that still
// flakes, because they check the declaration rather than the outcome").
// Registered via defineScoped (BL-425 pattern): "the Vitest configuration"
// Given text is close enough to BL-868's own unquoted phrasing that an
// unscoped registration could collide with that feature's steps.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const BUDGET_MODULE = path.join(EXTENSION_DIR, 'out', 'tools', 'vitest-worker-memory-budget.js');
const { hasHardcodedMaxForks, hasHardcodedHeapSize } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'workerPoolConfigGuard'));

const FEATURE_NAME = 'The property lane bounds its worker pool the same way the unit lane does';

function loadBudgetModule() {
  delete require.cache[require.resolve(BUDGET_MODULE)];
  return require(BUDGET_MODULE);
}

function registerSteps(registry) {
  // ── property-lane-worker-pool-cap-01/02 shared Given ────────────────
  registry.defineScoped(
    /^the Vitest configuration "([^"]+)"$/,
    async (ctx, configFile) => {
      ctx.configFile = configFile;
      ctx.configSource = fs.readFileSync(path.join(EXTENSION_DIR, configFile), 'utf8');
      const mod = await import(pathToFileURL(path.join(EXTENSION_DIR, configFile)).href);
      ctx.config = mod.default;
    },
    FEATURE_NAME
  );

  // ── property-lane-worker-pool-cap-01 ─────────────────────────────────
  registry.defineScoped(
    /^it declares a forked pool with a worker ceiling$/,
    (ctx) => {
      if (ctx.config.test?.pool !== 'forks') {
        throw new Error(`expected ${ctx.configFile} to declare pool: 'forks', got: ${JSON.stringify(ctx.config.test?.pool)}`);
      }
      const maxForks = ctx.config.test?.poolOptions?.forks?.maxForks;
      if (typeof maxForks !== 'number' || !Number.isFinite(maxForks) || maxForks < 1) {
        throw new Error(`expected ${ctx.configFile} to declare a finite worker ceiling, got: ${JSON.stringify(maxForks)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it declares a per-worker heap limit$/,
    (ctx) => {
      const execArgv = ctx.config.test?.poolOptions?.forks?.execArgv || [];
      const heapArg = execArgv.find((a) => /^--max-old-space-size=\d+$/.test(a));
      if (!heapArg) {
        throw new Error(`expected ${ctx.configFile} to set an explicit --max-old-space-size in execArgv, got: ${JSON.stringify(execArgv)}`);
      }
    },
    FEATURE_NAME
  );

  // ── property-lane-worker-pool-cap-02 ─────────────────────────────────
  registry.defineScoped(
    /^its worker ceiling and heap limit come from the shared worker budget module$/,
    (ctx) => {
      const { resolveWorkerPoolSize, PER_WORKER_HEAP_MB } = loadBudgetModule();
      const expectedMaxForks = resolveWorkerPoolSize(os.totalmem() / (1024 * 1024));
      const actualMaxForks = ctx.config.test?.poolOptions?.forks?.maxForks;
      if (actualMaxForks !== expectedMaxForks) {
        throw new Error(`expected maxForks to equal resolveWorkerPoolSize's own answer (${expectedMaxForks}) for this host, got ${actualMaxForks}`);
      }
      const execArgv = ctx.config.test?.poolOptions?.forks?.execArgv || [];
      const heapArg = execArgv.find((a) => /^--max-old-space-size=(\d+)$/.test(a));
      const actualHeap = heapArg ? Number(heapArg.match(/=(\d+)$/)[1]) : undefined;
      if (actualHeap !== PER_WORKER_HEAP_MB) {
        throw new Error(`expected the heap cap to equal PER_WORKER_HEAP_MB (${PER_WORKER_HEAP_MB}), got ${actualHeap}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it contains no literal worker count or heap size$/,
    (ctx) => {
      if (hasHardcodedMaxForks(ctx.configSource)) {
        throw new Error(`expected ${ctx.configFile} to carry no literal worker count, but its source matched a hardcoded maxForks`);
      }
      if (hasHardcodedHeapSize(ctx.configSource)) {
        throw new Error(`expected ${ctx.configFile} to carry no literal heap size, but its source matched a hardcoded --max-old-space-size`);
      }
    },
    FEATURE_NAME
  );

  // ── property-lane-worker-pool-cap-03 ─────────────────────────────────
  // "a host with (\d+) MB of RAM" is already registered globally
  // (unscoped) by vitestWorkerMemoryBudgetSteps.js and resolves for any
  // feature with no scoped override - reused here rather than redefined.
  registry.defineScoped(
    /^the property lane resolves its worker pool size$/,
    (ctx) => {
      const { resolveWorkerPoolSize } = loadBudgetModule();
      ctx.result = resolveWorkerPoolSize(ctx.hostRamMB);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the resolved pool size is (\d+)$/,
    (ctx, expected) => {
      if (ctx.result !== Number(expected)) {
        throw new Error(`expected resolved pool size ${expected}, got ${ctx.result}`);
      }
    },
    FEATURE_NAME
  );

  // ── property-lane-worker-pool-cap-04 ─────────────────────────────────
  // BL-871 QA bounce D1 (2026-08-11): direct timed runs of this exact
  // command on this exact reference host measured 418.5s and 450.8s END TO
  // END WHEN PASSING - the prior 300000ms (5min) timeout was shorter than a
  // real passing run and could never succeed regardless of the property
  // lane's health. 900000ms (15min) leaves headroom both above that
  // baseline and above the D2 fix's own raised per-test timeouts on the
  // subprocess-heavy files (bl760/bl787/bl797) landing back-to-back in one
  // fork's critical path under contention.
  registry.defineScoped(
    /^the whole property suite is run on this host$/,
    (ctx) => {
      const result = spawnSync('npm', ['run', 'test:properties'], {
        cwd: EXTENSION_DIR,
        encoding: 'utf8',
        timeout: 900000,
      });
      ctx.result = {
        status: result.status,
        output: `${result.stdout || ''}${result.stderr || ''}`,
        timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
      };
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^every property file reaches a verdict without timing out$/,
    (ctx) => {
      if (ctx.result.timedOut) {
        throw new Error(`expected the full property suite to finish within budget, but it timed out:\n${ctx.result.output.slice(-4000)}`);
      }
      if (ctx.result.status !== 0) {
        throw new Error(`expected the full property suite to pass, got exit ${ctx.result.status}:\n${ctx.result.output.slice(-4000)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
