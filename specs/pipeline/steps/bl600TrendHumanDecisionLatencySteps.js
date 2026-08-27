'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'human-decision latency trend separates approval-queue wait from swarm velocity';
const REPO = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO, 'extension');

function loadPure() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'humanDecisionLatency'));
}

function loadLatency() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'humanDecisionLatency'));
}

function loadTrend() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'trend'));
}

function ensure(ctx) {
  if (!ctx.bl600) ctx.bl600 = {};
  return ctx.bl600;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^approval ask and verdict timestamps are knowable from existing stores$/, () => {});

  scoped(/^ticket "(.+)" had an (\w+) ask posted at (\d+)$/, (ctx, ticket, gate, askTs) => {
    const st = ensure(ctx);
    st.ticket = ticket.trim();
    st.gate = gate.trim();
    st.askAtMs = Number(askTs);
  });

  scoped(/^the human decided that ticket at (\d+)$/, (ctx, verdictTs) => {
    ensure(ctx).verdictAtMs = Number(verdictTs);
  });

  scoped(/^human decision latency is derived for that ticket$/, (ctx) => {
    const st = ensure(ctx);
    const nowMs = st.verdictAtMs ?? Date.now();
    st.derived = loadPure().deriveTicketDecisionLatency(
      {
        ticketId: st.ticket,
        gate: st.gate,
        askAtMs: st.askAtMs,
        verdictAtMs: st.verdictAtMs,
      },
      nowMs
    );
  });

  scoped(/^the latency is (\d+) milliseconds$/, (ctx, latencyMs) => {
    assert.equal(ensure(ctx).derived.latencyMs, Number(latencyMs));
  });

  scoped(/^the record carries gate (\w+)$/, (ctx, gate) => {
    assert.equal(ensure(ctx).derived.gate, gate.trim());
  });

  scoped(/^fixture decision-latency records spanning more than one window$/, (ctx) => {
    const st = ensure(ctx);
    st.decided = [
      {
        ticketId: 'BL-1',
        gate: 'approve',
        latencyMs: 60000,
        verdictAtMs: Date.parse('2026-01-01T12:00:00Z'),
      },
      {
        ticketId: 'BL-2',
        gate: 'approve',
        latencyMs: 65000,
        verdictAtMs: Date.parse('2026-01-02T12:00:00Z'),
      },
      {
        ticketId: 'BL-3',
        gate: 'approve',
        latencyMs: 70000,
        verdictAtMs: Date.parse('2026-01-02T14:00:00Z'),
      },
      {
        ticketId: 'BL-4',
        gate: 'approve',
        latencyMs: 72000,
        verdictAtMs: Date.parse('2026-01-02T15:00:00Z'),
      },
    ];
    st.nowMs = Date.parse('2026-01-03T00:00:00Z');
  });

  scoped(/^one record is an extreme outlier$/, (ctx) => {
    ensure(ctx).decided.push({
      ticketId: 'BL-5',
      gate: 'approve',
      latencyMs: 3_700_000,
      verdictAtMs: Date.parse('2026-01-02T16:00:00Z'),
    });
  });

  scoped(/^the decision-latency series is aggregated in memory$/, (ctx) => {
    const st = ensure(ctx);
    st.agg = loadPure().aggregateDecisionLatency(st.decided, [], st.nowMs);
  });

  scoped(/^each window reports a median decision latency$/, (ctx) => {
    const windows = ensure(ctx).agg.windows.filter((w) => w.decidedCount > 0);
    assert.ok(windows.length >= 2);
    for (const w of windows) {
      assert.ok(typeof w.medianMs === 'number');
    }
  });

  scoped(/^extreme values are listed as outliers separately$/, (ctx) => {
    const day = ensure(ctx).agg.windows.find((w) => w.decidedCount >= 4);
    assert.ok(day);
    assert.ok(day.outliersMs.length >= 1);
    assert.ok(day.outliersMs.includes(3_700_000));
  });

  scoped(/^the aggregation reads no files of its own$/, () => {
    const src = fs.readFileSync(
      path.join(EXT_DIR, 'src', 'metrics', 'humanDecisionLatency.ts'),
      'utf8'
    );
    assert.doesNotMatch(src, /\bfs\b/);
    assert.doesNotMatch(src, /readFile/);
  });

  scoped(/^ticket "(.+)" has a pending approval ask posted earlier$/, (ctx, ticket) => {
    const st = ensure(ctx);
    st.ticket = ticket.trim();
    st.askAtMs = 1000;
    st.nowMs = 601000;
  });

  scoped(/^no verdict has been recorded yet$/, () => {});

  scoped(/^the ticket contributes an open waiting age$/, (ctx) => {
    assert.equal(typeof ensure(ctx).derived.openAgeMs, 'number');
    assert.ok(ensure(ctx).derived.openAgeMs > 0);
  });

  scoped(/^it is not included in the decided median or outlier counts$/, (ctx) => {
    const st = ensure(ctx);
    const { decided, openWaits } = loadPure().partitionDecisionLatencies(
      [{ ticketId: st.ticket, gate: 'approve', askAtMs: st.askAtMs }],
      st.nowMs
    );
    assert.equal(decided.length, 0);
    assert.equal(openWaits.length, 1);
    const agg = loadPure().aggregateDecisionLatency(decided, openWaits, st.nowMs);
    assert.equal(agg.windows.every((w) => w.decidedCount === 0), true);
  });

  scoped(/^a daily median decision-latency series with more than one window$/, (ctx) => {
    ensure(ctx).windows = [
      { periodStart: '2026-01-01T00:00:00.000Z', medianMs: 60000, outliersMs: [], decidedCount: 2 },
      { periodStart: '2026-01-02T00:00:00.000Z', medianMs: 90000, outliersMs: [], decidedCount: 3 },
    ];
  });

  scoped(/^the decision-latency trend is computed$/, (ctx) => {
    const st = ensure(ctx);
    st.trend = loadLatency().trendForDecisionLatencyMedian(st.windows);
  });

  scoped(/^trend\.ts reports current prior delta and direction for the series$/, (ctx) => {
    const trend = ensure(ctx).trend;
    assert.equal(trend.currentValue, 90000);
    assert.equal(trend.priorValue, 60000);
    assert.equal(trend.delta, 30000);
    assert.equal(trend.direction, 'up');
  });
}

module.exports = { registerSteps };
