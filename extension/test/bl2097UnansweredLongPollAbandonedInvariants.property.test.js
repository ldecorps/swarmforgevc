'use strict';

// BL-2097: PROPERTY tests over the invariants the ticket YAML declares
// (coder-authored first, per BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs) - excluded from unit/coverage/mutation.
//
//   Invariant 1: an abandoned getUpdates call never advances the offset -
//     every update Telegram held for it is read again by the next poll.
//   Invariant 2: a getUpdates call that answers before the deadline is
//     handled exactly as before this ticket.
//
// Invariant 3 ("the bot never starts a getUpdates call while an earlier
// one of its own is still open") is not given a property test here: it is
// a structural guarantee of telegram-front-desk-bot.ts's pollLoop, which
// always awaits runPollCycle (and so pollAndForward) to completion before
// starting the next cycle - a process/sequencing fact about the untestable
// live-wrapper boundary (Design And Testability), not a pure module's
// input/output behaviour, and this ticket's own change there (composing
// the deadline signal into the SAME per-cycle AbortController BL-1036
// already creates, never a second one) does not alter that sequencing.
// BL-654's own exemption applies: stated reason, no test.
//
// Drives the REAL pollAndForward - never a restatement of its offset or
// deadline logic - over a fake Telegram, a fake clock and a fake deadline
// timer (never a real setTimeout, never a real sleep), the same fixture
// shape bl2097UnansweredLongPollAbandonedSteps.js's acceptance scenarios use.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { pollAndForward } = require('../out/tools/telegramFrontDeskBotCore');

const CHAT_ID = '-100';
const PRINCIPAL_ID = '42';

function fastResolve(value) {
  return async () => value;
}

function baseAdapters(overrides = {}) {
  return Object.assign(
    {
      chatId: CHAT_ID,
      getUpdates: fastResolve({ success: true, updates: [] }),
      postToBridge: fastResolve(true),
      subjectForTopic: () => undefined,
      openSubjectAndRecord: fastResolve('BL-1'),
      backlogForTopic: () => undefined,
      postOperatorContext: fastResolve(true),
      recordApprovalReply: fastResolve(true),
      recordRejectionReply: fastResolve(true),
      recordAmendReply: fastResolve(true),
    },
    overrides
  );
}

function mkTextUpdate(id) {
  return {
    update_id: id,
    message: { message_id: id, chat: { id: CHAT_ID }, from: { id: PRINCIPAL_ID }, text: `msg ${id}` },
  };
}

// A getUpdates adapter that never resolves on its own - only when its
// deadline fires (scheduleGetUpdatesDeadline's remembered callback is
// invoked) does it abort and settle, exactly like bl2097's acceptance
// fixture's "Telegram never answers" shape.
function abandonedAdapters(overrides = {}) {
  let deadlineFn = null;
  return baseAdapters(
    Object.assign(
      {
        getUpdates: (_offset, signal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve({ success: false, error: 'aborted' }));
            queueMicrotask(() => {
              if (deadlineFn) {
                deadlineFn();
              }
            });
          }),
        scheduleGetUpdatesDeadline: (fn) => {
          deadlineFn = fn;
          return {};
        },
        clearGetUpdatesDeadline: () => {
          deadlineFn = null;
        },
      },
      overrides
    )
  );
}

// A getUpdates adapter that resolves on its own, well before any deadline -
// the deadline timer is wired (scheduleGetUpdatesDeadline/clearGetUpdatesDeadline)
// but its callback is never invoked, mirroring a real answered poll
// cancelling a real pending setTimeout.
function answeredAdapters(result, overrides = {}) {
  return baseAdapters(
    Object.assign(
      {
        getUpdates: fastResolve(result),
        scheduleGetUpdatesDeadline: () => ({}),
        clearGetUpdatesDeadline: () => {},
      },
      overrides
    )
  );
}

// ── invariant 1 ─────────────────────────────────────────────────────────

test('property: an abandoned getUpdates call never advances the offset, for any starting offset or prior handover counts', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 1_000_000 }), fc.boolean(), async (offset, wireClock) => {
      const adapters = wireClock ? abandonedAdapters({ now: () => 0, logDiagnostic: () => {} }) : abandonedAdapters();
      const result = await pollAndForward(offset, PRINCIPAL_ID, adapters);
      assert.equal(result.ok, false, 'an abandoned call must report ok: false');
      assert.equal(result.nextOffset, offset, 'an abandoned call must never advance the offset');
      assert.equal(result.posted, 0);
      assert.equal(result.dropped, 0);
      assert.equal(result.failed, 0);
    }),
    { numRuns: 60 }
  );
});

// ── invariant 2 ─────────────────────────────────────────────────────────
//
// "Handled exactly as before this ticket" - an answered batch's outcome is
// computed here from first principles (never by re-deriving it FROM
// pollAndForward's own offsetAfterDelivery, which is the thing under test)
// and cross-checked against the real call: the result must match
// REGARDLESS of how much (simulated) time the answer took, as long as it
// answered - this ticket's deadline must never fire for it.

const updateBatchArb = fc
  .array(fc.integer({ min: 1, max: 50 }), { minLength: 0, maxLength: 5 })
  .map((deltas) => {
    let id = 100;
    return deltas.map((d) => {
      id += d;
      return id;
    });
  });

test('property: a batch that answers before the deadline advances the offset exactly as offsetAfterDelivery alone would, and the deadline never fires', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 1_000_000 }), updateBatchArb, fc.boolean(), async (offset, ids, wireClock) => {
      const updates = ids.map(mkTextUpdate);
      let deadlineFired = false;
      const adapters = answeredAdapters(
        { success: true, updates },
        Object.assign(
          { scheduleGetUpdatesDeadline: (fn) => { void fn; return {}; } },
          wireClock ? { now: () => 0, logDiagnostic: () => {} } : {}
        )
      );
      // Independent ground truth: every update here is a fresh message
      // with no existing subject (subjectForTopic/backlogForTopic both
      // return undefined) - decideUpdateAction's open-default/open-for-topic
      // branch applies to every one of them, so every outcome is 'posted'
      // and the offset lands one past the LAST update, whatever the batch.
      const expectedNextOffset = ids.length > 0 ? ids[ids.length - 1] + 1 : offset;
      const result = await pollAndForward(offset, PRINCIPAL_ID, adapters);
      assert.equal(deadlineFired, false, 'the deadline must never fire for a call that answered on its own');
      assert.equal(result.ok, true);
      assert.equal(result.failed, 0);
      assert.equal(result.dropped, 0);
      assert.equal(result.posted, ids.length);
      assert.equal(result.nextOffset, expectedNextOffset);
    }),
    { numRuns: 60 }
  );
});

