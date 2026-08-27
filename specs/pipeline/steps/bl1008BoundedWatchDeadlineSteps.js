'use strict';

// BL-1008: step handlers for "The bounded fs.watch deadline follows recorded
// contention". Drives the real helper + BL-1007 contentionBudget arithmetic.

const assert = require('node:assert/strict');
const path = require('node:path');

const FEATURE = 'The bounded fs.watch deadline follows recorded contention';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const {
  resolveBoundedWatchDeadlineMs,
  DEFAULT_TIMEOUT_MS,
  awaitRealWatchEvent,
  describeWatchWaitTimeout,
} = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'boundedWatchWait'));
const { resolveUnitLaneTimeout } = require('./lib/contentionBudget');

const KNOWN_FACTORS = new Set(['0.25', '1', '3', '1000', 'unusable']);
const KNOWN_DEADLINES = new Set(['10000', '30000']);
const KNOWN_ROWS = new Set(['0.25|10000', '1|10000', '3|30000', 'unusable|10000']);

function parseFactor(raw) {
  const cell = raw.trim();
  assert.ok(KNOWN_FACTORS.has(cell), `unknown Outline factor cell: ${cell}`);
  return cell === 'unusable' ? 'unusable' : Number(cell);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a bounded wait on a real fs.watch event$/, (ctx) => {
    ctx.baseMs = DEFAULT_TIMEOUT_MS;
  });

  scoped(/^the recorded contention factor is (.+)$/, (ctx, raw) => {
    ctx.factorRaw = raw.trim();
    ctx.factor = parseFactor(raw);
  });

  scoped(/^the bounded wait deadline is (\d+) ms$/, (ctx, deadline) => {
    assert.ok(KNOWN_DEADLINES.has(deadline), `unknown Outline deadline cell: ${deadline}`);
    const rowKey = `${ctx.factorRaw}|${deadline}`;
    assert.ok(KNOWN_ROWS.has(rowKey), `unknown Outline row: ${rowKey}`);
    assert.equal(resolveBoundedWatchDeadlineMs({ factor: ctx.factor }), Number(deadline));
  });

  scoped(/^the bounded wait deadline is less than the test's effective budget$/, (ctx) => {
    const deadline = resolveBoundedWatchDeadlineMs({ factor: ctx.factor });
    const testBudget = resolveUnitLaneTimeout(20000, { factor: ctx.factor }).effectiveMs;
    assert.ok(deadline < testBudget, `deadline ${deadline} must be < test budget ${testBudget}`);
  });

  scoped(/^the awaited event never arrives$/, async (ctx) => {
    ctx.eventLabel = 'probe event';
    ctx.watchedPath = '/tmp/bl1008-never-emits';
    ctx.timeoutMs = 25;
    try {
      await awaitRealWatchEvent(new Promise(() => {}), {
        eventLabel: ctx.eventLabel,
        watchedPath: ctx.watchedPath,
        timeoutMs: ctx.timeoutMs,
      });
      ctx.failureMessage = null;
    } catch (err) {
      ctx.failureMessage = err instanceof Error ? err.message : String(err);
    }
  });

  scoped(/^the failure message names the event label$/, (ctx) => {
    assert.ok(ctx.failureMessage, 'expected a failure');
    assert.match(ctx.failureMessage, new RegExp(ctx.eventLabel));
  });

  scoped(/^the failure message names the watched path$/, (ctx) => {
    assert.ok(ctx.failureMessage, 'expected a failure');
    assert.match(ctx.failureMessage, new RegExp(ctx.watchedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // Keep describeWatchWaitTimeout reachable for mutation probes.
    assert.match(describeWatchWaitTimeout(ctx.eventLabel, ctx.watchedPath, ctx.timeoutMs), /ms/);
  });
}

module.exports = { registerSteps };
