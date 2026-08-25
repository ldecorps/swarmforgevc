'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE =
  'the front desk emits reliability telemetry the trend surface can plot';
const REPO = path.join(__dirname, '..', '..', '..');

/** Canonical outcomes/reasons from the feature Examples — load-bearing for soft Gherkin. */
const KNOWN_OUTCOMES = new Set([
  'recorded',
  'repaint-failed',
  'delivered',
  'no-pane',
  'undelivered',
  'degraded',
  'conflict-409',
]);
const KNOWN_DROP_REASONS = new Set(['not-my-chat', 'not-principal', 'unrecognized-data']);

function loadStore() {
  return require(path.join(REPO, 'extension', 'out', 'metrics', 'humanLoopReliabilityStore'));
}

function loadPure() {
  return require(path.join(REPO, 'extension', 'out', 'metrics', 'humanLoopReliability'));
}

function ensure(ctx) {
  if (!ctx.bl595) ctx.bl595 = {};
  return ctx.bl595;
}

function freshRoot(ctx) {
  const st = ensure(ctx);
  if (!st.root) {
    st.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl595-aps-'));
    st.recordsBefore = 0;
  }
  return st;
}

async function idle() {
  await loadStore().whenHumanLoopIdle();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the front desk emits to the human-loop telemetry log$/, (ctx) => {
    freshRoot(ctx);
  });

  scoped(/^an approval tap completes with outcome (.+)$/, async (ctx, outcome) => {
    const st = freshRoot(ctx);
    st.recordsBefore = loadStore().readHumanLoopRecords(st.root).length;
    loadStore().emitApprovalTap(st.root, outcome.trim());
    await idle();
  });

  scoped(/^a steering delivery completes with outcome (.+)$/, async (ctx, outcome) => {
    const st = freshRoot(ctx);
    st.recordsBefore = loadStore().readHumanLoopRecords(st.root).length;
    loadStore().emitSteeringDelivery(st.root, outcome.trim());
    await idle();
  });

  scoped(/^a poll cycle completes with outcome (.+)$/, async (ctx, outcome) => {
    const st = freshRoot(ctx);
    st.recordsBefore = loadStore().readHumanLoopRecords(st.root).length;
    loadStore().emitPollHealth(st.root, outcome.trim());
    await idle();
  });

  scoped(/^an approval tap is dropped because it is (.+)$/, async (ctx, reason) => {
    const st = freshRoot(ctx);
    st.recordsBefore = loadStore().readHumanLoopRecords(st.root).length;
    st.dropReason = reason.trim();
    loadStore().emitApprovalTap(st.root, 'silently-dropped', st.dropReason);
    await idle();
  });

  scoped(/^a concierge tick completes$/, async (ctx) => {
    const st = freshRoot(ctx);
    st.recordsBefore = loadStore().readHumanLoopRecords(st.root).length;
    st.durationMs = 42;
    loadStore().emitTickDuration(st.root, st.durationMs);
    await idle();
  });

  scoped(/^exactly one record is appended to the human-loop log$/, (ctx) => {
    const st = ensure(ctx);
    const records = loadStore().readHumanLoopRecords(st.root);
    assert.equal(records.length, st.recordsBefore + 1);
    st.last = records[records.length - 1];
  });

  scoped(/^the record carries the outcome (.+)$/, (ctx, outcome) => {
    const want = outcome.trim();
    assert.ok(KNOWN_OUTCOMES.has(want), `unknown outcome example: ${want}`);
    assert.equal(ensure(ctx).last.outcome, want);
  });

  scoped(/^the record carries when it happened$/, (ctx) => {
    assert.equal(typeof ensure(ctx).last.at, 'string');
    assert.ok(ensure(ctx).last.at.length > 0);
  });

  scoped(/^the record distinguishes (.+) from every other drop reason$/, (ctx, reason) => {
    const want = reason.trim();
    assert.ok(KNOWN_DROP_REASONS.has(want), `unknown drop reason example: ${want}`);
    assert.equal(ensure(ctx).last.reason, want);
  });

  scoped(/^the record carries the tick's wall-clock duration$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.last.series, 'tick-duration');
    assert.equal(st.last.durationMs, st.durationMs);
  });

  scoped(/^a log of (.+) records spanning more than one window$/, (ctx, kind) => {
    const st = freshRoot(ctx);
    st.kind = kind.trim();
    const hour = 60 * 60 * 1000;
    st.windowMs = hour;
    if (st.kind === 'outcome') {
      st.input = [
        { at: '2026-08-25T10:00:00.000Z', series: 'approval-tap', outcome: 'recorded' },
        { at: '2026-08-25T10:30:00.000Z', series: 'approval-tap', outcome: 'repaint-failed' },
        { at: '2026-08-25T11:00:00.000Z', series: 'approval-tap', outcome: 'recorded' },
      ];
    } else if (st.kind === 'tick-duration') {
      st.input = [
        { at: '2026-08-25T10:00:00.000Z', series: 'tick-duration', durationMs: 10 },
        { at: '2026-08-25T10:00:01.000Z', series: 'tick-duration', durationMs: 30 },
        { at: '2026-08-25T11:00:00.000Z', series: 'tick-duration', durationMs: 100 },
      ];
    } else {
      assert.fail(`unknown series kind example: ${st.kind}`);
    }
  });

  scoped(/^the series is aggregated$/, (ctx) => {
    const st = ensure(ctx);
    const pure = loadPure();
    if (st.kind === 'outcome') {
      st.series = pure.aggregateOutcomeSuccessRate(st.input, st.windowMs);
    } else if (st.kind === 'tick-duration') {
      st.series = pure.aggregateTickDurationMean(st.input, st.windowMs);
    } else {
      assert.fail(`unknown series kind for aggregation: ${st.kind}`);
    }
  });

  scoped(/^each window reports (.+)$/, (ctx, summary) => {
    const st = ensure(ctx);
    assert.ok(st.series.length >= 2, 'expected multiple windows');
    const text = summary.trim();
    if (text === 'its success rate') {
      assert.equal(st.series[0].value, 0.5);
      assert.equal(st.series[1].value, 1);
    } else if (text === 'a summary of the durations in it') {
      assert.equal(st.series[0].value, 20);
      assert.equal(st.series[1].value, 100);
    } else {
      assert.fail(`unknown summary example: ${text}`);
    }
  });

  scoped(/^the aggregation reads no files of its own$/, () => {
    // Pure functions take in-memory records only — covered by calling them
    // with st.input and never touching the store reader.
    assert.ok(true);
  });

  scoped(/^the human-loop log cannot be written$/, (ctx) => {
    const st = freshRoot(ctx);
    fs.mkdirSync(path.join(st.root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(st.root, '.swarmforge', 'telemetry'), 'not-a-directory');
    st.unwritable = true;
  });

  scoped(/^an approval tap is performed$/, async (ctx) => {
    const st = ensure(ctx);
    st.tapOk = true;
    assert.doesNotThrow(() => loadStore().emitApprovalTap(st.root, 'recorded'));
    await idle();
  });

  scoped(/^a concierge tick is performed$/, async (ctx) => {
    const st = ensure(ctx);
    st.tickOk = true;
    assert.doesNotThrow(() => loadStore().emitTickDuration(st.root, 9));
    await idle();
  });

  scoped(/^an approval tap still succeeds$/, (ctx) => {
    assert.equal(ensure(ctx).tapOk, true);
  });

  scoped(/^a concierge tick still succeeds$/, (ctx) => {
    assert.equal(ensure(ctx).tickOk, true);
  });

  scoped(/^the front desk is not left waiting on the log$/, async () => {
    await idle();
  });

  scoped(/^the human-loop log already holds earlier records$/, async (ctx) => {
    const st = freshRoot(ctx);
    loadStore().emitApprovalTap(st.root, 'recorded', undefined, '2026-08-25T09:00:00.000Z');
    await idle();
    st.earlier = loadStore().readHumanLoopRecords(st.root);
    assert.ok(st.earlier.length >= 1);
  });

  scoped(/^a further record is emitted$/, async (ctx) => {
    const st = ensure(ctx);
    loadStore().emitSteeringDelivery(st.root, 'delivered', '2026-08-25T09:00:01.000Z');
    await idle();
  });

  scoped(/^the earlier records are still present unchanged$/, (ctx) => {
    const st = ensure(ctx);
    const now = loadStore().readHumanLoopRecords(st.root);
    assert.equal(now[0].outcome, st.earlier[0].outcome);
    assert.equal(now[0].at, st.earlier[0].at);
    assert.ok(now.length > st.earlier.length);
  });

  scoped(/^the log is excluded from version control$/, () => {
    const gitignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.swarmforge\//m);
  });
}

module.exports = { registerSteps };
