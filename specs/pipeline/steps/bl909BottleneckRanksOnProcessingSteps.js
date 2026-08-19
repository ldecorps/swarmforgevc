'use strict';

// BL-909: step handlers for "The named bottleneck is the stage that takes
// longest to do the work, not the stage that waited longest for it". Drives
// the REAL compiled nameBottleneck/formatStageDwellReport (out/metrics/
// stageDwell.js, out/tools/stage-dwell-report.js) against fabricated
// StageDwellReport fixtures - no real handoff files or filesystem needed,
// same "pure computation, fabricated data" posture stageDwell.test.js's own
// dwell-01/02/03 unit tests use.
const path = require('node:path');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { nameBottleneck } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'stageDwell'));
const { formatDurationMs } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'swarmMetrics'));
const { formatStageDwellReport } = require(path.join(EXTENSION_DIR, 'out', 'tools', 'stage-dwell-report'));

const FEATURE_NAME = 'The named bottleneck is the stage that takes longest to do the work, not the stage that waited longest for it';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_MEASURES = { wait: 'wait', processing: 'processing' };
function knownMeasure(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_MEASURES, value)) {
    throw new Error(`bl909: unrecognized <measure> example value "${value}"`);
  }
  return KNOWN_MEASURES[value];
}

// Parses the feature file's own "1h51m" / "38m" / "1s" / "0s" duration
// shorthand into milliseconds - h/m/s components, any subset, in that
// order. Distinct from formatDurationMs (production's own MINUTE-rounding
// formatter, no seconds) so a scenario can specify second-level inputs
// ("1s") even though the rendered report only ever shows minutes.
function parseDurationToMs(text) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text.trim());
  if (!m || (!m[1] && !m[2] && !m[3])) {
    throw new Error(`bl909: could not parse duration "${text}"`);
  }
  const hours = Number(m[1] || 0);
  const minutes = Number(m[2] || 0);
  const seconds = Number(m[3] || 0);
  return hours * 3600000 + minutes * 60000 + seconds * 1000;
}

function dwellStats(medianMs) {
  return { medianMs, p90Ms: medianMs, maxMs: medianMs, outliersMs: [] };
}

function toStageDwellReport({ role, queueWaitMs, processingMs }) {
  return {
    role,
    parcelsProcessed: processingMs === null ? 0 : 1,
    queueWait: dwellStats(queueWaitMs),
    processing: dwellStats(processingMs),
    trend: { direction: 'unknown', delta: null, currentValue: null, priorValue: null, series: [] },
  };
}

function buildReportResult(ctx) {
  const stages = ctx.stages.map(toStageDwellReport);
  return {
    windowHours: 24,
    windowStartIso: '2026-01-01T00:00:00.000Z',
    windowEndIso: '2026-01-02T00:00:00.000Z',
    stages,
    bottleneck: nameBottleneck(stages),
    unparseableCount: 0,
  };
}

function registerSteps(registry) {
  // ── Given: a stage with real wait+processing data ────────────────────
  registry.defineScoped(
    /^stage "([^"]+)" waited "([^"]+)" and processed "([^"]+)"$/,
    (ctx, role, wait, processing) => {
      ctx.stages = ctx.stages || [];
      ctx.stages.push({ role, queueWaitMs: parseDurationToMs(wait), processingMs: parseDurationToMs(processing) });
    },
    FEATURE_NAME
  );

  // ── Given: a stage that did no work this window ──────────────────────
  registry.defineScoped(
    /^stage "([^"]+)" processed no parcel this window$/,
    (ctx, role) => {
      ctx.stages = ctx.stages || [];
      ctx.stages.push({ role, queueWaitMs: null, processingMs: null });
    },
    FEATURE_NAME
  );

  // ── Given: nothing anywhere ───────────────────────────────────────────
  registry.defineScoped(
    /^no stage processed a parcel this window$/,
    (ctx) => {
      ctx.stages = ctx.stages || [];
    },
    FEATURE_NAME
  );

  // ── When: name the bottleneck only ────────────────────────────────────
  registry.defineScoped(
    /^the bottleneck is named$/,
    (ctx) => {
      const stages = ctx.stages.map(toStageDwellReport);
      ctx.bottleneck = nameBottleneck(stages);
      ctx.rankedStages = ctx.stages;
    },
    FEATURE_NAME
  );

  // ── When: render the whole report ────────────────────────────────────
  registry.defineScoped(
    /^the stage dwell report is rendered$/,
    (ctx) => {
      const result = buildReportResult(ctx);
      ctx.bottleneck = result.bottleneck;
      ctx.rankedStages = ctx.stages;
      ctx.renderedReport = formatStageDwellReport(result);
    },
    FEATURE_NAME
  );

  // ── Then: bottleneck role ─────────────────────────────────────────────
  registry.defineScoped(
    /^the bottleneck is "([^"]+)"$/,
    (ctx, role) => {
      if (!ctx.bottleneck || ctx.bottleneck.role !== role) {
        throw new Error(`expected bottleneck role "${role}", got ${JSON.stringify(ctx.bottleneck)}`);
      }
    },
    FEATURE_NAME
  );

  // ── Then: multiple is a processing multiple ──────────────────────────
  registry.defineScoped(
    /^the multiple over the next slowest stage is computed from processing medians$/,
    (ctx) => {
      const sortedByProcessing = [...ctx.rankedStages]
        .filter((s) => s.processingMs !== null)
        .sort((a, b) => b.processingMs - a.processingMs);
      const [top, next] = sortedByProcessing;
      const expected = next ? top.processingMs / next.processingMs : null;
      if (ctx.bottleneck.multipleOverNext !== expected) {
        throw new Error(`expected multipleOverNext ${expected} (processing medians), got ${ctx.bottleneck.multipleOverNext}`);
      }
    },
    FEATURE_NAME
  );

  // ── Then: not a candidate ─────────────────────────────────────────────
  registry.defineScoped(
    /^"([^"]+)" is not a bottleneck candidate$/,
    (ctx, role) => {
      if (ctx.bottleneck && ctx.bottleneck.role === role) {
        throw new Error(`expected "${role}" to never be named bottleneck, but it was`);
      }
    },
    FEATURE_NAME
  );

  // ── Then: the rendered Bottleneck line ────────────────────────────────
  function bottleneckLine(report) {
    const line = report.split('\n').find((l) => l.startsWith('Bottleneck:'));
    if (!line) {
      throw new Error(`expected a "Bottleneck:" line in the rendered report:\n${report}`);
    }
    return line;
  }

  registry.defineScoped(
    /^the Bottleneck line names "([^"]+)"$/,
    (ctx, role) => {
      const line = bottleneckLine(ctx.renderedReport);
      if (!line.includes(role)) {
        throw new Error(`expected the Bottleneck line to name "${role}", got: ${line}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the Bottleneck line does not name "([^"]+)"$/,
    (ctx, role) => {
      const line = bottleneckLine(ctx.renderedReport);
      if (line.includes(role)) {
        throw new Error(`expected the Bottleneck line NOT to name "${role}", got: ${line}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the Bottleneck line reports that no stage processed a parcel this window$/,
    (ctx) => {
      const line = bottleneckLine(ctx.renderedReport);
      if (line !== 'Bottleneck: (no stage processed a parcel this window)') {
        throw new Error(`expected the no-data Bottleneck line, got: ${line}`);
      }
    },
    FEATURE_NAME
  );

  // ── Then: per-stage line still carries both figures ──────────────────
  registry.defineScoped(
    /^the line for "([^"]+)" reports a "([^"]+)" median of "([^"]+)"$/,
    (ctx, role, measure, value) => {
      const known = knownMeasure(measure);
      const expectedMs = parseDurationToMs(value);
      const stageLine = ctx.renderedReport.split('\n').find((l) => l.startsWith(`${role}:`));
      if (!stageLine) {
        throw new Error(`expected a per-stage line for "${role}" in:\n${ctx.renderedReport}`);
      }
      const expectedText = `${known} median ${formatDurationMs(expectedMs)}`;
      if (!stageLine.includes(expectedText)) {
        throw new Error(`expected "${role}"'s line to include "${expectedText}", got: ${stageLine}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
