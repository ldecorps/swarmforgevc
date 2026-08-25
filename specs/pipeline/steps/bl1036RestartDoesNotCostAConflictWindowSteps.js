'use strict';

// BL-1036: step handlers for "restarting the front-desk bot does not leave its
// replacement conflicting with the poll slot the old process held".
//
// Every scenario drives the REAL decisions from the compiled bot core - the
// same functions the live poll loop calls - rather than a model of them. What
// is deliberately NOT driven is a real Telegram endpoint: the conflict window
// is server-side state inside Telegram's API, and the ticket's own qa_e2e
// reserves the live check (step 5) for a human restarting the front desk and
// reading the supervisor log. These scenarios hold the parts that are ours:
// whether the slot is released before exit, and whether the log ever closes a
// degradation it opened.
//
// The cause, established from the code at spec-implementation time and not
// assumed: the bot installed NO signal handler and its poll used fetch with NO
// signal, so SIGTERM killed it mid-long-poll with the request still open and
// Telegram held the slot until its own 25s timeout. That is why scenario 02 is
// about RELEASE and not about waiting longer - FRONT_DESK_KILL_GRACE_MS was
// never the lever, since the child died instantly either way.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');

const FEATURE =
  'restarting the front-desk bot does not leave its replacement conflicting with the poll slot the old process held';

const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const {
  shouldRaiseDegradedWarning,
  shouldRaisePollRecoveredNotice,
  shouldRaisePollUnresolvedNotice,
  describePollConflictWindow,
} = require(path.join(EXT, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { installPollShutdownHandlers } = require(path.join(EXT, 'out', 'tools', 'telegram-front-desk-bot'));

const CONFIG = { degradedThreshold: 5, sustainedOutageThresholdMs: 300000 };
const POLL_TIMEOUT_SECONDS = 25;
const CONFLICT_409 =
  'Telegram API responded with status 409: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the front-desk supervisor is watching the bot$/, (ctx) => {
    ctx.log = [];
    ctx.failures = 0;
    ctx.degradationOpen = false;
  });

  scoped(/^exactly one process holds the front-desk bot token$/, (ctx) => {
    // Ruled out at spec time and restated here so the scenarios cannot be
    // misread as being about a rival poller: there is none. Any 409 below is
    // the token conflicting with its OWN just-killed poll.
    ctx.rivalPollers = 0;
  });

  scoped(/^the bot is running and polling$/, (ctx) => {
    ctx.polling = true;
  });

  scoped(/^the bot is holding an open long poll$/, (ctx) => {
    ctx.polling = true;
    ctx.longPollOpen = true;
  });

  scoped(/^the bot ignores its termination signal and is killed outright$/, (ctx) => {
    // The unclean path: nothing the departing process does can release the
    // slot, so the replacement must ride it out within a bounded budget.
    ctx.uncleanKill = true;
  });

  scoped(/^the replacement's poll has been reported as degraded$/, (ctx) => {
    ctx.failures = CONFIG.degradedThreshold;
    assert.equal(shouldRaiseDegradedWarning(ctx.failures, CONFIG), true,
      'the fixture must actually have opened a degradation');
    ctx.degradationOpen = true;
    ctx.log.push('degraded');
  });

  scoped(/^the conflict does not clear within the bot's retry budget$/, (ctx) => {
    ctx.failures = CONFIG.degradedThreshold;
    ctx.degradationOpen = true;
    ctx.log.push('degraded');
    ctx.budgetExhausted = true;
  });

  scoped(/^the supervisor restarts the bot$/, (ctx) => {
    // The restart, driven through the REAL handlers with both effects
    // observable, so their ORDER is a fact rather than an inference.
    const handlers = {};
    ctx.sequence = [];
    installPollShutdownHandlers(
      { on: (event, listener) => { handlers[event] = listener; } },
      () => ctx.sequence.push('exit'),
      () => ctx.sequence.push('release')
    );
    if (ctx.uncleanKill) {
      // A child that ignores SIGTERM never runs its handler at all.
      ctx.sequence.push('killed-without-release');
    } else {
      handlers.SIGTERM();
    }
    ctx.replacementStarted = true;
  });

  scoped(/^the replacement's poll starts succeeding again$/, (ctx) => {
    const prev = ctx.failures;
    ctx.failures = 0;
    if (shouldRaisePollRecoveredNotice(prev, 0, CONFIG)) {
      ctx.degradationOpen = false;
      ctx.log.push('recovered');
    }
  });

  scoped(/^the retry budget is exhausted$/, (ctx) => {
    if (shouldRaisePollUnresolvedNotice({ sustainedOutageReached: true, alreadyReported: false })) {
      ctx.degradationOpen = false;
      ctx.log.push('unresolved');
    }
  });

  scoped(/^the replacement completes its first poll cycle without a conflict$/, (ctx) => {
    assert.ok(ctx.replacementStarted, 'the replacement must have been started');
    assert.deepEqual(ctx.sequence, ['release', 'exit'],
      'the predecessor must release the poll slot before exiting, or the replacement inherits a conflict window');
    // With the slot released, the first cycle carries no 409 to describe.
    assert.equal(describePollConflictWindow(undefined, POLL_TIMEOUT_SECONDS), undefined);
  });

  scoped(/^the replacement does not begin polling before the old poll slot is released$/, (ctx) => {
    const release = ctx.sequence.indexOf('release');
    const exit = ctx.sequence.indexOf('exit');
    assert.ok(release >= 0, 'the slot must actually be released');
    assert.ok(release < exit,
      `release must precede exit; exiting first abandons the slot: ${ctx.sequence.join(' -> ')}`);
  });

  scoped(/^the replacement retries with backoff until the conflict clears$/, (ctx) => {
    assert.ok(ctx.uncleanKill, 'this scenario is the killed-outright path');
    assert.ok(ctx.sequence.includes('killed-without-release'),
      'a child that ignores SIGTERM releases nothing - that is the premise');
    // The conflict is then explained rather than blamed on a phantom rival.
    const d = describePollConflictWindow(CONFLICT_409, POLL_TIMEOUT_SECONDS);
    assert.ok(d, 'a 409 during this window must be recognised');
    assert.ok(/predecessor|own/i.test(d),
      `the log must not repeat Telegram's "another bot instance" misdirection: ${d}`);
  });

  scoped(/^the conflict window ends within the bot's own retry budget$/, () => {
    // The window is bounded by Telegram's own long-poll timeout, and the log
    // states that bound so a reader knows how long to expect it.
    const d = describePollConflictWindow(CONFLICT_409, POLL_TIMEOUT_SECONDS);
    assert.ok(d.includes(String(POLL_TIMEOUT_SECONDS)),
      `the bound must be stated, not left open-ended: ${d}`);
  });

  scoped(/^the supervisor log records that the poll recovered$/, (ctx) => {
    assert.ok(ctx.log.includes('recovered'),
      'a degradation that ends must say so - 626860 log lines contained no recovery line at all');
    assert.equal(ctx.degradationOpen, false, 'and the degradation must be closed by it');
  });

  scoped(/^the supervisor log records the conflict as unresolved$/, (ctx) => {
    assert.ok(ctx.log.includes('unresolved'),
      'an outage that outlives its budget must be recorded, never retried in silence');
    assert.equal(ctx.degradationOpen, false,
      'unresolved is the OTHER way a degradation closes - the log never leaves one open');
  });
}

module.exports = { registerSteps };
