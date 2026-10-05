'use strict';

// BL-1968: the closing ceremony folds every lifecycle event appended since
// the previous run, by append order, never by the date in its `at` stamp -
// the fold half split from BL-1456. Drives the REAL compiled
// runClosingCeremony/writeCeremonyRun/appendLeanLedgerEventIfNew directly,
// the same shape BL-1967's own sibling handler uses for its scenario 1
// (never the night CLI - these scenarios are about fold mechanics, not
// window/CLI wiring).

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');

const { mkTmpDir } = require(`${EXT_DIR}/test/helpers/tmpDir`);
const { writeCeremonyRun } = require(path.join(EXT_DIR, 'out', 'metrics', 'closingCeremonyStore'));
const { ceremonyDir } = require(path.join(EXT_DIR, 'out', 'metrics', 'closingCeremonyStore'));
const { appendLeanLedgerEventIfNew } = require(path.join(EXT_DIR, 'out', 'metrics', 'leanLedgerStore'));
const { runClosingCeremony } = require(path.join(EXT_DIR, 'out', 'metrics', 'closingCeremonyRun'));

const FEATURE = 'BL-1968 The closing ceremony folds every lifecycle event appended since the previous run';

// "Day D" / "day D+1" at 04:25, constructed the same way BL-1967's sibling
// does (local components), though these scenarios only ever call
// runClosingCeremony directly, which keys shiftKey off nowIso's own UTC
// date - so UTC is what matters here, not local TZ.
const D_MS = Date.UTC(2026, 7, 8, 4, 25, 0);
const D1_MS = Date.UTC(2026, 7, 9, 4, 25, 0);

function iso(ms) {
  return new Date(ms).toISOString();
}

function dayKeyOf(ms) {
  return iso(ms).slice(0, 10);
}

function emptyPacket(shiftKey) {
  return {
    shiftKey,
    leanLedgerEvents: [],
    pathTaken: [],
    dwellHotspots: [],
    bounceClasses: [],
    skipReasons: [],
    stalls: [],
    hypotheses: [],
    qualityRecommendations: [],
    determinismCandidates: [],
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a lifecycle ledger under a fixture root$/, (ctx) => {
    const target = fs.realpathSync(mkTmpDir('aps-bl1968-'));
    fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
    ctx.bl1968 = {
      target,
      dayD: dayKeyOf(D_MS),
      isoD: iso(D_MS),
      isoD1: iso(D1_MS),
      nextTicket: 9001,
    };
  });

  scoped(/^a previous ceremony run recorded as ending at 04:25Z on day D$/, (ctx) => {
    const { target, dayD, isoD } = ctx.bl1968;
    // Nothing folded yet by default - individual scenarios that need a
    // populated cursor (scenario 02) overwrite this same record after
    // appending their own event.
    writeCeremonyRun(target, {
      shiftKey: dayD,
      packet: emptyPacket(dayD),
      deliveredAt: isoD,
      windowStart: null,
      windowEnd: isoD,
      outcome: { type: 'no_change', ref: null, recordedAt: isoD },
      adjustments: [],
      failedAt: null,
      deliveryFailure: null,
      foldedLineCounts: {},
    });
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^a stage transition recorded at 21:00Z on day D$/, (ctx) => {
    const { target, dayD, nextTicket } = ctx.bl1968;
    ctx.bl1968.afterRunTicket = `BL-${nextTicket}`;
    ctx.bl1968.nextTicket += 1;
    appendLeanLedgerEventIfNew(target, {
      ticket: ctx.bl1968.afterRunTicket,
      type: 'stage_transition',
      source: 'stage-dwell',
      at: `${dayD}T21:00:00.000Z`,
      role: 'coder',
      data: { queueWaitMs: 100, processingMs: 1000 },
    });
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a stage transition recorded at 03:00Z on day D that the previous run folded$/, (ctx) => {
    const { target, dayD, isoD, nextTicket } = ctx.bl1968;
    ctx.bl1968.foldedTicket = `BL-${nextTicket}`;
    ctx.bl1968.nextTicket += 1;
    appendLeanLedgerEventIfNew(target, {
      ticket: ctx.bl1968.foldedTicket,
      type: 'stage_transition',
      source: 'stage-dwell',
      at: `${dayD}T03:00:00.000Z`,
      role: 'coder',
      data: { queueWaitMs: 100, processingMs: 1000 },
    });
    // This is the only event appended to day D's file so far: it is line 1,
    // so a cursor of 1 on that file means exactly this event was folded.
    writeCeremonyRun(target, {
      shiftKey: dayD,
      packet: emptyPacket(dayD),
      deliveredAt: isoD,
      windowStart: null,
      windowEnd: isoD,
      outcome: { type: 'no_change', ref: null, recordedAt: isoD },
      adjustments: [],
      failedAt: null,
      deliveryFailure: null,
      foldedLineCounts: { [`${dayD}.jsonl`]: 1 },
    });
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a bounce recorded at 20:00Z on day D whose event is stamped 00:00Z on day D$/, (ctx) => {
    const { target, dayD, nextTicket } = ctx.bl1968;
    ctx.bl1968.bounceTicket = `BL-${nextTicket}`;
    ctx.bl1968.nextTicket += 1;
    // leanLedgerComposeBounce.ts: every bounce event carries only the day
    // it happened, stamped at midnight - never the real time it was
    // recorded (20:00Z here is the real-world moment, not the `at` field).
    appendLeanLedgerEventIfNew(target, {
      ticket: ctx.bl1968.bounceTicket,
      type: 'bounce',
      source: 'bounce-store',
      at: `${dayD}T00:00:00.000Z`,
      data: { blamedRole: 'coder', failureClass: 'bl1968-fixture-class', commit: 'abc1234567' },
    });
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^no previous ceremony run on record$/, (ctx) => {
    // Undoes the Background's own ceremony-run write for just this
    // scenario: Gherkin runs the Background before every scenario, and
    // this step's text explicitly contradicts it.
    fs.rmSync(ceremonyDir(ctx.bl1968.target), { recursive: true, force: true });
  });

  scoped(/^stage transitions recorded on three different days$/, (ctx) => {
    const { target, nextTicket } = ctx.bl1968;
    const days = [D_MS - 2 * 24 * 60 * 60 * 1000, D_MS, D1_MS];
    ctx.bl1968.threeDayTickets = [];
    days.forEach((ms, i) => {
      const ticket = `BL-${nextTicket + i}`;
      ctx.bl1968.threeDayTickets.push(ticket);
      appendLeanLedgerEventIfNew(target, {
        ticket,
        type: 'stage_transition',
        source: 'stage-dwell',
        at: `${dayKeyOf(ms)}T05:00:00.000Z`,
        role: 'coder',
        data: { queueWaitMs: 100, processingMs: 1000 },
      });
    });
    ctx.bl1968.nextTicket += days.length;
  });

  scoped(/^the ceremony runs$/, (ctx) => {
    // A "now" safely after every seeded day, so the whole ledger is in the
    // past relative to this run - the point of this scenario is that there
    // is no previous ceremony run to tile onto at all.
    const nowMs = D1_MS + 24 * 60 * 60 * 1000;
    ctx.bl1968.result = runClosingCeremony(ctx.bl1968.target, iso(nowMs), { sendNote: () => {} });
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^nothing recorded since the previous run$/, () => {
    // Nothing to do: the Background's own ceremony run already carries an
    // empty cursor and no ledger event has been appended for this scenario.
  });

  // ── shared When/Then ─────────────────────────────────────────────────
  scoped(/^the ceremony runs at 04:25Z on day D\+1$/, (ctx) => {
    ctx.bl1968.result = runClosingCeremony(ctx.bl1968.target, ctx.bl1968.isoD1, { sendNote: () => {} });
  });

  scoped(/^the packet folds that stage transition$/, (ctx) => {
    const tickets = ctx.bl1968.result.run.packet.leanLedgerEvents.map((e) => e.ticket);
    assert.ok(tickets.includes(ctx.bl1968.afterRunTicket), `expected ${ctx.bl1968.afterRunTicket} in the folded events, got: ${tickets.join(', ')}`);
  });

  scoped(/^the packet does not fold that stage transition$/, (ctx) => {
    const tickets = ctx.bl1968.result.run.packet.leanLedgerEvents.map((e) => e.ticket);
    assert.ok(!tickets.includes(ctx.bl1968.foldedTicket), `expected ${ctx.bl1968.foldedTicket} NOT in the folded events (already folded), got: ${tickets.join(', ')}`);
  });

  scoped(/^the packet counts that bounce in its bounce classes$/, (ctx) => {
    const { bounceClasses } = ctx.bl1968.result.run.packet;
    const match = bounceClasses.find((b) => b.failureClass === 'bl1968-fixture-class');
    assert.ok(match, `expected a bounceClasses entry for bl1968-fixture-class, got: ${JSON.stringify(bounceClasses)}`);
    assert.equal(match.count, 1);
  });

  scoped(/^the packet folds every one of them$/, (ctx) => {
    const tickets = ctx.bl1968.result.run.packet.leanLedgerEvents.map((e) => e.ticket);
    for (const ticket of ctx.bl1968.threeDayTickets) {
      assert.ok(tickets.includes(ticket), `expected ${ticket} among the first run's folded events, got: ${tickets.join(', ')}`);
    }
    assert.equal(tickets.length, ctx.bl1968.threeDayTickets.length, 'the first run must fold exactly the events on record, nothing more');
  });

  scoped(/^the run carries the empty-window outcome the ceremony already defines$/, (ctx) => {
    const { result } = ctx.bl1968;
    assert.equal(result.status, 'auto_no_change', `expected the explicit empty-window status, got: ${result.status}`);
    assert.equal(result.run.outcome && result.run.outcome.type, 'no_change');
  });
}

module.exports = { registerSteps };
