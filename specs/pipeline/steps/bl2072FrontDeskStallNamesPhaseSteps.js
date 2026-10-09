'use strict';

// BL-2072: step handlers for "A front-desk stall names the phase that
// stalled". Drives the REAL startup sequence (runStartupTopicChecks),
// the REAL poll cycle (pollAndForward) and the REAL shared timing helper
// (timePhase) - never a restatement of any of them - over a fake
// Telegram, a fake clock (no real sleeps) and a temp operator directory.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');

const OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const FEATURE = 'A front-desk stall names the phase that stalled';

let _lib = null;
function lib() {
  if (!_lib) {
    _lib = {
      bot: require(path.join(OUT, 'tools', 'telegram-front-desk-bot')),
      core: require(path.join(OUT, 'tools', 'telegramFrontDeskBotCore')),
    };
  }
  return _lib;
}

const CHAT_ID = '-100';
const PRINCIPAL_ID = '42';
const BOT_TOKEN = 'token';

// Advances when called rather than sleeping (the ticket's own constraint:
// "never real sleeps") - timePhase's own `now` reads this same clock, so a
// fake Telegram call that advances it IS the slow phase, with zero real
// wall-clock cost.
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

function makeFixture(ctx) {
  const opDir = mkTmpDir('bl2072-fixture-');
  const diagnostics = makeDiagnosticsCapture();
  const clock = makeFakeClock();
  ctx.bl2072 = { opDir, diagnostics, clock, delaysMs: {} };
  return ctx.bl2072;
}

// ── "startup topic checks" ──────────────────────────────────────────────

function fakePostFnAdvancingOnce(clock, delayMs) {
  let advanced = false;
  return async () => {
    if (!advanced) {
      advanced = true;
      clock.advanceMs(delayMs);
    }
    return { ok: true, status: 200, json: { ok: true, result: { message_id: 1, message_thread_id: 1 } } };
  };
}

async function runStartupPhase(ctx) {
  const st = ctx.bl2072;
  const postFn = st.delaysMs['startup topic checks'] ? fakePostFnAdvancingOnce(st.clock, st.delaysMs['startup topic checks']) : fastResolve({ ok: true, status: 200, json: { ok: true, result: { message_id: 1, message_thread_id: 1 } } });
  await lib().core.timePhase(
    st.clock.now,
    st.diagnostics.logDiagnostic,
    'startup topic checks',
    () => lib().bot.runStartupTopicChecks(st.opDir, BOT_TOKEN, CHAT_ID, postFn)
  );
}

// ── "getUpdates wait" / "handling of one update batch" ─────────────────

function baseAdapters(st, overrides = {}) {
  return Object.assign(
    {
      chatId: CHAT_ID,
      now: st.clock.now,
      logDiagnostic: st.diagnostics.logDiagnostic,
      getUpdates: fastResolve({ success: true, updates: [] }),
      postToBridge: fastResolve(true),
      subjectForTopic: () => undefined,
      openSubjectAndRecord: fastResolve('BL-9072'),
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

function mkTextUpdate(id, text) {
  return {
    update_id: id,
    message: { message_id: id, chat: { id: CHAT_ID }, from: { id: PRINCIPAL_ID }, text },
  };
}

async function runGetUpdatesPhase(ctx) {
  const st = ctx.bl2072;
  const delayMs = st.delaysMs['getUpdates wait'] || 0;
  const adapters = baseAdapters(st, {
    getUpdates: async () => {
      if (delayMs) {
        st.clock.advanceMs(delayMs);
      }
      return { success: true, updates: [] };
    },
  });
  await lib().core.pollAndForward(0, PRINCIPAL_ID, adapters);
}

async function runBatchPhase(ctx) {
  const st = ctx.bl2072;
  const delayMs = st.delaysMs['handling of one update batch'] || 0;
  const adapters = baseAdapters(st, {
    getUpdates: fastResolve({ success: true, updates: [mkTextUpdate(1, 'hello')] }),
    openSubjectAndRecord: async () => {
      if (delayMs) {
        st.clock.advanceMs(delayMs);
      }
      return 'BL-9072';
    },
  });
  await lib().core.pollAndForward(0, PRINCIPAL_ID, adapters);
}

const PHASE_RUNNERS = {
  'startup topic checks': runStartupPhase,
  'getUpdates wait': runGetUpdatesPhase,
  'handling of one update batch': runBatchPhase,
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a front-desk bot over a fake Telegram and a temp operator directory$/, (ctx) => {
    makeFixture(ctx);
  });

  scoped(/^the bot's (startup topic checks|getUpdates wait|handling of one update batch) takes (\d+) seconds$/, (ctx, phase, seconds) => {
    ctx.bl2072.delaysMs[phase] = Number(seconds) * 1000;
    ctx.bl2072.phase = phase;
  });

  scoped(/^the bot runs it$/, async (ctx) => {
    const { phase } = ctx.bl2072;
    assert.ok(phase, 'no phase set by the scenario');
    await PHASE_RUNNERS[phase](ctx);
  });

  scoped(/^front-desk-diagnostics\.log gains a line naming (startup topic checks|getUpdates wait|handling of one update batch) and a duration of at least (\d+) seconds$/, (ctx, phase, seconds) => {
    const { diagnostics } = ctx.bl2072;
    const minMs = Number(seconds) * 1000;
    const line = diagnostics.lines.find((l) => l.includes(phase));
    assert.ok(line, `no diagnostic line names "${phase}" in: ${JSON.stringify(diagnostics.lines)}`);
    const match = line.match(/took (\d+)ms/);
    assert.ok(match, `line has no duration: ${line}`);
    assert.ok(Number(match[1]) >= minMs, `expected duration >= ${minMs}ms, line reads: ${line}`);
  });

  // ── scenario 02 ───────────────────────────────────────────────────────
  scoped(/^every phase of the bot's first poll cycle takes under a second$/, (ctx) => {
    makeFixture(ctx);
    // delaysMs stays empty: every phase below resolves with no clock
    // advance at all, well under the threshold.
  });

  scoped(/^the bot runs the cycle$/, async (ctx) => {
    const st = ctx.bl2072;
    const adapters = baseAdapters(st);
    await lib().core.pollAndForward(0, PRINCIPAL_ID, adapters);
  });

  scoped(/^front-desk-diagnostics\.log gains no timing line$/, (ctx) => {
    const { diagnostics } = ctx.bl2072;
    const timingLines = diagnostics.lines.filter((l) => l.includes('front-desk-phase-slow'));
    assert.deepEqual(timingLines, [], `expected no timing line, got: ${JSON.stringify(timingLines)}`);
  });
}

module.exports = { registerSteps };
