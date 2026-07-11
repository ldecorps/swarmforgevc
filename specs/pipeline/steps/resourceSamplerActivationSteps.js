'use strict';

// BL-264: step handlers for the resource-sampler-activation feature. Drives
// the REAL compiled modules in-process - resourceTelemetry.ts's own
// startResourceSampler/stopResourceSampler (unchanged, reused as-is) fed a
// fake scheduler/getStats (mirrors resourceTelemetry.test.js's own
// fakeScheduler exactly - no real timer), and resourceSamplerActivation.ts's
// buildSampledRoles fed a fake pid resolver (proving pids come from the
// injected discovery seam, never a hardcoded/second mechanism). The
// extension.ts wiring itself (VS Code API boundary, not unit-testable) is
// proven as a static source-text contract - the same idiom
// briefingEmailSteps.js/strykerSandboxSiblingsSteps.js already established
// for "is the real wiring actually calling the right function, at the
// right lifecycle point" checks.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const {
  startResourceSampler,
  stopResourceSampler,
  readResourceSampleEvents,
} = require(path.join(EXT_DIR, 'out', 'metrics', 'resourceTelemetry'));
const { buildSampledRoles } = require(path.join(EXT_DIR, 'out', 'swarm', 'resourceSamplerActivation'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-resource-sampler-'));
}

// Exact fixture shape resourceTelemetry.test.js's own fakeScheduler uses -
// scheduleTick captures the tick fn and returns a fake handle; clearTick
// drops it; fire() manually invokes the captured tick (no real timer).
function fakeScheduler() {
  let tick = null;
  return {
    scheduleTick: (fn) => {
      tick = fn;
      return {};
    },
    clearTick: () => {
      tick = null;
    },
    fire: () => {
      if (tick) tick();
    },
  };
}

function extensionSource() {
  return fs.readFileSync(path.join(EXT_DIR, 'src', 'extension.ts'), 'utf8');
}

function registerSteps(registry) {
  registry.define(/^the resource sampler that appends an RSS\/CPU sample per role on each tick$/, () => {
    // Framing only - each scenario below builds its own fixture.
  });

  // ── samples-per-role-while-running-01 ────────────────────────────────
  registry.define(/^a running swarm whose agent roles resolve to process ids$/, (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.roles = [{ role: 'coder', session: 'swarmforge-coder' }, { role: 'cleaner', session: 'swarmforge-cleaner' }];
    const pidBySession = { 'swarmforge-coder': 111, 'swarmforge-cleaner': 222 };
    const resolvePid = (_targetPath, session) => pidBySession[session] ?? null;
    ctx.sampledRoles = buildSampledRoles(ctx.targetPath, ctx.roles, resolvePid);
    const statsByPid = { 111: { rssBytes: 1000, cpuPercent: 5 }, 222: { rssBytes: 2000, cpuPercent: 10 } };
    ctx.getStats = (pid) => statsByPid[pid] ?? null;
  });

  registry.define(/^the sampler ticks$/, (ctx) => {
    const { scheduleTick, clearTick, fire } = fakeScheduler();
    const timer = startResourceSampler(ctx.targetPath, ctx.sampledRoles, ctx.getStats, scheduleTick, 60_000);
    fire();
    stopResourceSampler(timer, clearTick);
  });

  registry.define(/^it appends an RSS\/CPU sample for each role through the existing append path$/, (ctx) => {
    const events = readResourceSampleEvents(ctx.targetPath);
    if (events.length !== ctx.roles.length) {
      throw new Error(`expected ${ctx.roles.length} appended samples (one per role), got ${events.length}`);
    }
    const roleNames = events.map((e) => e.role).sort();
    if (JSON.stringify(roleNames) !== JSON.stringify(['cleaner', 'coder'])) {
      throw new Error(`expected a sample for every role; got roles: ${roleNames.join(', ')}`);
    }
  });

  // ── starts-on-swarm-up-02 ─────────────────────────────────────────────
  registry.define(/^no resource sampler is running$/, (ctx) => {
    ctx.currentResourceSampler = null;
  });

  registry.define(/^the swarm becomes ready$/, (ctx) => {
    // The mechanism extension.ts's startOrRestartResourceSampler wires TO -
    // proves it actually starts producing samples once called, the same
    // "mechanism a real dry run depends on" idiom BL-221/BL-267 established.
    ctx.targetPath = mkTmp();
    const { scheduleTick, fire } = fakeScheduler();
    const sampledRoles = buildSampledRoles(ctx.targetPath, [{ role: 'coder', session: 'swarmforge-coder' }], () => 111);
    ctx.currentResourceSampler = startResourceSampler(
      ctx.targetPath,
      sampledRoles,
      () => ({ rssBytes: 1, cpuPercent: 1 }),
      scheduleTick,
      60_000
    );
    ctx.fire = fire;
  });

  registry.define(/^the resource sampler is started$/, (ctx) => {
    if (!ctx.currentResourceSampler) {
      throw new Error('expected a sampler handle to be held after the swarm becomes ready');
    }
    ctx.fire();
    if (readResourceSampleEvents(ctx.targetPath).length === 0) {
      throw new Error('expected the started sampler to actually produce a sample on tick');
    }
    // Static wiring contract: the real extension.ts calls
    // startOrRestartResourceSampler at every launch-success/reattach call
    // site - proven by counting occurrences alongside its established
    // sibling startOrRestartChaserMonitor (same call sites, per BL-264's
    // own research: extension.ts joins the identical 4-call block).
    const src = extensionSource();
    const chaserCallSites = (src.match(/startOrRestartChaserMonitor\(/g) || []).length;
    const samplerCallSites = (src.match(/startOrRestartResourceSampler\(/g) || []).length;
    // chaserCallSites includes its own function definition; samplerCallSites
    // includes its own function definition too - both count 1 definition +
    // N call sites, so equal counts means the sampler joined every site the
    // chaser did.
    if (samplerCallSites < chaserCallSites) {
      throw new Error(
        `expected startOrRestartResourceSampler to be wired at every startOrRestartChaserMonitor call site (chaser: ${chaserCallSites}, sampler: ${samplerCallSites})`
      );
    }
  });

  // ── stops-and-no-leak-03 ──────────────────────────────────────────────
  registry.define(/^a running resource sampler$/, (ctx) => {
    ctx.targetPath = mkTmp();
    const scheduler = fakeScheduler();
    ctx.scheduler = scheduler;
    const sampledRoles = buildSampledRoles(ctx.targetPath, [{ role: 'coder', session: 'swarmforge-coder' }], () => 111);
    ctx.currentResourceSampler = startResourceSampler(
      ctx.targetPath,
      sampledRoles,
      () => ({ rssBytes: 1, cpuPercent: 1 }),
      scheduler.scheduleTick,
      60_000
    );
    scheduler.fire();
    ctx.samplesBeforeStop = readResourceSampleEvents(ctx.targetPath).length;
    if (ctx.samplesBeforeStop === 0) {
      throw new Error('expected the fixture sampler to have produced at least one sample before stopping it');
    }
  });

  registry.define(/^the swarm is stopped$/, (ctx) => {
    stopResourceSampler(ctx.currentResourceSampler, ctx.scheduler.clearTick);
    ctx.currentResourceSampler = null;
    // A tick fired after stop must never append - clearTick dropped the
    // captured fn, so fire() below is a no-op if the handle was truly cleared.
    ctx.scheduler.fire();
  });

  registry.define(/^the sampler stops appending samples and its tick handle is cleared$/, (ctx) => {
    if (ctx.currentResourceSampler !== null) {
      throw new Error('expected the held sampler handle to be cleared (set to null) after stopping');
    }
    const samplesAfterStop = readResourceSampleEvents(ctx.targetPath).length;
    if (samplesAfterStop !== ctx.samplesBeforeStop) {
      throw new Error(
        `expected no further samples after stop (leaked interval); before=${ctx.samplesBeforeStop}, after=${samplesAfterStop}`
      );
    }
    // Static wiring contract: the real swarmforge.stopSwarm handler calls
    // stopResourceSampler and clears the held handle, mirroring the
    // existing currentChaserMonitor stop block exactly.
    const src = extensionSource();
    const stopHandlerMatch = src.match(/registerCommand\('swarmforge\.stopSwarm'[\s\S]*?\n {4}\}\)/);
    if (!stopHandlerMatch) {
      throw new Error('expected to find the swarmforge.stopSwarm command handler in extension.ts');
    }
    const stopHandlerBody = stopHandlerMatch[0];
    if (!/stopResourceSampler\(currentResourceSampler\)/.test(stopHandlerBody)) {
      throw new Error('expected the swarmforge.stopSwarm handler to call stopResourceSampler(currentResourceSampler)');
    }
    if (!/currentResourceSampler = null/.test(stopHandlerBody)) {
      throw new Error('expected the swarmforge.stopSwarm handler to clear currentResourceSampler to null');
    }
  });
}

module.exports = { registerSteps };
