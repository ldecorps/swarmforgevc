'use strict';

// BL-355: step handlers for "A reply comes back in the thread the human
// asked in". Drives the REAL compiled resolveReplyDelivery + relaySseReplies
// (telegramFrontDeskBotCore.ts) against real {topicId: subjectId}/backlog
// topic-map fixtures - no live Telegram/network, no real timers, mirroring
// telegramTopicThreadsSteps.js's own posture of exercising the pure/
// adapter-injected core directly rather than always going through the full
// live bridge. The only faked port is sendReply (the one adapter that would
// touch a real Telegram API), matching relaySseReplies' own test convention
// throughout telegramFrontDeskBotCore.test.js.

const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { DEFAULT_SUBJECT_KEY, resolveReplyDelivery, relaySseReplies } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));

// KNOWN_VALUES lookup for the Scenario Outline's <asking-thread> column -
// every value is load-bearing: an unrecognized value throws rather than
// silently falling through (engineering.prompt's Scenario Outline rule).
const ASKING_THREAD_SETUPS = {
  'the General topic': {
    setup: (ctx) => {
      ctx.subjectId = 'SUP-1';
      ctx.topicMap = { [DEFAULT_SUBJECT_KEY]: ctx.subjectId };
      ctx.backlogTopicMap = {};
      ctx.threadId = ctx.subjectId;
    },
    expectedTopicId: undefined, // General = sent with no message_thread_id
  },
  'a support topic': {
    setup: (ctx) => {
      ctx.subjectId = 'SUP-2';
      ctx.topicMap = { 77: ctx.subjectId };
      ctx.backlogTopicMap = {};
      ctx.threadId = ctx.subjectId;
    },
    expectedTopicId: 77,
  },
  "a backlog item's topic": {
    setup: (ctx) => {
      ctx.subjectId = 'BL-900';
      ctx.topicMap = {};
      ctx.backlogTopicMap = { 'BL-900': 88 };
      ctx.threadId = ctx.subjectId;
    },
    expectedTopicId: 88,
  },
};

// One relay pass over a single pre-buffered telegram-reply SSE record -
// the REAL resolveReplyDelivery decides the destination(s); sendReply is
// the only faked adapter (no live Telegram call), recording every send.
async function replyToMessage(ctx) {
  ctx.sent = [];
  const sseRecord = `event: telegram-reply\ndata: ${JSON.stringify({ id: 'r1', threadId: ctx.threadId, text: ctx.replyText })}\n\n`;
  // relaySseReplies only drains its initial buffer AFTER its first
  // readChunk call - a first call reporting done:true would return before
  // ever draining sseRecord. One done:false/empty-chunk call drains it;
  // the second done:true stops the loop (same pattern
  // operatorProactiveNotifySteps.js already uses for a pre-buffered record).
  let readCount = 0;
  await relaySseReplies(
    sseRecord,
    {
      readChunk: async () => {
        readCount += 1;
        return { done: readCount > 1, chunk: '' };
      },
      sendReply: async (topicId, text) => {
        ctx.sent.push({ topicId, text });
      },
      resolveDelivery: (threadId) => resolveReplyDelivery(ctx.topicMap, ctx.backlogTopicMap, threadId),
      ackReply: async () => {},
    },
    new Set()
  );
}

function registerSteps(registry) {
  // ── Background: a baseline "General, never any other topic" origin -
  // the exact shape that previously resolved to undefined and was
  // silently dropped (topicForSubject excludes DEFAULT_SUBJECT_KEY) ─────
  registry.define(/^the human sends a message in a thread$/, (ctx) => {
    ctx.subjectId = 'SUP-1';
    ctx.topicMap = { [DEFAULT_SUBJECT_KEY]: ctx.subjectId };
    ctx.backlogTopicMap = {};
    ctx.threadId = ctx.subjectId;
    ctx.replyText = 'here is your answer';
  });

  // ── reply-returns-to-asking-thread-01 (Scenario Outline) ────────────
  registry.define(/^the message was posted in "(.+)"$/, (ctx, askingThread) => {
    const config = ASKING_THREAD_SETUPS[askingThread];
    if (!config) {
      throw new Error(`unknown asking-thread in Examples table: ${JSON.stringify(askingThread)}`);
    }
    config.setup(ctx);
    ctx.expectedTopicId = config.expectedTopicId;
  });

  registry.define(/^the reply appears in "(.+)"$/, (ctx, askingThread) => {
    const config = ASKING_THREAD_SETUPS[askingThread];
    if (!config) {
      throw new Error(`unknown asking-thread in Examples table: ${JSON.stringify(askingThread)}`);
    }
    if (!ctx.sent.some((m) => m.topicId === config.expectedTopicId && m.text === ctx.replyText)) {
      throw new Error(`expected the reply delivered into ${JSON.stringify(config.expectedTopicId)}, got: ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── reply-returns-to-asking-thread-02 ────────────────────────────────
  registry.define(/^the reply for the message can only be delivered in another thread$/, (ctx) => {
    // Bound to BOTH a real dedicated topic AND the DEFAULT (General) key -
    // the human's own reported symptom: the full answer's canonical home
    // is the real topic, but General (the asking thread here) is also a
    // known origin for this subject, so it must get a pointer.
    ctx.subjectId = 'SUP-2';
    ctx.topicMap = { [DEFAULT_SUBJECT_KEY]: ctx.subjectId, 55: ctx.subjectId };
    ctx.backlogTopicMap = {};
    ctx.threadId = ctx.subjectId;
    ctx.replyText = 'the real, detailed answer';
  });

  registry.define(/^the asking thread carries a pointer saying where the answer was delivered$/, (ctx) => {
    const pointer = ctx.sent.find((m) => m.topicId === undefined && m.text !== ctx.replyText);
    if (!pointer) {
      throw new Error(`expected a pointer message sent into the asking (General) thread, got: ${JSON.stringify(ctx.sent)}`);
    }
    if (!/answered/i.test(pointer.text)) {
      throw new Error(`expected the pointer text to say where the answer was delivered, got: ${JSON.stringify(pointer.text)}`);
    }
    // The full answer itself keeps living in its real, canonical topic -
    // the pointer is additive, never a replacement for that history.
    if (!ctx.sent.some((m) => m.topicId === 55 && m.text === ctx.replyText)) {
      throw new Error(`expected the full answer to still be delivered to its real topic, got: ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── reply-returns-to-asking-thread-03 ────────────────────────────────
  registry.define(/^some visible response appears in the thread the human posted in$/, (ctx) => {
    if (ctx.sent.length === 0) {
      throw new Error('expected SOME visible response to be sent - silence is exactly the defect this scenario guards against');
    }
  });

  // ── shared When ──────────────────────────────────────────────────────
  registry.define(/^the swarm replies to it$/, async (ctx) => {
    await replyToMessage(ctx);
  });
}

module.exports = { registerSteps };
