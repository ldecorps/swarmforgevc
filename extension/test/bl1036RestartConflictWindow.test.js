const assert = require('node:assert/strict');

const {
  shouldRaiseDegradedWarning,
  shouldRaisePollRecoveredNotice,
  shouldRaisePollUnresolvedNotice,
  describePollConflictWindow,
} = require('../out/tools/telegramFrontDeskBotCore');

// BL-1036. Twelve front-desk respawns between 04:30Z and 06:14Z on 2026-08-22
// were each followed by "409: Conflict: terminated by other getUpdates
// request". No second poller existed - the conflict is with the token's own
// just-killed poll, whose server-side slot Telegram holds until that long poll
// times out.
//
// The second half is observability: the log reports the degradation and never
// its end, so 626860 lines of supervisor log contain no recovery line at all
// and a human cannot tell a four-second blip from an outage.

const CONFIG = { degradedThreshold: 5, sustainedOutageThresholdMs: 300000 };

// ── the degraded report still fires exactly once per streak ───────────────

test('BL-1036: the existing degraded warning is unchanged - once per streak, at the threshold', () => {
  assert.equal(shouldRaiseDegradedWarning(5, CONFIG), true);
  assert.equal(shouldRaiseDegradedWarning(4, CONFIG), false);
  assert.equal(shouldRaiseDegradedWarning(6, CONFIG), false,
    'firing again mid-streak would restore the wall-of-degradations this ticket is about');
});

// ── invariant 2: a degradation is never left open ─────────────────────────

test('BL-1036: recovery is reported when a degraded poll starts succeeding again', () => {
  // The pair the log has never had: prev streak was past the threshold, this
  // cycle succeeded.
  assert.equal(shouldRaisePollRecoveredNotice(5, 0, CONFIG), true);
  assert.equal(shouldRaisePollRecoveredNotice(9, 0, CONFIG), true);
});

test('BL-1036: recovery is NOT reported for a streak that never reached the degraded threshold', () => {
  // Nothing was announced, so there is nothing to close. Announcing a recovery
  // for an unreported blip would be its own noise.
  assert.equal(shouldRaisePollRecoveredNotice(4, 0, CONFIG), false);
  assert.equal(shouldRaisePollRecoveredNotice(0, 0, CONFIG), false);
});

test('BL-1036: recovery is reported exactly once - the cycle after it, failures are 0 to 0', () => {
  assert.equal(shouldRaisePollRecoveredNotice(0, 0, CONFIG), false,
    'a second success must not re-announce a recovery already announced');
});

test('BL-1036: a still-failing cycle is not a recovery', () => {
  assert.equal(shouldRaisePollRecoveredNotice(5, 6, CONFIG), false);
});

test('BL-1036: an unresolved notice closes the degradation when the outage is sustained', () => {
  // The other way a degradation may end: it does not. Scenario 05 - recorded
  // as unresolved rather than retried in silence.
  assert.equal(shouldRaisePollUnresolvedNotice({ sustainedOutageReached: true, alreadyReported: false }), true);
});

test('BL-1036: the unresolved notice also fires exactly once', () => {
  assert.equal(shouldRaisePollUnresolvedNotice({ sustainedOutageReached: true, alreadyReported: true }), false,
    'repeating it every cycle would be the wall-of-degradations defect in a new costume');
  assert.equal(shouldRaisePollUnresolvedNotice({ sustainedOutageReached: false, alreadyReported: false }), false);
});

// ── the conflict window is described, so the log explains itself ──────────

test('BL-1036: a 409 is described as the just-killed predecessor holding the slot, not a rival', () => {
  // The API message accuses a second bot instance, which sent an operator
  // hunting for a rival poller that does not exist. The log must say what is
  // actually happening.
  const d = describePollConflictWindow(
    'Telegram API responded with status 409: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running',
    25
  );
  assert.ok(d, 'a 409 must be recognised as a conflict window');
  assert.ok(/25/.test(d), 'and must name the bound - the predecessor long poll times out server-side');
  assert.ok(/predecessor|previous|just-killed|own/i.test(d),
    `it must say the conflict is with our own prior poll, not a rival: ${d}`);
});

test('BL-1036: a non-409 failure is not described as a conflict window', () => {
  assert.equal(describePollConflictWindow('Telegram API responded with status 500', 25), undefined);
  assert.equal(describePollConflictWindow(undefined, 25), undefined);
});

// ── invariant 1: the old poll slot is released, not merely abandoned ──────
// The root cause, established from the code rather than assumed: the bot
// installed NO signal handler and defaultPost called fetch with NO signal, so
// a SIGTERM killed it mid-long-poll with the request still open. Telegram then
// held that getUpdates slot until its own 25s timeout, and the replacement
// polled straight into it. The 2s FRONT_DESK_KILL_GRACE_MS never mattered -
// the child died at once either way, so lengthening it could not have helped.

const { getTelegramUpdates } = require('../out/notify/telegramClient');

test('BL-1036: an abort signal is threaded through to the poll request', () => {
  // Without this the child has no way to release the slot on its way out, and
  // no shutdown handler can help it.
  let seen;
  const postFn = async (_url, _body, signal) => {
    seen = signal;
    return { ok: true, status: 200, json: { ok: true, result: [] } };
  };
  const controller = new AbortController();
  return getTelegramUpdates('tok', 0, 25, postFn, controller.signal).then(() => {
    assert.equal(seen, controller.signal, 'the poll must carry the caller_s abort signal');
  });
});

test('BL-1036: a poll with no signal still works - every existing caller is unaffected', () => {
  let called = false;
  const postFn = async () => {
    called = true;
    return { ok: true, status: 200, json: { ok: true, result: [] } };
  };
  return getTelegramUpdates('tok', 0, 25, postFn).then(() => {
    assert.equal(called, true, 'the signal is optional; omitting it changes nothing');
  });
});

const { installPollShutdownHandlers, abortInFlightPoll } = require('../out/tools/telegram-front-desk-bot');

test('BL-1036: a termination signal aborts the in-flight poll and then shuts down', () => {
  // Driven through an injected emitter - a test must never signal its own
  // process, and the ordering (abort BEFORE exit) is the whole point: exiting
  // first is exactly the abandon-the-slot behaviour being fixed.
  const handlers = {};
  let shutdownCalls = 0;
  installPollShutdownHandlers(
    { on: (event, listener) => { handlers[event] = listener; } },
    () => { shutdownCalls += 1; }
  );
  assert.ok(handlers.SIGTERM, 'SIGTERM must be handled - the supervisor sends it first');
  assert.ok(handlers.SIGINT, 'and SIGINT, for an operator stopping it by hand');
  handlers.SIGTERM();
  assert.equal(shutdownCalls, 1, 'the shutdown still happens; the abort does not replace it');
});

test('BL-1036: aborting with no poll in flight is harmless', () => {
  // Shutdown can land between cycles. It must not throw on the way out.
  assert.doesNotThrow(() => abortInFlightPoll());
});
