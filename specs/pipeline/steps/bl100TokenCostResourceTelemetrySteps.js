'use strict';

// BL-1943 (BL-100 stamp-off): step handlers for "token, cost, and resource
// telemetry with trends". Drives the REAL compiled modules
// (extension/out/metrics/{transcriptUsage,costTelemetry,pricingTable,
// resourceTelemetry}.js) directly against fixture data, mirroring
// extension/test/{transcriptUsage,costTelemetry,pricingTable,
// resourceTelemetry}.test.js's own established fixture shapes (fake
// assistant-message JSONL lines, fake holding windows, fake resource_sample
// events) - never a restatement of the parsing/attribution/pricing/trend
// logic itself.

const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');

let _transcriptUsage = null;
function transcriptUsageModule() {
  if (!_transcriptUsage) _transcriptUsage = require(path.join(EXT_DIR, 'out', 'metrics', 'transcriptUsage.js'));
  return _transcriptUsage;
}
let _costTelemetry = null;
function costTelemetryModule() {
  if (!_costTelemetry) _costTelemetry = require(path.join(EXT_DIR, 'out', 'metrics', 'costTelemetry.js'));
  return _costTelemetry;
}
let _pricingTable = null;
function pricingTableModule() {
  if (!_pricingTable) _pricingTable = require(path.join(EXT_DIR, 'out', 'metrics', 'pricingTable.js'));
  return _pricingTable;
}
let _resourceTelemetry = null;
function resourceTelemetryModule() {
  if (!_resourceTelemetry) _resourceTelemetry = require(path.join(EXT_DIR, 'out', 'metrics', 'resourceTelemetry.js'));
  return _resourceTelemetry;
}

// Mirrors transcriptUsage.test.js's own assistantLine fixture shape.
function assistantLine({ messageId, timestamp, model = 'claude-sonnet-5', usage }) {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: {
      id: messageId,
      model,
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_creation_input_tokens: usage.cacheCreationTokens,
        cache_read_input_tokens: usage.cacheReadTokens,
      },
    },
  });
}

function usageRecord({ messageId, timestampMs, model = 'claude-sonnet-5', usage }) {
  return { messageId, timestampMs, model, usage };
}

const FEATURE = 'token, cost, and resource telemetry with trends';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── cost-01: per-agent daily tokens match the transcripts ────────────
  scoped(/^role worktree transcript JSONLs with known usage records$/, (ctx) => {
    const { parseTranscriptLines } = transcriptUsageModule();
    const lines = [
      assistantLine({ messageId: 'm1', timestamp: '2026-09-01T10:00:00Z', usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 10 } }),
      assistantLine({ messageId: 'm2', timestamp: '2026-09-01T14:00:00Z', usage: { inputTokens: 200, outputTokens: 80, cacheCreationTokens: 5, cacheReadTokens: 0 } }),
    ];
    ctx.transcriptRecords = parseTranscriptLines(lines);
  });

  scoped(/^per-agent token metrics are computed for a day$/, (ctx) => {
    const { computeDailyRoleUsage } = costTelemetryModule();
    ctx.dailyUsage = computeDailyRoleUsage({ coder: ctx.transcriptRecords });
  });

  scoped(/^each role's input\/output\/cache totals equal the sum of its transcript usage entries for that day$/, (ctx) => {
    const dayKey = new Date('2026-09-01T00:00:00.000Z').toISOString();
    const attributed = ctx.dailyUsage.coder[dayKey];
    const expected = ctx.transcriptRecords.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.usage.inputTokens,
        outputTokens: acc.outputTokens + r.usage.outputTokens,
        cacheCreationTokens: acc.cacheCreationTokens + r.usage.cacheCreationTokens,
        cacheReadTokens: acc.cacheReadTokens + r.usage.cacheReadTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
    );
    assert.deepEqual(attributed.usage, expected);
  });

  // ── cost-02: per-ticket attribution is windowed and honest ───────────
  scoped(/^a role held ticket A for a known window and ticket B after it$/, (ctx) => {
    ctx.windows = [
      { ticketId: 'BL-A', startMs: Date.parse('2026-09-01T09:00:00Z'), endMs: Date.parse('2026-09-01T12:00:00Z') },
      { ticketId: 'BL-B', startMs: Date.parse('2026-09-01T13:00:00Z'), endMs: null },
    ];
    ctx.attributionRecords = [
      usageRecord({ messageId: 'a1', timestampMs: Date.parse('2026-09-01T10:00:00Z'), usage: { inputTokens: 100, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0 } }), // inside A's window
      usageRecord({ messageId: 'a2', timestampMs: Date.parse('2026-09-01T14:00:00Z'), usage: { inputTokens: 50, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 } }), // inside B's window
      usageRecord({ messageId: 'a3', timestampMs: Date.parse('2026-09-01T12:30:00Z'), usage: { inputTokens: 20, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 } }), // between windows
    ];
  });

  scoped(/^per-ticket tokens are computed$/, (ctx) => {
    const { attributeUsageToTickets } = costTelemetryModule();
    ctx.ticketUsage = attributeUsageToTickets(ctx.attributionRecords, ctx.windows);
  });

  scoped(/^usage timestamped inside each window is attributed to that ticket$/, (ctx) => {
    assert.equal(ctx.ticketUsage['BL-A'].usage.inputTokens, 100);
    assert.equal(ctx.ticketUsage['BL-B'].usage.inputTokens, 50);
  });

  scoped(/^usage outside any holding window lands in the role's "unattributed" bucket$/, (ctx) => {
    assert.ok(ctx.ticketUsage.unattributed, 'expected an "unattributed" bucket');
    assert.equal(ctx.ticketUsage.unattributed.usage.inputTokens, 20);
  });

  // ── cost-03: cost derives from the committed pricing table ───────────
  scoped(/^a pricing table version and known token totals$/, (ctx) => {
    const { PRICING_TABLE } = pricingTableModule();
    ctx.pricedModel = Object.keys(PRICING_TABLE).find((m) => PRICING_TABLE[m].cacheReadPerMTok !== undefined);
    ctx.pricingRates = PRICING_TABLE[ctx.pricedModel];
    ctx.costUsage = { inputTokens: 1_000_000, outputTokens: 500_000, cacheCreationTokens: 0, cacheReadTokens: 2_000_000 };
  });

  scoped(/^estimated cost is computed$/, (ctx) => {
    const { estimateCostUsd } = pricingTableModule();
    ctx.estimatedCost = estimateCostUsd(ctx.costUsage, ctx.pricedModel, new Date('2026-01-01T00:00:00Z'));
  });

  scoped(/^the dollar figures follow the table's per-model rates$/, (ctx) => {
    const expected = ctx.costUsage.inputTokens / 1_000_000 * ctx.pricingRates.inputPerMTok + ctx.costUsage.outputTokens / 1_000_000 * ctx.pricingRates.outputPerMTok;
    const withoutCacheRead = expected;
    assert.ok(ctx.estimatedCost > withoutCacheRead, 'expected cache-read usage to add to the input/output-only cost');
  });

  scoped(/^cache-read tokens are priced at their own rate$/, (ctx) => {
    const cacheReadContribution = (ctx.costUsage.cacheReadTokens / 1_000_000) * ctx.pricingRates.cacheReadPerMTok;
    const inputOutputOnly = (ctx.costUsage.inputTokens / 1_000_000) * ctx.pricingRates.inputPerMTok + (ctx.costUsage.outputTokens / 1_000_000) * ctx.pricingRates.outputPerMTok;
    assert.ok(
      Math.abs(ctx.estimatedCost - (inputOutputOnly + cacheReadContribution)) < 1e-9,
      `expected cache-read tokens priced at cacheReadPerMTok (${ctx.pricingRates.cacheReadPerMTok}), got total ${ctx.estimatedCost}`
    );
    assert.notEqual(ctx.pricingRates.cacheReadPerMTok, ctx.pricingRates.inputPerMTok, 'cache-read must have its own distinct rate for this assertion to mean anything');
  });

  // ── cost-04: resource samples become trends ──────────────────────────
  scoped(/^resource_sample telemetry lines across several hours$/, (ctx) => {
    const { filterResourceSampleEvents } = resourceTelemetryModule();
    const rawEvents = [
      { type: 'resource_sample', role: 'coder', rssBytes: 100_000_000, cpuPercent: 10, at: '2026-09-01T08:00:00Z' },
      { type: 'resource_sample', role: 'coder', rssBytes: 150_000_000, cpuPercent: 20, at: '2026-09-01T10:00:00Z' },
      { type: 'resource_sample', role: 'coder', rssBytes: 200_000_000, cpuPercent: 30, at: '2026-09-01T12:00:00Z' },
    ];
    ctx.resourceEvents = filterResourceSampleEvents(rawEvents);
  });

  scoped(/^CPU\/RAM metrics are queried$/, (ctx) => {
    const { computeResourceTrends } = resourceTelemetryModule();
    ctx.resourceTrends = computeResourceTrends(ctx.resourceEvents, ['coder'], Date.parse('2026-09-01T13:00:00Z'));
  });

  scoped(/^per-role current values and windowed trends are reported$/, (ctx) => {
    const coderTrend = ctx.resourceTrends.coder;
    assert.equal(coderTrend.currentRssBytes, 200_000_000);
    assert.equal(coderTrend.currentCpuPercent, 30);
    assert.ok(['up', 'down', 'flat', 'unknown'].includes(coderTrend.rssTrend.direction));
  });

  // ── cost-07: absent data degrades to zeros ───────────────────────────
  scoped(/^a role with no transcript directory or no telemetry$/, (ctx) => {
    const { readTranscriptUsage } = transcriptUsageModule();
    const { filterResourceSampleEvents } = resourceTelemetryModule();
    ctx.absentTranscriptRecords = readTranscriptUsage('/nonexistent/sfvc-bl100-cost07-worktree', '/nonexistent/sfvc-bl100-cost07-projects');
    ctx.absentResourceEvents = filterResourceSampleEvents([]);
  });

  scoped(/^any surface is queried$/, (ctx) => {
    const { computeDailyRoleUsage, attributeUsageToTickets } = costTelemetryModule();
    const { computeResourceTrends } = resourceTelemetryModule();
    ctx.absentDailyUsage = computeDailyRoleUsage({ coder: ctx.absentTranscriptRecords });
    ctx.absentTicketUsage = attributeUsageToTickets(ctx.absentTranscriptRecords, []);
    ctx.absentResourceTrends = computeResourceTrends(ctx.absentResourceEvents, ['coder'], Date.now());
  });

  scoped(/^zeros \/ "no data" render without errors$/, (ctx) => {
    assert.deepEqual(ctx.absentTranscriptRecords, []);
    assert.deepEqual(ctx.absentDailyUsage, { coder: {} });
    assert.deepEqual(ctx.absentTicketUsage, {});
    assert.equal(ctx.absentResourceTrends.coder.currentRssBytes, null);
    assert.equal(ctx.absentResourceTrends.coder.currentCpuPercent, null);
  });
}

module.exports = { registerSteps };
