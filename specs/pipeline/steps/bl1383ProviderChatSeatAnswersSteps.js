'use strict';

// BL-1383: step handlers for "A topic bound to a chat provider answers there".
//
// Drives the REAL front-desk dispatch (runPollCycle -> processMessageUpdate)
// with the REAL seat turn behind it, over a fixture provider-chat map on
// disk. The fake provider is an injected `complete` seam, never a network
// call and never a real key (invariant 2, and the ticket says fixture-based
// acceptance only).
//
// "No support subject is opened" is asserted against the REAL
// openSubjectAndRecord adapter, not the absence of a log line - the ticket's
// qa_e2e step 2 is explicit that the subject store is the evidence.
//
// Fixture roots come from mkProcessTmpDir: the acceptance runner has no Vitest
// afterEach, so a root registered for that sweep would leak. Removal is
// registered on process exit instead - no hook that never fires, and no
// prefix-glob sweep that would delete a concurrent run's fixtures (BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');
const { runPollCycle } = require('../../../extension/out/tools/telegramFrontDeskBotCore');
const {
  providerChatTopicMapPath,
  runProviderChatSeatTurn,
} = require('../../../extension/out/tools/providerChatSeatLive');

const FEATURE = 'BL-1383 A topic bound to a chat provider answers there';

const PRINCIPAL_ID = 111;
const API_KEY_ENV = 'BL1383_FAKE_KEY';
const API_KEY = 'k-fixture-only';
const BACKOFF_CONFIG = {
  backoffBaseMs: 1000,
  backoffMaxMs: 8000,
  degradedThreshold: 3,
  sustainedOutageThresholdMs: 30 * 60_000,
};
const NO_OUTAGE = { escalated: false };

function ensureCtx(ctx) {
  if (!ctx.bl1383) {
    const root = mkProcessTmpDir('aps-bl1383-');
    ctx.bl1383 = {
      root,
      reply: null,
      failure: null,
      providerCalls: 0,
      posted: [],
      opened: [],
      forwardedToBridge: [],
      cursorHostTopicId: undefined,
    };
  }
  return ctx.bl1383;
}

function bindTopic(state, topicId) {
  const p = providerChatTopicMapPath(state.root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({
      [topicId]: { model: 'fake-model', baseUrl: 'https://provider.invalid', apiKeyEnv: API_KEY_ENV },
    }),
    'utf8'
  );
}

// The fake provider. Never a socket: the seat's own `complete` seam is what a
// real run would fill with completeWithProviderChat.
function fakeComplete(state) {
  return async () => {
    state.providerCalls += 1;
    if (state.failure) {
      throw new Error(state.failure);
    }
    return state.reply ?? '';
  };
}

function adaptersFor(state, update) {
  return {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [update] }),
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async (topicId) => {
      state.opened.push(topicId);
      return 'SUP-1';
    },
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
    nextOffset: (updates, current) => current + updates.length,
    // The adapter is an async GETTER, not a number - resolveViaAdapter calls
    // it. Omitted entirely when no scenario set a cursor host topic, so
    // hasCursorBridgeTopicAdapter stays false and the exclusion is skipped.
    ...(state.cursorHostTopicId === undefined
      ? {}
      : { cursorBridgeTopicId: async () => state.cursorHostTopicId }),
    forwardCursorBridgeUpdate: async (forwarded) => {
      state.forwardedToBridge.push(forwarded);
      return true;
    },
    runProviderChatSeat: async (topicId, text) => {
      const outcome = await runProviderChatSeatTurn({
        targetPath: state.root,
        topicId,
        text,
        env: { [API_KEY_ENV]: API_KEY },
        complete: fakeComplete(state),
        post: async (postTopicId, message) => {
          state.posted.push({ topicId: postTopicId, message });
        },
      });
      return outcome.kind === 'not-mine' ? 'not-mine' : 'handled';
    },
  };
}

function messagesIn(state, topicId) {
  return state.posted.filter((p) => p.topicId === topicId).map((p) => p.message);
}

// Scenario Outline values are load-bearing: each is mapped to a REAL failure
// shape the seat would see, so the assertion is about the seat's reporting
// rather than a passthrough of the example text (KNOWN_VALUES, no binary
// check).
const KNOWN_FAILURES = {
  'status 401 and body "invalid api key"':
    'https://provider.invalid/chat/completions answered 401: invalid api key',
  'a refused connection': 'connect ECONNREFUSED 127.0.0.1:9',
};

const KNOWN_REASONS = {
  '"invalid api key"': 'invalid api key',
  'the refused connection': 'ECONNREFUSED',
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a front desk fixture whose provider chat map binds topic (\d+) to a fake provider$/, (ctx, topicId) => {
    const state = ensureCtx(ctx);
    bindTopic(state, Number(topicId));
  });

  scoped(/^the fake provider replies "([^"]*)" to any prompt$/, (ctx, reply) => {
    ensureCtx(ctx).reply = reply;
  });

  scoped(/^the fake provider fails with (.+)$/, (ctx, failure) => {
    const state = ensureCtx(ctx);
    const known = KNOWN_FAILURES[failure.trim()];
    assert.ok(known, `unknown failure example "${failure}" - add it to KNOWN_FAILURES rather than passing it through`);
    state.failure = known;
  });

  scoped(/^topic (\d+) is also the cursor host topic$/, (ctx, topicId) => {
    ensureCtx(ctx).cursorHostTopicId = Number(topicId);
  });

  scoped(/^a message "([^"]*)" arrives in topic (\d+)$/, async (ctx, text, topicId) => {
    const state = ensureCtx(ctx);
    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 1 },
        from: { id: PRINCIPAL_ID },
        message_thread_id: Number(topicId),
        text,
      },
    };
    await runPollCycle(
      { offset: 0, consecutiveFailures: 0, sustainedOutage: NO_OUTAGE },
      PRINCIPAL_ID,
      adaptersFor(state, update),
      BACKOFF_CONFIG,
      0
    );
  });

  scoped(/^an acknowledgement is posted in topic (\d+)$/, (ctx, topicId) => {
    const state = ensureCtx(ctx);
    const messages = messagesIn(state, Number(topicId));
    assert.ok(messages.length >= 1, `nothing was posted in topic ${topicId}`);
    // The acknowledgement is the FIRST thing posted, before the provider is
    // called - that is what makes it an acknowledgement rather than a summary.
    assert.match(messages[0], /working on it/i, `first message was not an acknowledgement: ${messages[0]}`);
  });

  scoped(/^the provider reply "([^"]*)" is posted in topic (\d+)$/, (ctx, reply, topicId) => {
    const state = ensureCtx(ctx);
    assert.ok(
      messagesIn(state, Number(topicId)).includes(reply),
      `the provider reply was not posted in topic ${topicId}: ${JSON.stringify(state.posted)}`
    );
  });

  scoped(/^no support subject is opened for topic (\d+)$/, (ctx, topicId) => {
    const state = ensureCtx(ctx);
    assert.ok(
      !state.opened.includes(Number(topicId)),
      `a support subject was opened for bound topic ${topicId}: ${JSON.stringify(state.opened)}`
    );
  });

  scoped(/^a support subject is opened for topic (\d+)$/, (ctx, topicId) => {
    const state = ensureCtx(ctx);
    assert.ok(
      state.opened.includes(Number(topicId)),
      `the unbound topic ${topicId} did not follow today's flow: ${JSON.stringify(state.opened)}`
    );
  });

  scoped(/^the fake provider is never called$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.equal(state.providerCalls, 0, 'the seat called the provider for a topic it does not own');
  });

  scoped(/^a message naming (.+) is posted in topic (\d+)$/, (ctx, reason, topicId) => {
    const state = ensureCtx(ctx);
    const known = KNOWN_REASONS[reason.trim()];
    assert.ok(known, `unknown reason example "${reason}" - add it to KNOWN_REASONS rather than passing it through`);
    const messages = messagesIn(state, Number(topicId));
    assert.ok(
      messages.some((m) => m.includes(known)),
      `no message named the provider's actual reason (${known}): ${JSON.stringify(messages)}`
    );
  });

  // BL-572/BL-662: a bare status code is not a reason. The last posted
  // message must carry prose, not just digits.
  scoped(/^the posted message is not a bare status code$/, (ctx) => {
    const state = ensureCtx(ctx);
    const last = state.posted[state.posted.length - 1]?.message ?? '';
    assert.ok(last.length > 0, 'nothing was posted');
    assert.ok(!/^\s*\d{3}\s*$/.test(last), `the failure was reported as a bare status code: ${last}`);
    assert.ok(/[a-z]{3,}/i.test(last), `the failure carried no readable reason: ${last}`);
  });

  scoped(/^the update is forwarded to the cursor bridge$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.equal(
      state.forwardedToBridge.length,
      1,
      `the cursor-host topic was not forwarded to the bridge: ${JSON.stringify(state.forwardedToBridge)}`
    );
  });
}

module.exports = { registerSteps };
