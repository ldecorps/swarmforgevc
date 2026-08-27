'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'context-compaction cadence trend exposes per-role context pressure';
const REPO = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO, 'extension');

function loadPure() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'compactionCadence'));
}

function loadTrend() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'trend'));
}

function ensure(ctx) {
  if (!ctx.bl601) ctx.bl601 = {};
  return ctx.bl601;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^context telemetry records compaction from structured invocation events$/, () => {});

  scoped(
    /^role "(.+)" on model "(.+)" had a context event with compaction true at (.+)$/,
    (ctx, role, model, ts) => {
      const st = ensure(ctx);
      st.event = { role: role.trim(), model: model.trim(), timestamp: ts.trim(), compaction: true };
    }
  );

  scoped(
    /^that event carried context utilization (\d+) percent and (\d+) input tokens$/,
    (ctx, utilPct, inputTokens) => {
      const st = ensure(ctx);
      st.event.contextUtilizationPct = Number(utilPct);
      st.event.inputTokens = Number(inputTokens);
    }
  );

  scoped(/^compaction cadence is derived for that event$/, (ctx) => {
    const st = ensure(ctx);
    st.record = loadPure().deriveCompactionRecordFromContextEvent(st.event);
  });

  scoped(/^one compaction record is emitted for role "(.+)"$/, (ctx, role) => {
    assert.ok(ensure(ctx).record);
    assert.equal(ensure(ctx).record.role, role.trim());
  });

  scoped(
    /^the record carries model "(.+)" tokens-at-compaction (\d+) and timestamp (.+)$/,
    (ctx, model, tokensAt, ts) => {
      const record = ensure(ctx).record;
      assert.equal(record.model, model.trim());
      assert.equal(record.tokensAtCompaction, Number(tokensAt));
      assert.equal(record.timestamp, ts.trim());
    }
  );

  scoped(/^fixture compaction records for multiple roles spanning more than one window$/, (ctx) => {
    const st = ensure(ctx);
    st.records = [
      {
        role: 'coder',
        model: 'claude-sonnet-5',
        tokensAtCompaction: 180000,
        timestamp: '2026-08-27T06:00:00Z',
        timestampMs: Date.parse('2026-08-27T06:00:00Z'),
      },
      {
        role: 'coder',
        model: 'claude-sonnet-5',
        tokensAtCompaction: 190000,
        timestamp: '2026-08-28T06:00:00Z',
        timestampMs: Date.parse('2026-08-28T06:00:00Z'),
      },
      {
        role: 'QA',
        model: 'gpt-5',
        tokensAtCompaction: 95000,
        timestamp: '2026-08-28T07:00:00Z',
        timestampMs: Date.parse('2026-08-28T07:00:00Z'),
      },
    ];
    st.detectableRoles = ['coder', 'QA'];
    st.nowMs = Date.parse('2026-08-29T00:00:00Z');
  });

  scoped(/^the compaction cadence series is aggregated in memory$/, (ctx) => {
    const st = ensure(ctx);
    st.agg = loadPure().aggregateCompactionCadence(st.records, st.detectableRoles, st.nowMs);
  });

  scoped(/^each window reports compactions per hour per role$/, (ctx) => {
    const agg = ensure(ctx).agg.filter((series) => series.applicable);
    assert.ok(agg.length >= 2);
    for (const series of agg) {
      assert.ok(series.windows.length >= 1);
      for (const window of series.windows) {
        assert.equal(typeof window.compactionsPerHour, 'number');
      }
    }
  });

  scoped(/^each window reports the token-at-compaction distribution for that role$/, (ctx) => {
    for (const series of ensure(ctx).agg.filter((item) => item.applicable)) {
      for (const window of series.windows) {
        assert.ok(window.tokenDistribution);
        assert.ok(Array.isArray(window.tokenDistribution.values));
      }
    }
  });

  scoped(/^the aggregation reads no files of its own$/, () => {
    const src = fs.readFileSync(path.join(EXT_DIR, 'src', 'metrics', 'compactionCadence.ts'), 'utf8');
    assert.doesNotMatch(src, /\bfs\b/);
    assert.doesNotMatch(src, /readFile/);
  });

  scoped(/^role "(.+)" has no reliable compaction signal in the telemetry stream$/, (ctx, role) => {
    ensure(ctx).undetectableRole = role.trim();
    ensure(ctx).detectableRoles = ['coder', 'QA'];
  });

  scoped(/^compaction cadence is queried for that role$/, (ctx) => {
    const st = ensure(ctx);
    st.roleSeries = loadPure().queryCompactionCadenceForRole(
      st.undetectableRole,
      [],
      st.detectableRoles,
      Date.parse('2026-08-29T00:00:00Z')
    );
  });

  scoped(/^the series for that role is marked not applicable$/, (ctx) => {
    assert.equal(ensure(ctx).roleSeries.applicable, false);
  });

  scoped(/^zero compactions are not reported$/, (ctx) => {
    const series = ensure(ctx).roleSeries;
    assert.equal(series.windows.length, 0);
    assert.equal(series.trend, null);
  });

  scoped(/^a role pane shows auto-compact or compacting spinner text$/, (ctx) => {
    ensure(ctx).spinnerText = 'auto-compact 92%';
  });

  scoped(/^no structured context event marks compaction true for that role$/, (ctx) => {
    ensure(ctx).contextEvents = [];
  });

  scoped(/^compaction cadence is derived$/, (ctx) => {
    const st = ensure(ctx);
    st.records = loadPure().deriveCompactionRecords({
      spinnerText: st.spinnerText,
      contextEvents: st.contextEvents,
    });
  });

  scoped(/^no compaction record is emitted from the spinner text alone$/, (ctx) => {
    assert.equal(ensure(ctx).records.length, 0);
  });

  scoped(/^a daily compactions-per-hour series for one role with more than one window$/, (ctx) => {
    ensure(ctx).windows = [
      {
        periodStart: '2026-08-27T00:00:00.000Z',
        compactionsPerHour: 0.1,
        tokenDistribution: { min: 180000, max: 180000, median: 180000, values: [180000] },
        compactionCount: 1,
      },
      {
        periodStart: '2026-08-28T00:00:00.000Z',
        compactionsPerHour: 0.2,
        tokenDistribution: { min: 190000, max: 190000, median: 190000, values: [190000] },
        compactionCount: 1,
      },
    ];
  });

  scoped(/^the compaction cadence trend is computed$/, (ctx) => {
    ensure(ctx).trend = loadTrend().trendForCompactionCadencePerHour(ensure(ctx).windows);
  });

  scoped(/^trend\.ts reports current prior delta and direction for the series$/, (ctx) => {
    const trend = ensure(ctx).trend;
    assert.equal(trend.currentValue, 0.2);
    assert.equal(trend.priorValue, 0.1);
    assert.equal(trend.delta, 0.1);
    assert.equal(trend.direction, 'up');
  });
}

module.exports = { registerSteps };
