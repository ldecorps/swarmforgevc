'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const {
  deriveIntakeBalanceEvents,
  computeIntakeBalance,
} = require(path.join(EXT_DIR, 'out', 'metrics', 'deliveryMetrics'));

const FEATURE = 'intake balance trend compares filed rate to close rate';

function commit(dateIso, changes) {
  return { commit: `c-${dateIso}`, dateIso, changes };
}

function ensure(ctx) {
  if (!ctx.bl599) ctx.bl599 = {};
  return ctx.bl599;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^backlog git history is available through the existing adapter$/, () => {});

  scoped(/^git history where one buildable ticket arrives and one closes in the window$/, (ctx) => {
    const st = ensure(ctx);
    st.entries = [
      commit('2026-01-01T10:00:00Z', [{ status: 'A', path: 'backlog/active/BL-101-ticket.yaml' }]),
      commit('2026-01-02T12:00:00Z', [{ status: 'R100', path: 'backlog/done/M8/BL-101-ticket.yaml' }]),
    ];
    st.nowMs = Date.parse('2026-01-03T00:00:00Z');
  });

  scoped(/^intake balance is computed for that history$/, (ctx) => {
    const st = ensure(ctx);
    const events = deriveIntakeBalanceEvents(st.entries);
    st.result = computeIntakeBalance(events, st.nowMs, 30);
  });

  scoped(/^the window reports one filed ticket$/, (ctx) => {
    assert.equal(ensure(ctx).result.trailingFiled, 1);
  });

  scoped(/^the window reports one closed ticket$/, (ctx) => {
    assert.equal(ensure(ctx).result.trailingClosed, 1);
  });

  scoped(/^the window net is zero$/, (ctx) => {
    assert.equal(ensure(ctx).result.trailingNet, 0);
  });

  scoped(/^fixture filed and closed event timestamps spanning multiple days$/, (ctx) => {
    const st = ensure(ctx);
    st.events = {
      filedAtMs: [Date.parse('2026-01-01T10:00:00Z'), Date.parse('2026-01-02T10:00:00Z')],
      closedAtMs: [Date.parse('2026-01-02T12:00:00Z')],
    };
    st.nowMs = Date.parse('2026-01-04T00:00:00Z');
  });

  scoped(/^intake balance is aggregated in memory$/, (ctx) => {
    const st = ensure(ctx);
    st.result = computeIntakeBalance(st.events, st.nowMs, 30);
  });

  scoped(/^each day reports filed and closed counts and daily net$/, (ctx) => {
    const series = ensure(ctx).result.dailySeries;
    assert.ok(series.length >= 2);
    for (const p of series) {
      assert.equal(p.net, p.filed - p.closed);
    }
  });

  scoped(/^a running net total is available across the series$/, (ctx) => {
    const series = ensure(ctx).result.dailySeries;
    const last = series[series.length - 1];
    assert.equal(last.runningNet, series.reduce((sum, p) => sum + p.net, 0));
  });

  scoped(/^git history recording (.+) for (.+)$/, (ctx, event, filePath) => {
    const st = ensure(ctx);
    const ev = event.trim();
    const p = filePath.trim();
    let changes;
    if (ev === 'ticket arrival' || ev === 'root intake doc' || ev === 'epic tracker') {
      changes = [{ status: 'A', path: p }];
    } else if (ev === 'ticket close') {
      changes = [{ status: 'R100', path: p }];
    } else {
      throw new Error(`unknown git history event "${ev}"`);
    }
    st.entries = [commit('2026-01-01T00:00:00Z', changes)];
  });

  scoped(/^intake balance events are derived$/, (ctx) => {
    ensure(ctx).events = deriveIntakeBalanceEvents(ensure(ctx).entries);
  });

  scoped(/^the filed count is (\d+)$/, (ctx, n) => {
    assert.equal(ensure(ctx).events.filedAtMs.length, Number(n));
  });

  scoped(/^the closed count is (\d+)$/, (ctx, n) => {
    assert.equal(ensure(ctx).events.closedAtMs.length, Number(n));
  });

  scoped(/^a daily net series with more than one window$/, (ctx) => {
    const st = ensure(ctx);
    st.events = {
      filedAtMs: [Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-01-02T00:00:00Z')],
      closedAtMs: [Date.parse('2026-01-01T12:00:00Z')],
    };
    st.nowMs = Date.parse('2026-01-03T00:00:00Z');
  });

  scoped(/^the net trend is computed$/, (ctx) => {
    const st = ensure(ctx);
    st.trend = computeIntakeBalance(st.events, st.nowMs, 30).trend;
  });

  scoped(/^trend\.ts reports current prior delta and direction for the net series$/, (ctx) => {
    const t = ensure(ctx).trend;
    assert.equal(typeof t.currentValue, 'number');
    assert.equal(typeof t.priorValue, 'number');
    assert.equal(typeof t.delta, 'number');
    assert.ok(['up', 'down', 'flat'].includes(t.direction));
  });
}

module.exports = { registerSteps };
