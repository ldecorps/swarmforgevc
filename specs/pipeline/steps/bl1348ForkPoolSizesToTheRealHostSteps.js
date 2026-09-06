'use strict';

// BL-1348: step handlers for "The vitest fork pool sizes to the host the
// swarm actually runs on". Drives the REAL resolveVitestWorkerPool /
// computeWorkerMemoryBudget (extension/out/tools/vitest-worker-memory-budget) -
// never a reimplementation of the composition.

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  resolveVitestWorkerPool,
  computeWorkerMemoryBudget,
  PER_WORKER_HEAP_MB,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'vitest-worker-memory-budget'));

const FEATURE = 'BL-1348 The vitest fork pool sizes to the host the swarm actually runs on';

const KNOWN_PACKS = new Set(['mono-router', 'full-forge']);
const KNOWN_PLATFORMS = new Set(['linux', 'darwin']);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a (\S+) pack on (\S+) with (\d+) MB of RAM$/, (ctx, pack, platform, ram) => {
    assert.ok(KNOWN_PACKS.has(pack), `unknown <pack> example value: ${pack}`);
    assert.ok(KNOWN_PLATFORMS.has(platform), `unknown <platform> example value: ${platform}`);
    ctx.pack = pack;
    ctx.platform = platform;
    ctx.hostRamMB = Number(ram);
  });

  scoped(/^the operator fork override is (\S+)$/, (ctx, override) => {
    ctx.override = override === 'unset' ? undefined : override;
  });

  scoped(/^a vitest lane resolves its worker pool$/, (ctx) => {
    ctx.resolvedPool = resolveVitestWorkerPool({
      pack: ctx.pack,
      platform: ctx.platform,
      override: ctx.override,
      hostRamMB: ctx.hostRamMB,
    });
  });

  scoped(/^the resolved pool is (\d+)$/, (ctx, pool) => {
    assert.equal(ctx.resolvedPool, Number(pool), `expected the resolved pool to be ${pool}, got ${ctx.resolvedPool}`);
  });

  scoped(/^the resolved pool is at least 1$/, (ctx) => {
    assert.ok(ctx.resolvedPool >= 1, `expected the resolved pool >= 1, got ${ctx.resolvedPool}`);
  });

  scoped(/^the worst case footprint of the resolved pool is within the host safe RAM fraction$/, (ctx) => {
    const budget = computeWorkerMemoryBudget({
      maxWorkers: ctx.resolvedPool,
      perWorkerHeapMB: PER_WORKER_HEAP_MB,
      hostRamMB: ctx.hostRamMB,
    });
    assert.equal(budget.withinBudget, true, `expected the resolved pool's worst-case footprint within budget, got: ${JSON.stringify(budget)}`);
  });
}

module.exports = { registerSteps };
