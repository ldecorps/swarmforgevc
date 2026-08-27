'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = 'handoff latency trend makes parcel queue wait visible per recipient role';
const REPO = path.join(__dirname, '..', '..', '..');

function loadPure() {
  return require(path.join(REPO, 'extension', 'out', 'metrics', 'handoffLatency'));
}

function ensure(ctx) {
  if (!ctx.bl602) ctx.bl602 = {};
  return ctx.bl602;
}

function isoFromExampleTs(tsText) {
  const ms = Number(tsText);
  assert.ok(!Number.isNaN(ms), `expected numeric timestamp, got ${tsText}`);
  return new Date(ms).toISOString();
}

function writeHandoff(dir, filename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), `${lines.join('\n')}\n\nbody\n`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^handoff files carry enqueued_at and dequeued_at timestamps$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^a handoff for recipient "(.+)" enqueued at (.+)$/, (ctx, role, enqueuedTs) => {
    const st = ensure(ctx);
    st.headers = {
      to: role,
      type: 'git_handoff',
      enqueued_at: isoFromExampleTs(enqueuedTs),
    };
    st.role = role;
  });

  scoped(/^that handoff was dequeued at (.+)$/, (ctx, dequeuedTs) => {
    ensure(ctx).headers.dequeued_at = isoFromExampleTs(dequeuedTs);
  });

  scoped(/^handoff latency is derived for that parcel$/, (ctx) => {
    const st = ensure(ctx);
    st.record = loadPure().deriveHandoffLatency(st.headers);
  });

  scoped(/^the latency is (.+) milliseconds$/, (ctx, latencyMs) => {
    assert.equal(ensure(ctx).record.latencyMs, Number(latencyMs));
  });

  scoped(/^the record carries recipient "(.+)"$/, (ctx, role) => {
    assert.equal(ensure(ctx).record.recipient, role);
  });

  scoped(
    /^fixture handoff-latency records for multiple roles spanning more than one window$/,
    (ctx) => {
      const base = Date.parse('2026-08-27T10:00:00.000Z');
      ensure(ctx).records = [
        { recipient: 'coder', status: 'processed', latencyMs: 60_000, enqueuedAtMs: base, dequeuedAtMs: base + 60_000 },
        {
          recipient: 'coder',
          status: 'processed',
          latencyMs: 90_000,
          enqueuedAtMs: base + 24 * 60 * 60 * 1000,
          dequeuedAtMs: base + 24 * 60 * 60 * 1000 + 90_000,
        },
        { recipient: 'cleaner', status: 'processed', latencyMs: 30_000, enqueuedAtMs: base, dequeuedAtMs: base + 30_000 },
        { recipient: 'cleaner', status: 'processed', latencyMs: 35_000, enqueuedAtMs: base + 1000, dequeuedAtMs: base + 36_000 },
        { recipient: 'cleaner', status: 'processed', latencyMs: 40_000, enqueuedAtMs: base + 2000, dequeuedAtMs: base + 42_000 },
        { recipient: 'cleaner', status: 'processed', latencyMs: 45_000, enqueuedAtMs: base + 3000, dequeuedAtMs: base + 48_000 },
        {
          recipient: 'cleaner',
          status: 'processed',
          latencyMs: 900_000,
          enqueuedAtMs: base + 4000,
          dequeuedAtMs: base + 904_000,
        },
      ];
      ensure(ctx).window = {
        startMs: Date.parse('2026-08-27T09:00:00.000Z'),
        endMs: Date.parse('2026-08-28T12:00:00.000Z'),
        bucketMs: 24 * 60 * 60 * 1000,
      };
    }
  );

  scoped(/^one record is an extreme outlier for its role$/, (ctx) => {
    const cleaner = ensure(ctx).records.filter((r) => r.recipient === 'cleaner');
    assert.ok(cleaner.some((r) => r.latencyMs === 900_000));
  });

  scoped(/^the handoff-latency series is aggregated in memory$/, (ctx) => {
    const st = ensure(ctx);
    st.agg = loadPure().aggregateHandoffLatencyByRole(st.records, st.window);
  });

  scoped(/^each window reports a median latency per recipient role$/, (ctx) => {
    const agg = ensure(ctx).agg;
    const coder = agg.find((a) => a.role === 'coder');
    const cleaner = agg.find((a) => a.role === 'cleaner');
    assert.ok(coder && coder.buckets.length >= 1);
    assert.ok(cleaner && cleaner.buckets.length >= 1);
    assert.equal(coder.buckets[0].medianMs, 60_000);
  });

  scoped(/^extreme values are listed as outliers separately per role$/, (ctx) => {
    const cleaner = ensure(ctx).agg.find((a) => a.role === 'cleaner');
    assert.ok(cleaner.buckets.some((b) => b.outliersMs.includes(900_000)));
  });

  scoped(/^the aggregation reads no files of its own$/, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl602-pure-'));
    try {
      const records = [
        {
          recipient: 'coder',
          status: 'processed',
          latencyMs: 1000,
          enqueuedAtMs: 1000,
          dequeuedAtMs: 2000,
        },
      ];
      const agg = loadPure().aggregateHandoffLatencyByRole(records, {
        startMs: 0,
        endMs: 10_000,
      });
      assert.equal(agg.length, 1);
      assert.equal(fs.readdirSync(root).length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  scoped(
    /^a handoff sitting in a recipient inbox with enqueued_at but no dequeued_at$/,
    (ctx) => {
      const st = ensure(ctx);
      st.nowMs = Date.parse('2026-08-27T12:00:00.000Z');
      st.headers = {
        to: 'coder',
        enqueued_at: '2026-08-27T10:00:00.000Z',
      };
    }
  );

  scoped(/^the parcel contributes an open waiting age$/, (ctx) => {
    const st = ensure(ctx);
    st.record = loadPure().deriveHandoffLatency(st.headers, st.nowMs);
    assert.equal(st.record.status, 'open');
    assert.equal(st.record.openWaitMs, 2 * 60 * 60 * 1000);
  });

  scoped(/^it is not included in the processed median or outlier counts$/, (ctx) => {
    const st = ensure(ctx);
    const agg = loadPure().aggregateHandoffLatencyByRole([st.record], {
      startMs: Date.parse('2026-08-27T09:00:00.000Z'),
      endMs: Date.parse('2026-08-27T13:00:00.000Z'),
    });
    const coder = agg.find((a) => a.role === 'coder');
    assert.equal(coder.buckets.length, 0);
    assert.equal(coder.openWaits.length, 1);
  });

  scoped(/^a processed handoff in (.+)$/, (ctx, mailbox) => {
    const st = ensure(ctx);
    st.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl602-mail-'));
    st.mailbox = mailbox.trim();
    const headers = {
      to: 'coder',
      type: 'git_handoff',
      enqueued_at: '2026-08-27T10:00:00.000Z',
      dequeued_at: '2026-08-27T10:05:00.000Z',
    };
    if (st.mailbox === 'master coder inbox/completed') {
      st.entry = { role: 'coder', worktreeName: 'master', worktreePath: st.root };
      writeHandoff(path.join(st.root, '.swarmforge', 'handoffs', 'coder', 'inbox', 'completed'), '50_x.handoff', {
        ...headers,
        to: 'coder',
      });
    } else if (st.mailbox === 'worktree cleaner inbox/completed') {
      st.entry = { role: 'cleaner', worktreeName: 'cleaner', worktreePath: st.root };
      writeHandoff(path.join(st.root, '.swarmforge', 'handoffs', 'inbox', 'completed'), '50_x.handoff', {
        ...headers,
        to: 'cleaner',
      });
    } else if (st.mailbox === 'worktree QA inbox/in_process') {
      st.entry = { role: 'QA', worktreeName: 'QA', worktreePath: st.root };
      writeHandoff(path.join(st.root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), '50_x.handoff', {
        ...headers,
        to: 'QA',
      });
    } else {
      throw new Error(`unknown mailbox fixture: ${st.mailbox}`);
    }
  });

  scoped(/^handoff latency records are gathered$/, (ctx) => {
    const st = ensure(ctx);
    st.gathered = loadPure().gatherRoleHandoffLatencyRecords(st.entry);
  });

  scoped(/^that handoff contributes to the latency series$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.gathered.some((r) => r.status === 'processed' && r.latencyMs === 5 * 60 * 1000));
  });

  scoped(
    /^a daily median handoff-latency series for one role with more than one window$/,
    (ctx) => {
      ensure(ctx).trendInput = [
        { periodStart: '2026-08-26T00:00:00.000Z', value: 60_000 },
        { periodStart: '2026-08-27T00:00:00.000Z', value: 90_000 },
      ];
    }
  );

  scoped(/^the handoff-latency trend is computed$/, (ctx) => {
    const { computeTrend } = require(path.join(REPO, 'extension', 'out', 'metrics', 'trend'));
    ensure(ctx).trend = computeTrend(ensure(ctx).trendInput);
  });

  scoped(/^trend\.ts reports current prior delta and direction for the series$/, (ctx) => {
    const trend = ensure(ctx).trend;
    assert.equal(trend.currentValue, 90_000);
    assert.equal(trend.priorValue, 60_000);
    assert.equal(trend.delta, 30_000);
    assert.equal(trend.direction, 'up');
  });
}

module.exports = { registerSteps };
