'use strict';

// BL-822: step handlers for "resource health reports host load, not only
// per-role RSS/CPU trends". Drives the REAL compiled library functions
// (resourceTelemetry.ts's computeHostLoadVerdict/DEFAULT_SAMPLER_INTERVAL_MS,
// costHealthSidecar.ts's buildCostHealthSidecar/renderCostHealthSection)
// in-process against injected data - no VS Code host, no real tmux/PTY, same
// "drive the real compiled modules directly" posture as
// headlessResourceSamplingSteps.js (BL-350), which this feature is additive
// to.
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { computeHostLoadVerdict, DEFAULT_SAMPLER_INTERVAL_MS, DEFAULT_HOST_LOAD_SEVERE_RATIO, DEFAULT_HOST_LOAD_SUSTAINED_MINUTES } = require(
  path.join(EXT_DIR, 'out', 'metrics', 'resourceTelemetry')
);
const { buildCostHealthSidecar, renderCostHealthSection } = require(path.join(EXT_DIR, 'out', 'notify', 'costHealthSidecar'));

const NOW_MS = Date.parse('2026-08-06T12:00:00Z');
const NOW_ISO = new Date(NOW_MS).toISOString();

function emptyReliabilitySeries(nowIso) {
  const point = [{ periodStart: nowIso, value: 0 }];
  return { chases: point, nudges: point, respawns: point, failedDeliveries: point };
}

// Builds a series of host-load samples ending "now", one per
// DEFAULT_SAMPLER_INTERVAL_MS, all at the given ratio - the direct input
// computeHostLoadVerdict's own `matchingSampleCount * samplingIntervalMs`
// formula reads (BL-822 ruling 2), so a Given clause's "<ratio> times the
// core count for <minutes> minutes" maps onto it without a second notion of
// duration.
function hostLoadSeries(ratio, minutes) {
  const sampleCount = Math.max(1, Math.round((minutes * 60_000) / DEFAULT_SAMPLER_INTERVAL_MS));
  const events = [];
  for (let i = 0; i < sampleCount; i++) {
    events.push({ ratio, atMs: NOW_MS - i * DEFAULT_SAMPLER_INTERVAL_MS });
  }
  return events;
}

// A role trend well past computeResourceAnomalies's own unchanged 10%
// threshold (headlessResourceSamplingSteps.js's own "resource samples that
// contain an anomaly" shape, reused so this feature's anomaly branch stays
// byte-for-byte the same code path BL-350 already proved).
function anomalousRoleTrend() {
  return {
    currentRssBytes: 220_000_000, currentCpuPercent: 5,
    rssTrend: { direction: 'up', delta: 20_000_000, priorValue: 200_000_000, currentValue: 220_000_000, series: [] },
    cpuTrend: { direction: 'flat', delta: 0, priorValue: 5, currentValue: 5, series: [] },
  };
}

function quietRoleTrend() {
  return {
    currentRssBytes: 100_000_000, currentCpuPercent: 5,
    rssTrend: { direction: 'flat', delta: 0, priorValue: 100_000_000, currentValue: 100_000_000, series: [] },
    cpuTrend: { direction: 'flat', delta: 0, priorValue: 5, currentValue: 5, series: [] },
  };
}

function ensureRoot(ctx) {
  ctx.hostLoadEvents = ctx.hostLoadEvents || [];
  ctx.resourceTrendsByRole = ctx.resourceTrendsByRole || {};
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^resource sampling is running headlessly on a host with a known core count$/, (ctx) => {
    ensureRoot(ctx);
  });

  registry.define(/^per-role RSS and CPU trends are available to the cost-health sidecar$/, (ctx) => {
    ensureRoot(ctx);
  });

  // ── shared Given: the parameterised host-load duration/ratio sentence ──
  // (IR-DRY note on the ticket: one regex serving all five call sites) ────
  registry.define(/^the recorded host load stayed at ([\d.]+) times the core count for (\d+) minutes$/, (ctx, ratioText, minutesText) => {
    ensureRoot(ctx);
    const ratio = Number(ratioText);
    const minutes = Number(minutesText);
    if (!Number.isFinite(ratio) || !Number.isFinite(minutes)) {
      throw new Error(`bl822-host-load: unparsable ratio/minutes "${ratioText}"/"${minutesText}"`);
    }
    ctx.hostLoadEvents = hostLoadSeries(ratio, minutes);
  });

  registry.define(/^no per-role RSS or CPU trend crosses the existing anomaly threshold$/, (ctx) => {
    ensureRoot(ctx);
    ctx.resourceTrendsByRole = { coder: quietRoleTrend() };
  });

  registry.define(/^one role's RSS or CPU trend crosses the existing anomaly threshold$/, (ctx) => {
    ensureRoot(ctx);
    ctx.anomalousRole = 'coder';
    ctx.resourceTrendsByRole = { coder: anomalousRoleTrend() };
  });

  registry.define(/^no role's process could be sampled for that day$/, (ctx) => {
    ensureRoot(ctx);
    ctx.resourceTrendsByRole = {};
  });

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(/^the cost-health sidecar is built for that day$/, (ctx) => {
    ensureRoot(ctx);
    const hostLoad = computeHostLoadVerdict(ctx.hostLoadEvents, DEFAULT_HOST_LOAD_SEVERE_RATIO, DEFAULT_HOST_LOAD_SUSTAINED_MINUTES * 60_000);
    ctx.sidecar = buildCostHealthSidecar(
      '2026-08-06',
      {},
      ctx.resourceTrendsByRole,
      emptyReliabilitySeries(NOW_ISO),
      [],
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      hostLoad
    );
    ctx.reportText = renderCostHealthSection(ctx.sidecar);
  });

  // ── Then ─────────────────────────────────────────────────────────────
  registry.define(/^the sidecar reports a severe host load for that day$/, (ctx) => {
    if (ctx.sidecar.hostLoad.severe !== true) {
      throw new Error(`expected a severe host load verdict, got: ${JSON.stringify(ctx.sidecar.hostLoad)}`);
    }
  });

  registry.define(/^the sidecar does not report a severe host load for that day$/, (ctx) => {
    if (ctx.sidecar.hostLoad.severe !== false) {
      throw new Error(`expected a non-severe host load verdict, got: ${JSON.stringify(ctx.sidecar.hostLoad)}`);
    }
  });

  registry.define(/^the sidecar does not report that no resource anomalies were found$/, (ctx) => {
    if (/none found/.test(ctx.reportText)) {
      throw new Error(`expected the report to NOT claim none found, got: ${ctx.reportText}`);
    }
  });

  registry.define(/^the sidecar reports that no resource anomalies were found$/, (ctx) => {
    if (!/\*\*Resource anomalies:\*\* none found\./.test(ctx.reportText)) {
      throw new Error(`expected the report to explicitly state no anomaly was found, got: ${ctx.reportText}`);
    }
  });

  registry.define(/^that role still appears among the per-role resource anomalies$/, (ctx) => {
    if (!ctx.sidecar.resourceAnomalies.some((a) => a.role === ctx.anomalousRole)) {
      throw new Error(`expected ${ctx.anomalousRole} to still appear in resourceAnomalies, got: ${JSON.stringify(ctx.sidecar.resourceAnomalies)}`);
    }
  });

  registry.define(/^the sidecar severe host load verdict is (true|false)$/, (ctx, expectedText) => {
    const expected = expectedText === 'true';
    if (ctx.sidecar.hostLoad.severe !== expected) {
      throw new Error(`expected severe host load verdict ${expected}, got: ${JSON.stringify(ctx.sidecar.hostLoad)}`);
    }
  });

  registry.define(/^the sidecar reports that per-role resource samples were not observed$/, (ctx) => {
    if (ctx.sidecar.resourceSamplesObserved !== false) {
      throw new Error(`expected resourceSamplesObserved false, got: ${ctx.sidecar.resourceSamplesObserved}`);
    }
  });
}

module.exports = { registerSteps };
