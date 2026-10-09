'use strict';

// BL-2097: step handlers for "a long poll that never answers is abandoned
// before the supervisor kills the bot". Drives the REAL runPollCycle (which
// calls the REAL pollAndForward) and the REAL applyPollCycleResult - never
// a restatement of either - over a fake Telegram, a fake clock and a fake
// deadline timer (never a real setTimeout, never a real sleep), mirroring
// bl2072FrontDeskStallNamesPhaseSteps.js's own fixture shape.

const assert = require('node:assert/strict');
const path = require('node:path');
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');

const OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const FEATURE = 'BL-2097 A long poll that never answers is abandoned before the supervisor kills the bot';

let _core = null;
function core() {
  if (!_core) {
    _core = require(path.join(OUT, 'tools', 'telegramFrontDeskBotCore'));
  }
  return _core;
}

const CHAT_ID = '-100';
const PRINCIPAL_ID = '42';

const BACKOFF_CONFIG = { backoffBaseMs: 1000, backoffMaxMs: 8000, degradedThreshold: 3, sustainedOutageThresholdMs: 30 * 60_000 };

// Same shape as bl2072's own makeFakeClock - advances when told, never a
// real sleep.
function makeFakeClock() {
  let current = 0;
  return {
    now: () => current,
    advanceMs: (ms) => {
      current += ms;
    },
  };
}

function makeDiagnosticsCapture() {
  const lines = [];
  return { lines, logDiagnostic: (line) => lines.push(line) };
}

function fastResolve(value) {
  return async () => value;
}

function mkTextUpdate(id, text) {
  return {
    update_id: id,
    message: { message_id: id, chat: { id: CHAT_ID }, from: { id: PRINCIPAL_ID }, text },
  };
}

// The fake deadline timer: scheduleGetUpdatesDeadline just REMEMBERS the
// callback and its ms (never invokes it itself - there is no real clock
// ticking here), clearGetUpdatesDeadline forgets it. Whichever fake
// getUpdates below is wired decides whether that remembered callback ever
// actually fires - a "never answers" fixture fires it itself (simulating
// the real setTimeout that would have fired after 40 real seconds); a
// "answers after N seconds" fixture never touches it, so pollAndForward's
// own clear() cancels it unfired, exactly like a real answered poll
// cancelling a real pending setTimeout.
function makeFakeDeadlineTimer(st) {
  return {
    scheduleGetUpdatesDeadline: (fn, ms) => {
      st.deadlineFn = fn;
      st.deadlineMs = ms;
      return { fn, ms };
    },
    clearGetUpdatesDeadline: (handle) => {
      if (st.deadlineFn === handle?.fn) {
        st.deadlineFn = null;
      }
    },
  };
}

function baseAdapters(st, overrides = {}) {
  const timer = makeFakeDeadlineTimer(st);
  return Object.assign(
    {
      chatId: CHAT_ID,
      now: st.clock.now,
      logDiagnostic: st.diagnostics.logDiagnostic,
      scheduleGetUpdatesDeadline: timer.scheduleGetUpdatesDeadline,
      clearGetUpdatesDeadline: timer.clearGetUpdatesDeadline,
      getUpdates: fastResolve({ success: true, updates: [] }),
      postToBridge: fastResolve(true),
      subjectForTopic: () => undefined,
      openSubjectAndRecord: fastResolve('BL-9097'),
      backlogForTopic: () => undefined,
      postOperatorContext: fastResolve(true),
      recordApprovalReply: fastResolve(true),
      recordRejectionReply: fastResolve(true),
      recordAmendReply: fastResolve(true),
      setPendingButtonAction: fastResolve(undefined),
      answerCallbackQuery: fastResolve(undefined),
    },
    overrides
  );
}

function makeFixture(ctx) {
  const opDir = mkTmpDir('bl2097-fixture-');
  const diagnostics = makeDiagnosticsCapture();
  const clock = makeFakeClock();
  ctx.bl2097 = {
    opDir,
    diagnostics,
    clock,
    deadlineFn: null,
    deadlineMs: 0,
    wasAborted: false,
    postedUpdateIds: [],
    heartbeatCalls: 0,
  };
  return ctx.bl2097;
}

async function runOnePollCycle(ctx, offset) {
  const st = ctx.bl2097;
  const state = { offset, consecutiveFailures: 0, stuckAttempts: 0, sustainedOutage: { escalated: false } };
  const cycle = await core().runPollCycle(state, PRINCIPAL_ID, st.adapters, BACKOFF_CONFIG, 0);
  await core().applyPollCycleResult(
    cycle,
    () => {},
    async () => {},
    async () => {},
    () => {
      st.heartbeatCalls += 1;
    }
  );
  st.cycle = cycle;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(new RegExp("^a front-desk bot over a fake Telegram, a fake clock and a temp operator directory$"), (ctx) => {
    makeFixture(ctx);
  });

  // ── unanswered-long-poll-is-abandoned-01 ────────────────────────────────
  scoped(new RegExp("^Telegram never answers the bot's getUpdates call$"), (ctx) => {
    const st = ctx.bl2097;
    st.adapters = baseAdapters(st, {
      getUpdates: (_offset, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            st.wasAborted = signal.aborted;
            resolve({ success: false, error: 'aborted' });
          });
          // The real setTimeout pollAndForward schedules would fire after
          // DEFAULT_GET_UPDATES_DEADLINE_MS of real time; here, simulate
          // that firing (and only that - a real wait never happens) by
          // advancing the fake clock and invoking the remembered callback
          // directly, the way a genuinely unanswered Telegram call would
          // sit until the deadline, never until something else resolves it.
          queueMicrotask(() => {
            if (st.deadlineFn) {
              st.clock.advanceMs(st.deadlineMs);
              st.deadlineFn();
            }
          });
        }),
    });
  });

  scoped(new RegExp("^the bot runs one poll cycle from offset 41$"), async (ctx) => {
    await runOnePollCycle(ctx, 41);
  });

  scoped(new RegExp("^the cycle ends by the 45th second of the fake clock$"), (ctx) => {
    const st = ctx.bl2097;
    assert.ok(st.clock.now() <= 45000, `expected the fake clock to read at most 45000ms, read ${st.clock.now()}ms`);
  });

  scoped(new RegExp("^the getUpdates request was aborted before the cycle ended$"), (ctx) => {
    assert.equal(ctx.bl2097.wasAborted, true, 'expected the getUpdates request to have been aborted');
  });

  scoped(new RegExp("^the cycle writes the poll heartbeat$"), (ctx) => {
    assert.equal(ctx.bl2097.heartbeatCalls, 1, 'expected exactly one heartbeat write for the cycle');
  });

  scoped(new RegExp("^front-desk-diagnostics\\.log gains a line naming getUpdates wait as abandoned and its duration$"), (ctx) => {
    const { lines } = ctx.bl2097.diagnostics;
    const line = lines.find((l) => l.includes('getUpdates') && l.includes('abandoned'));
    assert.ok(line, `expected a diagnostic line naming getUpdates wait as abandoned, got: ${JSON.stringify(lines)}`);
    assert.match(line, /\d+ms/, `expected the line to carry a duration, got: ${line}`);
  });

  scoped(new RegExp("^the next cycle polls from offset 41$"), (ctx) => {
    assert.equal(ctx.bl2097.cycle.state.offset, 41, 'expected the offset to stay at 41 (an abandoned call keeps its offset)');
  });

  // ── answered-long-poll-is-kept-02 ───────────────────────────────────────
  scoped(new RegExp("^Telegram answers the bot's getUpdates call after (.+?) seconds with update 41$"), (ctx, seconds) => {
    const st = ctx.bl2097;
    st.adapters = baseAdapters(st, {
      getUpdates: async (_offset, signal) => {
        st.clock.advanceMs(Number(seconds) * 1000);
        st.wasAborted = signal.aborted;
        return { success: true, updates: [mkTextUpdate(41, 'hello')] };
      },
      // A fresh message with no existing subject/backlog mapping (this
      // fixture's default subjectForTopic/backlogForTopic both return
      // undefined) routes through openSubjectAndRecord, never postToBridge
      // (decideUpdateAction's own open-default/open-for-topic branch) -
      // confirmed by reading processMessageUpdate, not assumed.
      openSubjectAndRecord: async (_topicId, _text, updateId) => {
        st.postedUpdateIds.push(updateId);
        return 'BL-9097';
      },
    });
  });

  scoped(new RegExp("^the getUpdates request was not aborted$"), (ctx) => {
    assert.equal(ctx.bl2097.wasAborted, false, 'expected the getUpdates request to NOT have been aborted');
  });

  scoped(new RegExp("^update 41 is handled$"), (ctx) => {
    assert.ok(ctx.bl2097.postedUpdateIds.includes(41), `expected update 41 to have been posted, got: ${JSON.stringify(ctx.bl2097.postedUpdateIds)}`);
  });

  scoped(new RegExp("^the next cycle polls from offset 42$"), (ctx) => {
    assert.equal(ctx.bl2097.cycle.state.offset, 42, 'expected the offset to advance past the handled update');
  });
}

module.exports = { registerSteps };
