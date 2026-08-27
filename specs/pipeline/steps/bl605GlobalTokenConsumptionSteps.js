'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const {
  aggregateGlobalTokenBuckets,
  summarizeGlobalTokenWindow,
  computeGlobalTokenConsumptionFromTranscripts,
} = require(path.join(EXT_DIR, 'out', 'metrics', 'globalTokenConsumption'));

const FEATURE = 'global token consumption rolls up whole-swarm totals for trend surfaces';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WINDOW_START = Date.parse('2026-07-09T08:00:00.000Z');
const WINDOW_END = WINDOW_START + HOUR;

function usageRecord(tokens, timestampMs) {
  return {
    messageId: `m-${tokens}-${timestampMs}`,
    timestampMs,
    model: 'claude-sonnet-5',
    usage: { inputTokens: tokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  };
}

function ensure(ctx) {
  if (!ctx.bl605) ctx.bl605 = {};
  return ctx.bl605;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^per-role transcript usage records for the swarm$/, (ctx) => {
    const st = ensure(ctx);
    st.recordsByRole = {};
    st.expectedRoles = [];
    st.bucketMs = DAY;
    st.windowStartMs = WINDOW_START;
    st.windowEndMs = WINDOW_END;
  });

  scoped(/^every role has transcript usage records inside one window$/, (ctx) => {
    const st = ensure(ctx);
    st.expectedRoles = ['coder', 'cleaner'];
    st.recordsByRole = {
      coder: [usageRecord(120, WINDOW_START + 15 * 60 * 1000)],
      cleaner: [usageRecord(180, WINDOW_START + 30 * 60 * 1000)],
    };
  });

  scoped(/^global token consumption is aggregated for that window$/, (ctx) => {
    const st = ensure(ctx);
    st.windowSummary = summarizeGlobalTokenWindow({
      recordsByRole: st.recordsByRole,
      expectedRoles: st.expectedRoles,
      windowStartMs: st.windowStartMs,
      windowEndMs: st.windowEndMs,
    });
  });

  scoped(/^the series reports the cumulative total tokens across all roles$/, (ctx) => {
    assert.equal(ensure(ctx).windowSummary.cumulativeTotalTokens, 300);
  });

  scoped(/^the series reports a rate over the window$/, (ctx) => {
    assert.equal(ensure(ctx).windowSummary.rateTokensPerHour, 300);
  });

  scoped(/^fixture per-role usage records spanning more than one time bucket$/, (ctx) => {
    const st = ensure(ctx);
    st.expectedRoles = ['coder', 'cleaner'];
    st.bucketMs = HOUR;
    st.recordsByRole = {
      coder: [usageRecord(100, WINDOW_START), usageRecord(50, WINDOW_START + 2 * HOUR)],
      cleaner: [usageRecord(200, WINDOW_START), usageRecord(25, WINDOW_START + 2 * HOUR)],
    };
  });

  scoped(/^the global tokens aggregator runs$/, (ctx) => {
    const st = ensure(ctx);
    st.aggregationReadFiles = false;
    st.buckets = aggregateGlobalTokenBuckets({
      recordsByRole: st.recordsByRole,
      expectedRoles: st.expectedRoles,
      bucketMs: st.bucketMs,
    });
  });

  scoped(/^each bucket total equals the sum of every role's tokens in that bucket$/, (ctx) => {
    const st = ensure(ctx);
    const byStart = new Map();
    for (const [role, records] of Object.entries(st.recordsByRole)) {
      for (const rec of records) {
        const start = Math.floor(rec.timestampMs / st.bucketMs) * st.bucketMs;
        byStart.set(start, (byStart.get(start) ?? 0) + rec.usage.inputTokens);
      }
    }
    for (const bucket of st.buckets) {
      if (!bucket.incomplete) {
        assert.equal(bucket.totalTokens, byStart.get(bucket.bucketStartMs));
      }
    }
  });

  scoped(/^the aggregation reads no files of its own$/, (ctx) => {
    const src = fs.readFileSync(path.join(EXT_DIR, 'out', 'metrics', 'globalTokenConsumption.js'), 'utf8');
    assert.match(src, /aggregateGlobalTokenBuckets/);
    assert.doesNotMatch(src, /\breadFileSync\b/);
    assert.doesNotMatch(src, /\breaddirSync\b/);
    assert.equal(ensure(ctx).aggregationReadFiles, false);
  });

  scoped(/^a bucket where some roles have no transcript usage records$/, (ctx) => {
    const st = ensure(ctx);
    st.expectedRoles = ['coder', 'cleaner', 'architect'];
    st.recordsByRole = {
      coder: [usageRecord(100, WINDOW_START)],
      cleaner: [usageRecord(50, WINDOW_START)],
      architect: [],
    };
  });

  scoped(/^global token consumption is aggregated$/, (ctx) => {
    const st = ensure(ctx);
    st.buckets = aggregateGlobalTokenBuckets({
      recordsByRole: st.recordsByRole,
      expectedRoles: st.expectedRoles,
      bucketMs: DAY,
    });
  });

  scoped(/^that bucket is marked as having incomplete token data$/, (ctx) => {
    assert.equal(ensure(ctx).buckets[0].incomplete, true);
  });

  scoped(/^the bucket is not reported as a complete zero total$/, (ctx) => {
    assert.notEqual(ensure(ctx).buckets[0].totalTokens, 0);
    assert.equal(ensure(ctx).buckets[0].totalTokens, null);
  });

  scoped(/^populated transcript usage totals for every role$/, (ctx) => {
    const st = ensure(ctx);
    st.expectedRoles = ['coder'];
    st.recordsByRole = { coder: [usageRecord(42, WINDOW_START)] };
  });

  scoped(/^llm-cost ledger records whose token field is null$/, (ctx) => {
    ensure(ctx).ledgerRecords = [
      {
        type: 'llm_invocation',
        at: '2026-07-09T08:30:00.000Z',
        model: 'claude-sonnet-5',
        tokens: null,
        costUsd: null,
        origin: {
          subsystem: 'pipeline',
          role: 'coder',
          stage: null,
          trigger: 'handoff',
          ticketId: null,
          handoffId: null,
          handoffType: null,
          script: null,
          pack: null,
          model: null,
          provider: null,
        },
      },
    ];
  });

  scoped(/^global token consumption is computed$/, (ctx) => {
    const st = ensure(ctx);
    st.computed = computeGlobalTokenConsumptionFromTranscripts({
      recordsByRole: st.recordsByRole,
      expectedRoles: st.expectedRoles,
      bucketMs: DAY,
      ledgerRecords: st.ledgerRecords,
    });
  });

  scoped(/^the global series follows transcript usage totals$/, (ctx) => {
    assert.equal(ensure(ctx).computed.buckets[0].totalTokens, 42);
  });

  scoped(/^null ledger token fields are not summed into the global series$/, (ctx) => {
    assert.notEqual(ensure(ctx).computed.buckets[0].totalTokens, null);
    assert.equal(ensure(ctx).computed.buckets[0].totalTokens, 42);
  });
}

module.exports = { registerSteps };
