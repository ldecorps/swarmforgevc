'use strict';

// BL-871: step handlers for "the property lane bounds its worker pool the
// same way the unit lane does". Scenarios 01/02 drive the REAL vitest
// config files (dynamic import - both are ESM) to prove the wiring is
// real, not a second re-test of a pure predicate - same pattern as
// vitestWorkerMemoryBudgetSteps.js's scenario 01/02 and
// bl868PropertyLaneIsolationGuardsSteps.js's scenario 04. Scenario 03
// drives the real resolveWorkerPoolSize from the compiled budget module.
// Registered via defineScoped (BL-425 pattern): "the Vitest configuration"
// Given text is close enough to BL-868's own unquoted phrasing that an
// unscoped registration could collide with that feature's steps.
//
// BL-1651: the former scenario 04 (spawning the whole property lane
// inside this acceptance harness via spawnSync) is retired - see the
// removed handler's own note further down and BL-1651's scenario 05.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
      const { resolveVitestWorkerPool, resolveFreeCoresCeiling, PER_WORKER_HEAP_MB } = loadBudgetModule();
      // BL-1651: mirrors the REAL config's own composition exactly
      // (pack/platform/override/rotation/defaultCeiling via
      // resolveFreeCoresCeiling) - a bare resolveWorkerPoolSize(totalmem)
      // (pre-BL-1651) never considered load at all and mismatched on any
      // host whose free-cores ceiling resolves above MAX_WORKERS (BL-1348/
      // BL-1336's own ceiling, landed after this scenario was authored).
      const expectedMaxForks = resolveVitestWorkerPool({
        pack: process.env.SWARMFORGE_PACK,
        rotation: process.env.SWARMFORGE_ROTATION,
        platform: os.platform(),
        override: process.env.SWARMFORGE_VITEST_MAX_FORKS,
        hostRamMB: os.totalmem() / (1024 * 1024),
        defaultCeiling: resolveFreeCoresCeiling(os.cpus().length, os.loadavg()[1]),
      });
      const actualMaxForks = ctx.config.test?.poolOptions?.forks?.maxForks;
      if (actualMaxForks !== expectedMaxForks) {
        throw new Error(`expected maxForks to equal resolveVitestWorkerPool's own answer (${expectedMaxForks}) for this host, got ${actualMaxForks}`);
      }
      const execArgv = ctx.config.test?.poolOptions?.forks?.execArgv || [];
      const heapArg = execArgv.find((a) => /^--max-old-space-size=(\d+)$/.test(a));
      const actualHeap = heapArg ? Number(heapArg.match(/=(\d+)$/)[1]) : undefined;
      // BL-1651: this config's own heap cap is now resolvePropertyLaneHeapMB's
      // host-derived value (memory free at spawn, divided across the forks
      // that will actually run), never the unit lane's fixed
      // PER_WORKER_HEAP_MB - re-reading os.freemem() here would compare
      // against a DIFFERENT instant than the config's own read at import
      // time, on a host where free memory is not stable (this ticket's own
      // reason for existing). The floor resolvePropertyLaneHeapMB always
      // honors is the one timing-independent invariant to pin here;
      // hasHardcodedHeapSize below (never a bare literal) covers the rest.
      if (typeof actualHeap !== 'number' || !Number.isFinite(actualHeap) || actualHeap < PER_WORKER_HEAP_MB) {
        throw new Error(`expected the heap cap to be a finite number at least PER_WORKER_HEAP_MB's floor (${PER_WORKER_HEAP_MB}), got ${actualHeap}`);
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

  // property-lane-worker-pool-cap-04 (spawning the whole property lane
  // inside this acceptance harness) is RETIRED by BL-1651: nesting a
  // 400s+, multi-fork, memory-hungry child inside a node:test-based
  // harness process via spawnSync crashed the harness itself (SIGABRT,
  // BL-1651's own standing-red evidence), independent of the lane's own
  // health - the real command it ran passes cleanly run directly, which
  // is what BL-1651's own qa_e2e_procedure and scenario 04 now verify
  // instead. See BL-1651's scenario 05 for the retirement itself.
}

module.exports = { registerSteps };
