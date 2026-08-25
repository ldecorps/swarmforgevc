'use strict';

// BL-607: step handlers for "A pipeline role raises a clarifying question
// into its own topic and gets the answer back into its own session".
// Drives the REAL compiled telegramFrontDeskBotCore.ts (pollAndForward /
// relaySseReplies) against fake PollAdapters/ReplyRelayAdapters - the same
// "drive the real core, fake only the Telegram/network + tmux boundary"
// posture bl425RoleSteeringTopicsSteps.js/bl483MultiOptionAskButtonsSteps.js
// already use for the two shipped halves this ticket reuses. Scenario 05
// (the per-role pending guard) drives the REAL role_ask.bb CLI against a
// real tmp fixture instead - that refusal logic lives entirely in the bb
// script, not in the TS core.
//
// Several step texts here are byte-identical to ones
// bl483MultiOptionAskButtonsSteps.js already registers for its OWN,
// unrelated feature ("the post renders one tappable button per option",
// "the human taps an option button", "the human answers with a typed
// free-text reply") - registered here via registry.defineScoped, pinned to
// this exact Feature: title, so this file's own registrations only ever
// resolve for THIS feature's scenarios (mirrors bl425's own
// "the message is handled" collision fix - see stepRegistry.js).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { pollAndForward, relaySseReplies } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));

const FEATURE_NAME = "A pipeline role raises a clarifying question into its own topic and gets the answer back into its own session";

const PRINCIPAL_ID = 111;
const SPECIFIER_TOPIC_ID = 1595;
const AGENT_QUESTIONS_TOPIC_ID = 42;
const ROLE_ASK_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'role_ask.bb');

function mkChunkReader(chunks) {
  let i = 0;
  return async () => (i < chunks.length ? { done: false, chunk: chunks[i++] } : { done: true, chunk: '' });
}

function mkCallbackUpdate(data) {
  return { update_id: 1, callback_query: { id: 'cbq-1', data, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 } } } };
}

function mkTopicReplyUpdate(topicId, text) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: topicId, text } };
}

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl607-'));
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the front desk is live and round-trips inline-button callbacks$/,
    (ctx) => {
      ctx.posted = [];
      ctx.sentReplies = [];
      ctx.recordedMessage = undefined;
      ctx.redirected = [];
      ctx.deliveryResults = [];
      ctx.queuedNotes = [];
      ctx.clearedRoles = [];
      ctx.paneLive = true;
      ctx.agentQuestionsTopicCalled = false;
      ctx.roleTopicMap = { specifier: SPECIFIER_TOPIC_ID };
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^each pipeline role has its own dedicated topic in the role topic map$/,
    (ctx) => {
      ctx.roleTopicMap = { specifier: SPECIFIER_TOPIC_ID, coder: 1600, cleaner: 1601 };
    },
    FEATURE_NAME
  );

  // ── role-clarifying-poll-01: the ask is retargeted to the role's own
  // topic with buttons, never the shared Agent Questions topic ──────────

  registry.defineScoped(
    /^the specifier is drafting a spec and hits an ambiguous choice$/,
    () => {
      // Documented by the Background/scenario text itself - role_ask.bb's
      // own reply-outbox entry shape is separately covered by
      // test_role_ask.sh; nothing further to arrange here.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the specifier raises a clarifying question carrying enumerated options$/,
    async (ctx) => {
      const record = {
        id: 'r1',
        threadId: 'role-ask-specifier',
        text: 'which environment?',
        roleQuestion: 'specifier',
        options: [{ label: 'staging' }, { label: 'prod' }],
      };
      await relaySseReplies(
        '',
        {
          readChunk: mkChunkReader([`event: telegram-reply\ndata: ${JSON.stringify(record)}\n\n`]),
          sendReply: async (topicId, text) => {
            ctx.sentReplies.push({ topicId, text });
          },
          sendAskButtons: async (topicId, text, buttons) => {
            ctx.posted.push({ topicId, text, buttons });
            return { success: true, messageId: 900 };
          },
          recordAskMessage: async (threadId, topicId, messageId, text) => {
            ctx.recordedMessage = { threadId, topicId, messageId, text };
          },
          roleTopicIdFor: async (role) => ctx.roleTopicMap[role],
          agentQuestionsTopicId: async () => {
            ctx.agentQuestionsTopicCalled = true;
            return AGENT_QUESTIONS_TOPIC_ID;
          },
          resolveDelivery: () => {
            throw new Error('resolveDelivery should never be consulted for a roleQuestion record');
          },
          ackReply: async () => {},
        },
        new Set()
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the question is posted to the specifier's own role topic$/,
    (ctx) => {
      if (ctx.posted.length !== 1 || ctx.posted[0].topicId !== SPECIFIER_TOPIC_ID) {
        throw new Error(`expected the ask posted to the specifier's own topic (${SPECIFIER_TOPIC_ID}), got: ${JSON.stringify(ctx.posted)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is not posted to the shared agent questions topic$/,
    (ctx) => {
      if (ctx.agentQuestionsTopicCalled) {
        throw new Error('expected agentQuestionsTopicId to never be consulted for a role question');
      }
      if (ctx.posted.some((p) => p.topicId === AGENT_QUESTIONS_TOPIC_ID)) {
        throw new Error(`expected nothing posted to the shared Agent Questions topic, got: ${JSON.stringify(ctx.posted)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the post renders one tappable button per option$/,
    (ctx) => {
      const { buttons } = ctx.posted[0];
      if (buttons.length !== 2 || buttons.some((row) => row.length !== 1)) {
        throw new Error(`expected one button per option, one option per row, got: ${JSON.stringify(buttons)}`);
      }
      if (buttons[0][0].text !== 'staging' || buttons[1][0].text !== 'prod') {
        throw new Error(`expected buttons labelled staging/prod, got: ${JSON.stringify(buttons)}`);
      }
    },
    FEATURE_NAME
  );

  // ── role-clarifying-poll-02 / -03 / -04: the answer round trip ────────

  registry.defineScoped(
    /^the specifier has a clarifying question pending and its pane is (live|dormant)$/,
    (ctx, liveness) => {
      ctx.paneLive = liveness === 'live';
    },
    FEATURE_NAME
  );

  function roleAnswerAdapters(ctx, updates) {
    return {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates }),
      postToBridge: async () => {
        throw new Error('postToBridge should never be called for a role question - there is no SUP-### thread on the other end');
      },
      openSubjectAndRecord: async () => {
        throw new Error('openSubjectAndRecord should not be called for a role-topic message');
      },
      subjectForTopic: () => undefined,
      backlogForTopic: () => undefined,
      readRoleTopicMap: () => ctx.roleTopicMap,
      redirectToRole: async (role, text) => {
        ctx.redirected.push({ role, text });
        const result = ctx.paneLive ? { kind: 'delivered' } : { kind: 'no-pane' };
        ctx.deliveryResults.push({ role, text, kind: result.kind });
        return result;
      },
      getRolePendingQuestion: async (role) => role === 'specifier',
      clearRolePendingQuestion: async (role) => {
        ctx.clearedRoles.push(role);
      },
      enqueueRoleAnswerNote: async (role, text) => {
        ctx.queuedNotes.push({ role, text });
        return true;
      },
      answerCallbackQuery: async () => {},
      resolveAskOptions: async (threadId) => (threadId === 'role-ask-specifier' ? [{ label: 'staging' }, { label: 'prod' }] : undefined),
    };
  }

  registry.defineScoped(
    /^the human taps an option button$/,
    async (ctx) => {
      ctx.answerText = 'prod';
      await pollAndForward(0, PRINCIPAL_ID, roleAnswerAdapters(ctx, [mkCallbackUpdate('ask:role-ask-specifier:1')]));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the human answers with a typed free-text reply$/,
    async (ctx) => {
      ctx.answerText = 'use staging please';
      await pollAndForward(0, PRINCIPAL_ID, roleAnswerAdapters(ctx, [mkTopicReplyUpdate(SPECIFIER_TOPIC_ID, ctx.answerText)]));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the human answers the question$/,
    async (ctx) => {
      ctx.answerText = 'use staging please';
      await pollAndForward(0, PRINCIPAL_ID, roleAnswerAdapters(ctx, [mkTopicReplyUpdate(SPECIFIER_TOPIC_ID, ctx.answerText)]));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the chosen option is delivered into the specifier's live pane$/,
    (ctx) => {
      if (!ctx.redirected.some((r) => r.role === 'specifier' && r.text === ctx.answerText)) {
        throw new Error(`expected "${ctx.answerText}" delivered into the specifier's live pane, got: ${JSON.stringify(ctx.redirected)}`);
      }
      if (ctx.queuedNotes.length !== 0) {
        throw new Error(`a live-pane delivery must never also be queued as a note, got: ${JSON.stringify(ctx.queuedNotes)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the typed reply is delivered into the specifier's live pane$/,
    (ctx) => {
      if (!ctx.redirected.some((r) => r.role === 'specifier' && r.text === ctx.answerText)) {
        throw new Error(`expected the typed reply delivered into the specifier's live pane, got: ${JSON.stringify(ctx.redirected)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the pending question for that role is cleared$/,
    (ctx) => {
      if (!ctx.clearedRoles.includes('specifier')) {
        throw new Error(`expected the specifier's pending marker cleared, got: ${JSON.stringify(ctx.clearedRoles)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the answer is queued as a note in the specifier's inbox$/,
    (ctx) => {
      if (!ctx.queuedNotes.some((n) => n.role === 'specifier' && n.text === ctx.answerText)) {
        throw new Error(`expected the answer queued as a note for specifier, got: ${JSON.stringify(ctx.queuedNotes)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the answer is not reported as delivered to a live pane$/,
    (ctx) => {
      if (ctx.deliveryResults.some((d) => d.kind === 'delivered')) {
        throw new Error(`expected no live-pane delivery for a dormant pane, got: ${JSON.stringify(ctx.deliveryResults)}`);
      }
    },
    FEATURE_NAME
  );

  // ── role-clarifying-poll-05: the per-role pending guard - drives the
  // REAL role_ask.bb CLI (this refusal logic lives entirely in the bb
  // script, not the TS core reused above). ───────────────────────────────

  registry.defineScoped(
    /^the specifier has a clarifying question pending$/,
    (ctx) => {
      ctx.root = mkTmpRoot();
      const out = execFileSync('bb', [ROLE_ASK_CLI, ctx.root, '--role', 'specifier', '--question', 'which environment?'], { encoding: 'utf8' });
      const parsed = JSON.parse(out);
      if (parsed.asked !== true) {
        throw new Error(`expected the first ask to succeed, got: ${out}`);
      }
      ctx.awaitingPath = path.join(ctx.root, '.swarmforge', 'operator', 'role-awaiting', 'specifier.json');
      ctx.firstAwaitingContent = fs.readFileSync(ctx.awaitingPath, 'utf8');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the specifier raises another clarifying question$/,
    (ctx) => {
      ctx.secondAskOut = execFileSync('bb', [ROLE_ASK_CLI, ctx.root, '--role', 'specifier', '--question', 'a second question?'], { encoding: 'utf8' });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the second question is refused$/,
    (ctx) => {
      const parsed = JSON.parse(ctx.secondAskOut);
      if (parsed.asked !== false || parsed.reason !== 'already-pending') {
        throw new Error(`expected the second ask refused with reason already-pending, got: ${ctx.secondAskOut}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the first pending question is left untouched$/,
    (ctx) => {
      const currentContent = fs.readFileSync(ctx.awaitingPath, 'utf8');
      if (currentContent !== ctx.firstAwaitingContent) {
        throw new Error('expected the first pending question\'s own marker file untouched by the refused second ask');
      }
      fs.rmSync(ctx.root, { recursive: true, force: true });
    },
    FEATURE_NAME
  );

  // ── role-clarifying-poll-06: the Operator's SUP-thread ask stays
  // byte-identical - regression guard. ───────────────────────────────────

  registry.defineScoped(
    /^the operator raises a question against a support thread$/,
    () => {
      // Documented by the scenario text itself - operator_ask.bb's own
      // behavior is separately, exhaustively tested elsewhere (BL-306/
      // BL-466/BL-483); nothing further to arrange here.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the question is posted to Telegram$/,
    async (ctx) => {
      const record = { id: 'r1', threadId: 'SUP-1', text: 'why is this failing?', agentQuestion: true };
      await relaySseReplies(
        '',
        {
          readChunk: mkChunkReader([`event: telegram-reply\ndata: ${JSON.stringify(record)}\n\n`]),
          sendReply: async (topicId, text) => {
            ctx.sentReplies.push({ topicId, text });
          },
          agentQuestionsTopicId: async () => {
            ctx.agentQuestionsTopicCalled = true;
            return AGENT_QUESTIONS_TOPIC_ID;
          },
          roleTopicIdFor: async () => {
            throw new Error('roleTopicIdFor should never be consulted for an ordinary agentQuestion record');
          },
          resolveDelivery: () => {
            throw new Error('resolveDelivery should never be consulted for an agentQuestion record');
          },
          ackReply: async () => {},
        },
        new Set()
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is posted to the shared agent questions topic exactly as before$/,
    (ctx) => {
      if (!ctx.agentQuestionsTopicCalled) {
        throw new Error('expected agentQuestionsTopicId to be consulted for the Operator ask');
      }
      if (ctx.sentReplies.length !== 1 || ctx.sentReplies[0].topicId !== AGENT_QUESTIONS_TOPIC_ID) {
        throw new Error(`expected the Operator ask posted to the shared Agent Questions topic, got: ${JSON.stringify(ctx.sentReplies)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
