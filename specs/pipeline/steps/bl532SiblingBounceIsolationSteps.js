'use strict';

// BL-532: step handlers for sibling-bounce isolation - a parcel with no
// failing check of its own is DEFERRED pending the blocker, never re-queued
// for rework. Drives the REAL compiled siblingDeferral.ts core
// (decideDisposition/openBlockersForTicket) plus the REAL compiled
// siblingDeferralStore.ts and qaBounceStore.ts over a real temp target root
// - a genuine fs round trip, no fakes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { decideDisposition, openBlockersForTicket } = require(path.join(EXT_OUT, 'quality', 'siblingDeferral'));
const { appendSiblingDeferralRecordIfNew, readSiblingDeferralRecords } = require(path.join(EXT_OUT, 'metrics', 'siblingDeferralStore'));
const { readQaBounceRecords } = require(path.join(EXT_OUT, 'metrics', 'qaBounceStore'));

const TICKET_IDS = { A: 'BL-9001', B: 'BL-9002', D: 'BL-9004' };
const FAILURE_CLASS = 'integration';
const CHECK_COMMAND = 'npm run compile';
const KNOWN_SIGNATURE_RELATIONS = ['the same signature as', 'a different signature from'];

function mkTmpTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl532-'));
}

function recomputeDispositionForTicketB(ctx, observedFailure) {
  const records = readSiblingDeferralRecords(ctx.target);
  const openBlockers = openBlockersForTicket(records, ctx.ticketB);
  ctx.disposition = decideDisposition(openBlockers, observedFailure ?? null);
}

function assertDeferredPending(ctx, expectedTicket) {
  if (ctx.disposition.kind !== 'defer') {
    throw new Error(`expected ticket B to be deferred, got disposition "${ctx.disposition.kind}"`);
  }
  if (ctx.disposition.blockers.length !== 1 || ctx.disposition.blockers[0].blockedBy !== expectedTicket) {
    throw new Error(`expected ticket B deferred pending only ${expectedTicket}, got ${JSON.stringify(ctx.disposition.blockers)}`);
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a batch commit that satisfies several tickets and carries one ticket's failing check$/, (ctx) => {
    ctx.target = mkTmpTarget();
    ctx.sharedCommit = 'abc1234567';
  });

  // ── scenario 01/02 shared Given ──────────────────────────────────────
  registry.define(/^ticket A fails a check on the shared commit$/, (ctx) => {
    ctx.blockerA = {
      blockedBy: TICKET_IDS.A,
      failureClass: FAILURE_CLASS,
      check: CHECK_COMMAND,
      commit: ctx.sharedCommit,
      at: '2026-07-17T10:00:00.000Z',
    };
  });

  registry.define(/^ticket B rides the same commit with no failing check of its own$/, (ctx) => {
    ctx.ticketB = TICKET_IDS.B;
  });

  // ── scenario 01/02 shared When ────────────────────────────────────────
  // The first-encounter disposition: QA has just verified the batch, sees A
  // failed and B did not, and dispositions B directly from that observation
  // (no store lookup needed yet - the store gets its FIRST entry here, via
  // the same `defer` write the live QA.prompt wiring performs). This is the
  // real production sequence: decide, then record.
  registry.define(/^QA dispositions ticket B$/, (ctx) => {
    ctx.qaBounceCountBefore = readQaBounceRecords(ctx.target).length;
    ctx.disposition = decideDisposition([ctx.blockerA], null);
    if (ctx.disposition.kind === 'defer') {
      for (const blocker of ctx.disposition.blockers) {
        appendSiblingDeferralRecordIfNew(ctx.target, {
          ticket: ctx.ticketB,
          blockedBy: blocker.blockedBy,
          action: 'defer',
          failureClass: blocker.failureClass,
          check: blocker.check,
          commit: ctx.sharedCommit,
          at: '2026-07-17T10:00:00.000Z',
        });
      }
      ctx.reworkHandoffSent = false;
    } else {
      // decideDisposition can only return 'bounce' here if it were ever
      // called with an observed failure of B's own - it never is in this
      // scenario, so this branch exists only to keep the "no rework
      // handoff" assertion honest if that ever changes.
      ctx.reworkHandoffSent = true;
    }
  });

  // ── scenario 01 Then ──────────────────────────────────────────────────
  registry.define(/^no rework handoff is sent for ticket B$/, (ctx) => {
    if (ctx.reworkHandoffSent !== false) {
      throw new Error('expected no rework handoff to be sent for ticket B');
    }
  });

  // ── scenario 02 Then ────────────────────────────────────────────────────
  registry.define(/^the QA-bounce tally for the producing role is unchanged$/, (ctx) => {
    const after = readQaBounceRecords(ctx.target).length;
    if (ctx.qaBounceCountBefore !== 0 || after !== ctx.qaBounceCountBefore) {
      throw new Error(`expected the QA-bounce tally to stay unchanged across a deferral (before=${ctx.qaBounceCountBefore}, after=${after})`);
    }
  });

  // ── scenario 03/04/05 shared Given ──────────────────────────────────────
  registry.define(/^ticket B has an open deferral pending ticket A$/, (ctx) => {
    ctx.target = mkTmpTarget();
    ctx.ticketB = TICKET_IDS.B;
    appendSiblingDeferralRecordIfNew(ctx.target, {
      ticket: ctx.ticketB,
      blockedBy: TICKET_IDS.A,
      action: 'defer',
      failureClass: FAILURE_CLASS,
      check: CHECK_COMMAND,
      commit: 'abc1234567',
      at: '2026-07-17T10:00:00.000Z',
    });
  });

  // ── scenario 06 Given ─────────────────────────────────────────────────
  registry.define(/^ticket B has open deferrals pending ticket A and ticket D$/, (ctx) => {
    ctx.target = mkTmpTarget();
    ctx.ticketB = TICKET_IDS.B;
    appendSiblingDeferralRecordIfNew(ctx.target, {
      ticket: ctx.ticketB,
      blockedBy: TICKET_IDS.A,
      action: 'defer',
      failureClass: FAILURE_CLASS,
      check: CHECK_COMMAND,
      commit: 'abc1234567',
      at: '2026-07-17T10:00:00.000Z',
    });
    appendSiblingDeferralRecordIfNew(ctx.target, {
      ticket: ctx.ticketB,
      blockedBy: TICKET_IDS.D,
      action: 'defer',
      failureClass: 'unit',
      check: 'npm run test:unit',
      commit: 'abc1234567',
      at: '2026-07-17T10:00:01.000Z',
    });
  });

  // ── scenario 03 When ──────────────────────────────────────────────────
  registry.define(/^QA asks for ticket B's disposition at a later commit$/, (ctx) => {
    recomputeDispositionForTicketB(ctx, null);
  });

  // ── scenario 04/06 shared When ────────────────────────────────────────
  registry.define(/^QA clears ticket B's deferral pending ticket A at a later commit$/, (ctx) => {
    appendSiblingDeferralRecordIfNew(ctx.target, {
      ticket: ctx.ticketB,
      blockedBy: TICKET_IDS.A,
      action: 'clear',
      commit: 'def4567890',
      at: '2026-07-18T10:00:00.000Z',
    });
    recomputeDispositionForTicketB(ctx, null);
  });

  // ── scenario 05 (Outline) When ───────────────────────────────────────
  registry.define(
    /^QA observes a failure on ticket B with (the same signature as|a different signature from) the open deferral's signature$/,
    (ctx, relation) => {
      if (!KNOWN_SIGNATURE_RELATIONS.includes(relation)) {
        throw new Error(`bl532-05: unrecognized <signature relation> example value "${relation}"`);
      }
      const observedFailure =
        relation === 'the same signature as'
          ? { failureClass: FAILURE_CLASS, check: '  npm  run   compile  ' } // whitespace differs; same signature after normalization
          : { failureClass: 'unit', check: 'npm run test:unit' };
      recomputeDispositionForTicketB(ctx, observedFailure);
    }
  );

  // ── scenario 01/03/05a/06 shared Then (parameterized by blocker letter) ─
  registry.define(/^QA is told ticket B is deferred pending ticket ([A-Z])$/, (ctx, letter) => {
    const expectedTicket = TICKET_IDS[letter];
    if (!expectedTicket) {
      throw new Error(`bl532: unrecognized ticket letter "${letter}"`);
    }
    assertDeferredPending(ctx, expectedTicket);
  });

  // ── scenario 03 Then ──────────────────────────────────────────────────
  registry.define(/^QA is given the blocker's failing command to re-run$/, (ctx) => {
    const blocker = ctx.disposition.kind === 'defer' ? ctx.disposition.blockers[0] : null;
    if (!blocker || blocker.check !== CHECK_COMMAND) {
      throw new Error(`expected the blocker's recorded check "${CHECK_COMMAND}", got ${JSON.stringify(blocker)}`);
    }
  });

  // ── scenario 04 Then ──────────────────────────────────────────────────
  registry.define(/^QA is told ticket B is ready to verify$/, (ctx) => {
    if (ctx.disposition.kind !== 'verify') {
      throw new Error(`expected ticket B to be ready to verify, got disposition "${ctx.disposition.kind}"`);
    }
  });

  // ── scenario 05b (Outline) Then ─────────────────────────────────────
  registry.define(/^QA is told ticket B is bounced for its own defect$/, (ctx) => {
    if (ctx.disposition.kind !== 'bounce') {
      throw new Error(`expected ticket B to bounce for its own defect, got disposition "${ctx.disposition.kind}"`);
    }
  });
}

module.exports = { registerSteps };
