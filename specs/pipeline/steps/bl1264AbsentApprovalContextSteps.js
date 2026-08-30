'use strict';

// BL-1264: step handlers for "a pending-approval entry carries an approval
// context only when it has one". Drives the REAL compiled
// computeNeedsApproval / buildBacklogDashboard (extension/out/metrics/
// backlogDashboard) - the producer under test, never a re-implementation.
//
// Scenario 02 needs a BEFORE artefact to compare against. Rather than
// checking out the old build, it reconstructs the pre-fix entry shape
// directly - `{...entry, approvalContext: entry.approvalContext}`, which is
// exactly what the unconditional copy produced - and serialises both. That
// is the honest comparison: the claim being tested is that JSON.stringify
// makes the two shapes indistinguishable on the way out, which is why
// backlog.json never carried the key and no file consumer changes.

const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const {
  computeNeedsApproval,
  buildBacklogDashboard,
} = require(path.join(EXT_OUT, 'metrics', 'backlogDashboard'));

const FEATURE = 'BL-1264 a pending-approval entry carries an approval context only when it has one';

// engineering.prompt's Scenario Outline rule: both Examples columns resolve
// through an explicit lookup, never a bare passthrough.
const KNOWN_CONTEXT_STATE = {
  carries: 'a human call to make before this ships',
  'does not have': undefined,
};
const KNOWN_KEY_STATE = {
  carries: true,
  'does not have': false,
};

function known(table, key, label) {
  if (!Object.prototype.hasOwnProperty.call(table, key)) {
    throw new Error(`unknown ${label}: ${key}`);
  }
  return table[key];
}

function pendingTicket(approvalContext) {
  const item = { id: 'BL-100', title: 'Needs a look', status: 'active', humanApproval: 'pending' };
  // A ticket whose YAML omits approval_context: reaches the producer with
  // the property genuinely absent - the shape this ticket is about - so it
  // is never set to undefined here either.
  if (approvalContext !== undefined) {
    item.approvalContext = approvalContext;
  }
  return item;
}

function emptyDeliveryMetrics() {
  const emptyTrend = { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' };
  return {
    velocity: { weeklySeries: [], trend: emptyTrend, rollingWindowCount: 0, rollingWindowDays: 7 },
    burndown: [],
    cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, weeklySeries: [], trend: emptyTrend },
    forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
    suiteDurationTrend: { hasLocalData: false, dailySeries: [], trend: emptyTrend },
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a live ticket whose approval is pending$/, (ctx) => {
    ctx.approvalContext = undefined;
  });

  // ── Scenario 01 / 03 ──────────────────────────────────────────────────────
  scoped(/^the ticket (carries|does not have) an approval context$/, (ctx, state) => {
    ctx.approvalContext = known(KNOWN_CONTEXT_STATE, state, '<context state>');
  });

  scoped(/^a ticket that does not have an approval context$/, (ctx) => {
    ctx.approvalContext = known(KNOWN_CONTEXT_STATE, 'does not have', '<context state>');
  });

  scoped(/^the pending-approval set is computed$/, (ctx) => {
    ctx.entries = computeNeedsApproval([pendingTicket(ctx.approvalContext)], []);
    assert.equal(ctx.entries.length, 1, 'the fixture ticket did not reach the pending-approval set');
  });

  scoped(/^the entry (carries|does not have) an own approval context key$/, (ctx, state) => {
    const shouldCarry = known(KNOWN_KEY_STATE, state, '<key state>');
    // hasOwnProperty, never a truthiness check: a truthiness check passes
    // for BOTH shapes and would prove nothing.
    assert.equal(
      Object.prototype.hasOwnProperty.call(ctx.entries[0], 'approvalContext'),
      shouldCarry,
      `own keys were ${JSON.stringify(Object.keys(ctx.entries[0]))}`
    );
    if (shouldCarry) {
      assert.equal(ctx.entries[0].approvalContext, ctx.approvalContext);
    }
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────────
  scoped(/^the entry carries no empty string and no null in place of the context$/, (ctx) => {
    const entry = ctx.entries[0];
    assert.equal(Object.prototype.hasOwnProperty.call(entry, 'approvalContext'), false);
    // Named individually so a sentinel that slipped in would say which one.
    for (const sentinel of ['', null, 'none', 'n/a']) {
      assert.notEqual(entry.approvalContext, sentinel, `a missing context became ${JSON.stringify(sentinel)}`);
    }
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'title']);
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(/^a fixture backlog that produces a pending-approval set$/, (ctx) => {
    ctx.backlog = {
      active: [pendingTicket(undefined), pendingTicket('has one')],
      paused: [],
      done: [],
    };
    ctx.backlog.active[1].id = 'BL-101';
  });

  scoped(/^the dashboard artefact is generated before and after the change$/, (ctx) => {
    const data = buildBacklogDashboard(
      ctx.backlog,
      [],
      emptyDeliveryMetrics(),
      'primary',
      'abc',
      '2026-07-09T00:00:00Z'
    );
    ctx.afterJson = JSON.stringify(data);
    // The pre-fix producer's exact output: the key copied unconditionally,
    // undefined and all.
    ctx.beforeJson = JSON.stringify({
      ...data,
      needsApproval: data.needsApproval.map((e) => ({
        id: e.id,
        title: e.title,
        approvalContext: e.approvalContext,
      })),
    });
  });

  scoped(/^the two artefacts are identical$/, (ctx) => {
    assert.equal(ctx.afterJson, ctx.beforeJson, 'the serialised artefact changed - a file consumer would be affected');
    // The fixture holds TWO pending tickets, one with a context and one
    // without, so the key must appear exactly ONCE - not zero times (the
    // real context would have been lost) and not twice (the absent one
    // leaked through).
    const occurrences = ctx.afterJson.split('"approvalContext"').length - 1;
    assert.equal(occurrences, 1, `expected exactly one approvalContext key in the artefact, found ${occurrences}`);
    assert.ok(ctx.afterJson.includes('has one'), 'the context that DOES exist was lost from the artefact');
  });
}

module.exports = { registerSteps };
