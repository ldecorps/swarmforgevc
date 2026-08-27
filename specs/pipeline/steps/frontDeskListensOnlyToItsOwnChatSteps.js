'use strict';

// BL-379: step handlers for "The front desk only listens to its own
// project's chat". Drives the REAL compiled pollAndForward
// (telegramFrontDeskBotCore.ts) against fake in-memory adapters - no live
// Telegram, no network - mirroring aDroppedMessageMustNotParkTheOffsetSteps.js's
// own "drive the real core function, count real outcomes" pattern.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { pollAndForward } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));

const PRINCIPAL_ID = 111;
const OWN_CHAT_ID = '1';
const FOREIGN_CHAT_ID = '2';

// BL-379's own explicit warning: a Scenario Outline's <sender>/<chat>/
// <outcome> columns must each be validated against an explicit
// KNOWN_VALUES lookup, never a bare passthrough - an unrecognized value
// (including a gherkin-mutator mutant) throws here rather than silently
// taking some default branch.
const SENDER_KNOWN_VALUES = {
  'the human': PRINCIPAL_ID,
  'a stranger': 999,
};

const CHAT_KNOWN_VALUES = {
  'its own': Number(OWN_CHAT_ID),
  another: Number(FOREIGN_CHAT_ID),
};

const OUTCOME_KNOWN_VALUES = {
  'taken as work': 'taken',
  'refused as foreign': 'refused',
};

function knownValue(map, key, columnName) {
  if (!Object.prototype.hasOwnProperty.call(map, key)) {
    throw new Error(`front-desk-listens-only-to-its-own-chat: unrecognized <${columnName}> example value "${key}"`);
  }
  return map[key];
}

function mkUpdate({ fromId, chatId, topicId, text }) {
  return { update_id: 1, message: { message_id: 1, chat: { id: chatId }, from: { id: fromId }, message_thread_id: topicId, text } };
}

// BL-379: the shared When's own logic, exported so
// aDroppedMessageMustNotParkTheOffsetSteps.js's EARLIER-registered handler
// for the same verbatim step text can delegate here for a ctx shape it
// does not itself recognize (see that file's own branch-on-ctx-shape
// comment) - the registry's first-match-wins resolve() means a second
// registration of the identical regex here would just be silently
// shadowed dead code, the exact BL-342 collision mistake.
async function collectFrontDeskMessages(ctx) {
  const adapters = {
    chatId: OWN_CHAT_ID,
    getUpdates: async () => ({ success: true, updates: [ctx.update] }),
    postToBridge: async (subjectId, text, updateId) => {
      ctx.posted.push({ subjectId, text, updateId });
      return true;
    },
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async (topicId, text, updateId) => {
      ctx.openSubjectCalls.push({ topicId, text, updateId });
      return 'SUP-1';
    },
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
    recordApprovalReply: async () => true,
  };
  ctx.result = await pollAndForward(0, PRINCIPAL_ID, adapters);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the front desk is bound to its own project's chat$/, (ctx) => {
    ctx.openSubjectCalls = [];
    ctx.posted = [];
  });

  // ── front-desk-listens-only-to-its-own-chat-01 (Scenario Outline) /
  //    -02 (identical wording, sender="the human" chat="another") ───────
  registry.define(/^a message from (the human|a stranger) in (its own|another) chat$/, (ctx, sender, chat) => {
    const fromId = knownValue(SENDER_KNOWN_VALUES, sender, 'sender');
    const chatId = knownValue(CHAT_KNOWN_VALUES, chat, 'chat');
    ctx.update = mkUpdate({ fromId, chatId, text: 'a human message' });
  });

  // ── front-desk-listens-only-to-its-own-chat-03 ──────────────────────
  registry.define(/^a message from the human in an unmapped topic of its own chat$/, (ctx) => {
    ctx.update = mkUpdate({ fromId: PRINCIPAL_ID, chatId: Number(OWN_CHAT_ID), topicId: 42, text: 'new conversation' });
  });

  // ── shared When ──────────────────────────────────────────────────────
  // BL-379: "the front desk collects the waiting messages" is VERBATIM
  // identical to an existing step registered EARLIER in index.js
  // (aDroppedMessageMustNotParkTheOffsetSteps.js, BL-389) - the registry's
  // first-match-wins resolve() means that file's own handler owns this
  // text. Deliberately NOT re-registered here (that would be silently
  // shadowed dead code, the exact BL-342 collision mistake) - this file's
  // own scenarios reach collectFrontDeskMessages above through that
  // earlier handler's own ctx-shape branch instead.

  // ── front-desk-listens-only-to-its-own-chat-01 (Scenario Outline Then) ──
  registry.define(/^the message is (taken as work|refused as foreign)$/, (ctx, outcome) => {
    const expected = knownValue(OUTCOME_KNOWN_VALUES, outcome, 'outcome');
    if (expected === 'taken') {
      if (ctx.result.posted !== 1) {
        throw new Error(`expected the message to be taken as work (posted:1), got ${JSON.stringify(ctx.result)}`);
      }
    } else {
      if (ctx.result.dropped !== 1 || ctx.result.posted !== 0) {
        throw new Error(`expected the message to be refused as foreign (dropped:1, posted:0), got ${JSON.stringify(ctx.result)}`);
      }
    }
  });

  // ── front-desk-listens-only-to-its-own-chat-02 ──────────────────────
  // Deliberately a DISTINCT, exactly-matched handler from -03's "a support
  // thread is opened for it" below, per the ticket's own IR-DRY warning -
  // never a single handler branching on the negation.
  registry.define(/^no support thread is opened for it$/, (ctx) => {
    if (ctx.openSubjectCalls.length !== 0) {
      throw new Error(`expected no support thread to be opened, got ${JSON.stringify(ctx.openSubjectCalls)}`);
    }
  });

  // ── front-desk-listens-only-to-its-own-chat-03 ──────────────────────
  registry.define(/^a support thread is opened for it$/, (ctx) => {
    if (ctx.openSubjectCalls.length !== 1) {
      throw new Error(`expected exactly one support thread to be opened, got ${JSON.stringify(ctx.openSubjectCalls)}`);
    }
  });
}

module.exports = { registerSteps, collectFrontDeskMessages };
