'use strict';

// BL-350 (BL-336 finding H1): step handlers for "resource anomalies are
// sampled even when nobody has an editor open". Drives the REAL headless
// library functions (resourceTelemetry.ts's sampleRolesOnce/
// shouldSampleThisInterval/latestSampleAtMs, costHealthSidecar.ts's
// buildCostHealthSidecar/renderCostHealthSection) in-process against the
// SAME shared telemetry file appendResourceSample/readResourceSampleEvents
// use in production - no VS Code host, no real tmux/PTY, mirroring
// costHealthSidecarHeadlessSteps.js's own "drive the real compiled modules
// directly" posture for a TS-heavy ticket. The pid-resolution/tmux
// discovery hop (buildSampledRoles/resolvePanePid) is injected here, same
// as resourceSamplerActivation.test.js and resourceTelemetry.test.js's own
// unit tests - that hop is proven separately and is not this feature's
// concern (which starts one layer in: "given a role's stats are sampled").
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const {
  appendResourceSample,
  readResourceSampleEvents,
  computeResourceTrends,
  sampleRolesOnce,
  latestSampleAtMs,
  shouldSampleThisInterval,
  DEFAULT_SAMPLER_INTERVAL_MS,
} = require(path.join(EXT_DIR, 'out', 'metrics', 'resourceTelemetry'));
const { readChaserTelemetryEvents } = require(path.join(EXT_DIR, 'out', 'metrics', 'swarmMetrics'));
const { buildCostHealthSidecar, renderCostHealthSection } = require(path.join(EXT_DIR, 'out', 'notify', 'costHealthSidecar'));

const NOW_MS = Date.parse('2026-07-13T12:00:00Z');
const NOW_ISO = new Date(NOW_MS).toISOString();
const HOUR_MS = 60 * 60 * 1000;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl350-resource-sampling-'));
}

function emptyReliabilitySeries(nowIso) {
  const point = [{ periodStart: nowIso, value: 0 }];
  return { chases: point, nudges: point, respawns: point, failedDeliveries: point };
}

function ensureRoot(ctx) {
  ctx.root = ctx.root || mkTmp();
  return ctx.root;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a swarm running headless, with no editor attached$/, (ctx) => {
    ensureRoot(ctx);
    // Narrative only - the whole point of BL-336's finding H1: the ONLY
    // code that ever sampled resources lived in the VS Code extension
    // host. Every step below drives the headless library functions
    // directly, never any vscode.* surface.
  });

  // ── headless-resource-sampling-01 ─────────────────────────────────────
  registry.define(/^the swarm has been running for a sampling interval$/, (ctx) => {
    ensureRoot(ctx);
    const roles = [{ role: 'coder', getPid: () => 111 }];
    ctx.sampledCount = sampleRolesOnce(ctx.root, roles, () => ({ rssBytes: 123_456_000, cpuPercent: 4.2 }), NOW_MS);
  });

  registry.define(/^resource samples have been recorded$/, (ctx) => {
    const events = readResourceSampleEvents(ctx.root);
    if (events.length === 0) {
      throw new Error('expected at least one resource_sample event to have been recorded, got none');
    }
  });

  // ── headless-resource-sampling-02 ─────────────────────────────────────
  registry.define(/^resource samples that contain an anomaly$/, (ctx) => {
    ensureRoot(ctx);
    // Prior sample low, latest sample sharply higher - an "up" trend well
    // past computeResourceAnomalies's own unchanged 10% threshold.
    appendResourceSample(ctx.root, 'coder', 100_000_000, 5, NOW_MS - HOUR_MS);
    appendResourceSample(ctx.root, 'coder', 900_000_000, 5, NOW_MS);
  });

  // Shared with headless-resource-sampling-03 below.
  registry.define(/^the daily cost-health report is emitted$/, (ctx) => {
    const resourceTrendsByRole = computeResourceTrends(readResourceSampleEvents(ctx.root), ['coder'], NOW_MS);
    ctx.sidecar = buildCostHealthSidecar('2026-07-13', {}, resourceTrendsByRole, emptyReliabilitySeries(NOW_ISO), [], []);
    ctx.reportText = renderCostHealthSection(ctx.sidecar);
  });

  registry.define(/^that anomaly appears in the report$/, (ctx) => {
    if (ctx.sidecar.resourceAnomalies.length === 0) {
      throw new Error(`expected the report to carry the anomaly, got: ${JSON.stringify(ctx.sidecar.resourceAnomalies)}`);
    }
    if (!/\*\*Resource anomalies:\*\*/.test(ctx.reportText) || !/coder/.test(ctx.reportText)) {
      throw new Error(`expected the rendered report to mention the anomalous role, got: ${ctx.reportText}`);
    }
  });

  // ── headless-resource-sampling-03 ─────────────────────────────────────
  registry.define(/^resource samples that contain no anomaly$/, (ctx) => {
    ensureRoot(ctx);
    // A negligible move, well under the 10% threshold - a genuinely quiet
    // period, not "no data".
    appendResourceSample(ctx.root, 'coder', 100_000_000, 5, NOW_MS - HOUR_MS);
    appendResourceSample(ctx.root, 'coder', 100_000_100, 5, NOW_MS);
  });

  registry.define(/^the report states that no anomaly was found$/, (ctx) => {
    if (ctx.sidecar.resourceAnomalies.length !== 0) {
      throw new Error(`expected no anomaly to have been found, got: ${JSON.stringify(ctx.sidecar.resourceAnomalies)}`);
    }
    if (!/\*\*Resource anomalies:\*\* none found\./.test(ctx.reportText)) {
      throw new Error(`expected the report to explicitly state no anomaly was found, got: ${ctx.reportText}`);
    }
  });

  // ── headless-resource-sampling-04 ─────────────────────────────────────
  registry.define(/^the telemetry already records the swarm's other activity$/, (ctx) => {
    ensureRoot(ctx);
    const dir = path.join(ctx.root, '.swarmforge', 'telemetry');
    fs.mkdirSync(dir, { recursive: true });
    const monthKey = new Date(NOW_MS).toISOString().slice(0, 7);
    fs.writeFileSync(path.join(dir, `chaser-${monthKey}.jsonl`), JSON.stringify({ type: 'chase', role: 'coder', at: NOW_ISO }) + '\n');
  });

  registry.define(/^resource samples are recorded$/, (ctx) => {
    ensureRoot(ctx);
    const roles = [{ role: 'coder', getPid: () => 111 }];
    sampleRolesOnce(ctx.root, roles, () => ({ rssBytes: 1, cpuPercent: 1 }), NOW_MS);
  });

  registry.define(/^the existing telemetry is still recorded$/, (ctx) => {
    const events = readChaserTelemetryEvents(ctx.root);
    if (!events.some((e) => e.type === 'chase')) {
      throw new Error(`expected the pre-existing chase event to still be present, got: ${JSON.stringify(events)}`);
    }
    if (!events.some((e) => e.type === 'resource_sample')) {
      throw new Error(`expected a new resource_sample event to have been added, got: ${JSON.stringify(events)}`);
    }
  });

  // ── headless-resource-sampling-05 ─────────────────────────────────────
  registry.define(/^an editor is attached and already sampling resources$/, (ctx) => {
    ensureRoot(ctx);
    // 30s ago - well inside DEFAULT_SAMPLER_INTERVAL_MS, standing in for
    // "the host-side sampler already covered this interval".
    appendResourceSample(ctx.root, 'coder', 100_000_000, 5, NOW_MS - 30_000);
  });

  registry.define(/^the swarm samples resources$/, (ctx) => {
    const lastAtMs = latestSampleAtMs(readResourceSampleEvents(ctx.root));
    const due = shouldSampleThisInterval(lastAtMs, NOW_MS, DEFAULT_SAMPLER_INTERVAL_MS);
    if (due) {
      const roles = [{ role: 'coder', getPid: () => 111 }];
      sampleRolesOnce(ctx.root, roles, () => ({ rssBytes: 2, cpuPercent: 2 }), NOW_MS);
    }
  });

  registry.define(/^each sampling interval is recorded once$/, (ctx) => {
    const events = readResourceSampleEvents(ctx.root).filter((e) => e.role === 'coder');
    if (events.length !== 1) {
      throw new Error(`expected exactly one sample for this interval, got ${events.length}: ${JSON.stringify(events)}`);
    }
  });
}

module.exports = { registerSteps };
