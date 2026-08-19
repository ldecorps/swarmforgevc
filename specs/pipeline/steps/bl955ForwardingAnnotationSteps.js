'use strict';

// BL-955: step handlers for "Every forwarding surface says the image was
// not read". Each surface driver runs the REAL pollAndForward (or the
// negotiation relay) over in-memory adapters and captures the text that
// actually left the front desk - never a reimplementation of the
// annotation.

const assert = require('node:assert/strict');
const path = require('node:path');

const core = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'telegramFrontDeskBotCore'));
const { processNegotiationUpdate } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'onboarding', 'negotiationTelegramRelay'));

const FEATURE = 'Every forwarding surface says the image was not read';

const PRINCIPAL_ID = 111;
const NOTE = '[image attached - not read by the front desk]';
const WORDS = 'use the blue variant for the header';

function mkTextUpdate({ topicId, text }) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: topicId, text } };
}

function mkPhotoUpdate({ topicId, caption }) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 1 },
      from: { id: PRINCIPAL_ID },
      message_thread_id: topicId,
      photo: [{ file_id: 'photo-1', width: 90, height: 60 }],
      caption,
    },
  };
}

function mkUpdateFor({ topicId, isPhoto, body }) {
  return isPhoto ? mkPhotoUpdate({ topicId, caption: body }) : mkTextUpdate({ topicId, text: body });
}

const baseAdapters = () => ({
  chatId: '1',
  postToBridge: async () => true,
  subjectForTopic: () => undefined,
  backlogForTopic: () => undefined,
  openSubjectAndRecord: async () => 'SUP-9',
});

// KNOWN_VALUES per <surface> row - an unknown token throws. Each driver
// returns the forwarded/stored text(s) it captured.
const SURFACES = {
  steering: async (isPhoto) => {
    const captured = [];
    await core.pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(),
      getUpdates: async () => ({ success: true, updates: [mkUpdateFor({ topicId: 42, isPhoto, body: WORDS })] }),
      readRoleTopicMap: () => ({ coder: 42 }),
      redirectToRole: async (_role, text) => {
        captured.push(text);
        return { kind: 'delivered' };
      },
    });
    return captured;
  },
  'agent-questions': async (isPhoto) => {
    const captured = [];
    await core.pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(),
      getUpdates: async () => ({ success: true, updates: [mkUpdateFor({ topicId: 42, isPhoto, body: WORDS })] }),
      agentQuestionsTopicId: async () => 42,
      getPendingAgentQuestionThread: async () => 'SUP-1',
      postToBridge: async (_subjectId, text) => {
        captured.push(text);
        return true;
      },
    });
    return captured;
  },
  onboarding: async (isPhoto) => {
    const captured = [];
    await core.pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(),
      getUpdates: async () => ({ success: true, updates: [mkUpdateFor({ topicId: 42, isPhoto, body: WORDS })] }),
      onboardingTopicId: async () => 42,
      handleOnboarderMessage: async (_topicId, text) => {
        captured.push(text);
        return true;
      },
    });
    return captured;
  },
  'negotiation-relay': async (isPhoto) => {
    const captured = [];
    await processNegotiationUpdate(mkUpdateFor({ topicId: 42, isPhoto, body: WORDS }), String(PRINCIPAL_ID), '1', 42, {
      objectToContract: async (text) => {
        captured.push(text);
        return { outcome: 'revised', contract: { scope: [], outOfScope: [], boundaries: [], initialBacklogSummary: '', agreement: 'proposed' } };
      },
      approveContract: async () => {
        throw new Error('the fixture words must never classify as agreement');
      },
      postToTopic: async () => {},
    });
    return captured;
  },
  'approvals-reject-reason': async (isPhoto) => {
    const captured = [];
    await core.pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(),
      getUpdates: async () => ({ success: true, updates: [mkUpdateFor({ topicId: 750, isPhoto, body: `reject BL-433 ${WORDS}` })] }),
      subjectForTopic: (topicId) => (topicId === 750 ? core.APPROVALS_SUBJECT_ID : undefined),
      recordRejectionReply: async (_backlogId, reason) => {
        captured.push(reason);
        return true;
      },
    });
    return captured;
  },
  'recert-amend-text': async (isPhoto) => {
    const captured = [];
    await core.pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(),
      getUpdates: async () => ({ success: true, updates: [mkUpdateFor({ topicId: 900, isPhoto, body: `amend BL-207-thing-01 ${WORDS}` })] }),
      subjectForTopic: (topicId) => (topicId === 900 ? core.RECERT_SUBJECT_ID : undefined),
      queueRecertAmendProposal: async (_scenarioId, newText) => {
        captured.push(newText);
        return true;
      },
    });
    return captured;
  },
  'control-delivery': null, // driven by its own scenario-03 steps below
};

async function runControlCommand(update) {
  const armed = [];
  await core.pollAndForward(0, PRINCIPAL_ID, {
    ...baseAdapters(),
    getUpdates: async () => ({ success: true, updates: [update] }),
    controlTopicId: async () => 900,
    getPendingControlConfirm: async () => undefined,
    setPendingControlConfirm: async (c) => armed.push(c),
    getPauseState: async () => ({ active: false }),
    postControlStopModesMenu: async () => {},
  });
  return armed;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a front-desk bot bound to its own group with the principal configured$/,
    (ctx) => {
      ctx.surface = undefined;
      ctx.forwarded = undefined;
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the "([^"]+)" surface is wired$/,
    (ctx, surface) => {
      if (!(surface in SURFACES)) {
        throw new Error(`unknown <surface> token: ${surface}`);
      }
      ctx.surface = surface;
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the principal sends a photo whose caption carries the message words$/,
    async (ctx) => {
      ctx.forwarded = await SURFACES[ctx.surface](true);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the principal sends the same words as a plain text message$/,
    async (ctx) => {
      ctx.forwarded = await SURFACES[ctx.surface](false);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the principal sends a control command as a photo caption$/,
    async (ctx) => {
      ctx.armedViaCaption = await runControlCommand(mkPhotoUpdate({ topicId: 900, caption: '/stop' }));
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the text that surface forwards notes the attached image was not read by the front desk$/,
    (ctx) => {
      assert.equal(ctx.forwarded.length, 1, `expected one forward from ${ctx.surface}`);
      assert.ok(ctx.forwarded[0].includes(NOTE), `${ctx.surface} forwarded without the note: ${JSON.stringify(ctx.forwarded[0])}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the text that surface forwards still contains the caption's own words$/,
    (ctx) => {
      assert.ok(ctx.forwarded[0].includes(WORDS), `${ctx.surface} lost the caption words: ${JSON.stringify(ctx.forwarded[0])}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the text that surface forwards equals the message words exactly$/,
    (ctx) => {
      assert.deepEqual(ctx.forwarded, [WORDS]);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the text that surface forwards carries no image-not-read note$/,
    (ctx) => {
      assert.ok(!ctx.forwarded[0].includes('[image'), `unexpected note on plain text: ${JSON.stringify(ctx.forwarded[0])}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the command executes exactly as the identical plain-text command would$/,
    async (ctx) => {
      const armedViaText = await runControlCommand(mkTextUpdate({ topicId: 900, text: '/stop' }));
      assert.deepEqual(ctx.armedViaCaption, armedViaText);
      assert.deepEqual(ctx.armedViaCaption, [{ kind: 'stop-modes' }]);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no image-not-read note is appended to the text the command parser reads$/,
    (ctx) => {
      // The command ARMED (asserted above) - an annotated '/stop\n[image...]'
      // could not have matched the verb, so the parse saw the bare command.
      assert.deepEqual(ctx.armedViaCaption, [{ kind: 'stop-modes' }]);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
