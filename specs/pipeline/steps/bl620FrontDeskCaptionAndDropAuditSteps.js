'use strict';

// BL-620: step handlers for "Front desk reads photo captions and logs every
// dropped update". Drives the REAL compiled decision/poll surface
// (extension/out/tools/telegramFrontDeskBotCore and
// extension/out/onboarding/negotiationTelegramRouting) with fixture
// adapters at the transport edges only - the same posture as the module's
// own unit fixtures, never a reimplementation of routing or eligibility.

const assert = require('node:assert/strict');
const core = require('../../../extension/out/tools/telegramFrontDeskBotCore');
const negotiation = require('../../../extension/out/onboarding/negotiationTelegramRouting');

const FEATURE = 'Front desk reads photo captions and logs every dropped update';

const PRINCIPAL = 424242;
const CHAT_ID = '1';
const TOPIC_ID = 7;

function mkTextUpdate({ text, fromId = PRINCIPAL, topicId = TOPIC_ID, chatId = 1, updateId = 1 } = {}) {
  return {
    update_id: updateId,
    message: { message_id: 1, chat: { id: chatId }, from: { id: fromId }, message_thread_id: topicId, text },
  };
}

function mkPhotoUpdate({ caption, fromId = PRINCIPAL, topicId = TOPIC_ID, chatId = 1, updateId = 1 } = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      chat: { id: chatId },
      from: { id: fromId },
      message_thread_id: topicId,
      photo: [{ file_id: 'photo-1', width: 90, height: 60 }],
      ...(caption === undefined ? {} : { caption }),
    },
  };
}

function subjectForTopic(topicId) {
  return topicId === TOPIC_ID ? 'SUP-1' : undefined;
}

function baseAdapters(ctx) {
  ctx.posted = [];
  ctx.auditLines = [];
  return {
    chatId: CHAT_ID,
    logDropAudit: (line) => ctx.auditLines.push(line),
    getUpdates: async () => ({ success: true, updates: ctx.updates }),
    postToBridge: async (subjectId, text) => {
      ctx.posted.push({ subjectId, text });
      return true;
    },
    subjectForTopic,
    openSubjectAndRecord: async (topicId, text) => {
      ctx.posted.push({ opened: true, topicId, text });
    },
  };
}

async function runPoll(ctx) {
  ctx.result = await core.pollAndForward(0, String(PRINCIPAL), baseAdapters(ctx));
}

// Scenario 02's <surface> column - each drives THAT surface's own real
// entry point with a caption-only update and asserts the caption text is
// what the surface acts on. KNOWN_VALUES: an unknown row throws.
const SURFACE_CHECKS = {
  'main-routing': () => {
    const caption = core.decideUpdateAction(mkPhotoUpdate({ caption: 'route me' }), String(PRINCIPAL), CHAT_ID, subjectForTopic);
    assert.deepEqual(caption, { action: 'post-existing', subjectId: 'SUP-1', text: 'route me' });
  },
  steering: () => {
    const decision = core.decideSteeringAction(mkPhotoUpdate({ caption: 'steer the coder', topicId: 55 }), String(PRINCIPAL), CHAT_ID, { coder: 55 });
    assert.deepEqual(decision, { kind: 'redirect', role: 'coder', text: 'steer the coder' });
  },
  'agent-questions': () => {
    const decision = core.decideAgentQuestionsReplyAction(mkPhotoUpdate({ caption: 'the answer is 42', topicId: 66 }), String(PRINCIPAL), CHAT_ID, 66);
    assert.equal(decision.kind, 'deliver');
    assert.equal(decision.text, 'the answer is 42');
  },
  'control-delivery': async () => {
    // The control text path reads the same seam; drive the real poll path
    // with a control-topic adapter set and a caption-only pause command.
    const applied = [];
    const adapters = {
      chatId: CHAT_ID,
      getUpdates: async () => ({ success: true, updates: [mkPhotoUpdate({ caption: '/pause', topicId: 99 })] }),
      postToBridge: async () => true,
      subjectForTopic: () => undefined,
      openSubjectAndRecord: async () => {},
      controlTopicId: async () => 99,
      getPendingControlConfirm: async () => undefined,
      getPauseState: async () => ({ active: false }),
      postControlPauseMenu: async () => {
        applied.push('pause-menu');
      },
    };
    const result = await core.pollAndForward(0, String(PRINCIPAL), adapters);
    assert.equal(result.posted, 1, 'expected the caption-only control command to act, not drop');
    assert.deepEqual(applied, ['pause-menu']);
  },
  negotiation: () => {
    const decision = negotiation.decideNegotiationUpdateAction(mkPhotoUpdate({ caption: 'agreed', topicId: 77 }), String(PRINCIPAL), CHAT_ID, 77);
    assert.deepEqual(decision, { action: 'agree' });
  },
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a front-desk bot bound to its own group with the principal configured$/,
    (ctx) => {
      ctx.updates = [];
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a backlog topic is registered for the target ticket$/,
    () => {
      // subjectForTopic above binds TOPIC_ID -> SUP-1; stated explicitly.
    },
    FEATURE
  );

  registry.defineScoped(
    /^an update that fails eligibility with reason "([^"]+)"$/,
    (ctx, reason) => {
      const builders = {
        'not-my-chat': () => mkTextUpdate({ chatId: 2, text: 'foreign', updateId: 41 }),
        'not-principal': () => mkTextUpdate({ fromId: 999, text: 'stranger', updateId: 41 }),
        'no-text': () => mkTextUpdate({ text: undefined, updateId: 41 }),
      };
      if (!Object.prototype.hasOwnProperty.call(builders, reason)) {
        throw new Error(`unknown <reason> token: ${reason}`);
      }
      ctx.updates = [builders[reason]()];
      ctx.expectedReason = reason;
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the principal sends a photo whose caption addresses that topic$/,
    (ctx) => {
      ctx.captionDecision = core.decideUpdateAction(
        mkPhotoUpdate({ caption: 'act on this directive' }),
        String(PRINCIPAL),
        CHAT_ID,
        subjectForTopic
      );
      ctx.textDecision = core.decideUpdateAction(
        mkTextUpdate({ text: 'act on this directive' }),
        String(PRINCIPAL),
        CHAT_ID,
        subjectForTopic
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the "([^"]+)" surface receives a principal message carrying only a caption$/,
    (ctx, surface) => {
      if (!Object.prototype.hasOwnProperty.call(SURFACE_CHECKS, surface)) {
        throw new Error(`unknown <surface> token: ${surface}`);
      }
      ctx.surface = surface;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the surface decides its action$/,
    async (ctx) => {
      await SURFACE_CHECKS[ctx.surface]();
      ctx.surfaceChecked = true;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the principal sends a photo with (no caption|an empty caption)$/,
    async (ctx, state) => {
      ctx.updates = [mkPhotoUpdate({ caption: state === 'an empty caption' ? '' : undefined, updateId: 51 })];
      ctx.expectedReason = 'media-no-caption';
      await runPoll(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the principal's photo caption is routed to that topic$/,
    async (ctx) => {
      ctx.updates = [mkPhotoUpdate({ caption: 'route these words', updateId: 61 })];
      await runPoll(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the poll cycle processes the update$/,
    async (ctx) => {
      await runPoll(ctx);
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the decision equals the decision for the identical plain-text message$/,
    (ctx) => {
      assert.deepEqual(ctx.captionDecision, ctx.textDecision);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the decision is not a drop$/,
    (ctx) => {
      assert.notEqual(ctx.captionDecision.action, 'drop');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the surface treats the caption as the message text$/,
    (ctx) => {
      assert.ok(ctx.surfaceChecked, 'the surface check must have run');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the update is dropped with reason "media-no-caption"$/,
    (ctx) => {
      assert.equal(ctx.result.dropped, 1, `expected one drop, got: ${JSON.stringify(ctx.result)}`);
      assert.equal(ctx.result.posted, 0);
    },
    FEATURE
  );

  registry.defineScoped(
    /^exactly one audit line naming the update id and reason "([^"]+)" is logged$/,
    (ctx, reason) => {
      assert.equal(ctx.auditLines.length, 1, `expected exactly one audit line, got: ${JSON.stringify(ctx.auditLines)}`);
      assert.match(ctx.auditLines[0], new RegExp(String(ctx.updates[0].update_id)));
      assert.ok(ctx.auditLines[0].includes(reason), `expected reason ${reason} in: ${ctx.auditLines[0]}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the poll offset advances past the update$/,
    (ctx) => {
      assert.equal(ctx.result.nextOffset, ctx.updates[0].update_id + 1);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the routed content notes the attached image was not read by the front desk$/,
    (ctx) => {
      assert.equal(ctx.posted.length, 1);
      assert.match(ctx.posted[0].text, /^route these words/);
      assert.match(ctx.posted[0].text, /image.*not read/i);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the audit line is a single line$/,
    (ctx) => {
      assert.ok(!ctx.auditLines[0].includes('\n'), `expected a single line, got: ${JSON.stringify(ctx.auditLines[0])}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no delivery retry is attempted for it$/,
    (ctx) => {
      // A drop is terminal (BL-389): zero failed outcomes, so nothing for
      // the offset to park on and nothing for Telegram to redeliver.
      assert.equal(ctx.result.failed, 0);
      assert.equal(ctx.result.dropped, 1);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
