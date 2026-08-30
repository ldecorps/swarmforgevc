'use strict';

// BL-483: step handlers for "Multi-option agent questions surface on
// Telegram as tappable buttons with one-effect answer capture". Drives the
// REAL compiled relaySseReplies/pollAndForward (telegramFrontDeskBotCore.ts)
// against fake PollAdapters/ReplyRelayAdapters - never a hand-rolled
// reimplementation of the rendering/routing/staleness rules, mirroring
// bl484DecidedAskClosesItselfSteps.js's own step-file convention for this
// codebase's front-desk machinery.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { pollAndForward, relaySseReplies } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));

const PRINCIPAL_ID = 111;
const AGENT_QUESTIONS_TOPIC_ID = 42;
const THREAD_ID = 'SUP-1';
const QUESTION_TEXT = 'Which environment?';
const OPTIONS = [
  { label: 'staging', description: 'the pre-prod environment' },
  { label: 'prod', description: 'the live environment' },
];
const ASK_MESSAGE_ID = 555;

function mkChunkReader(chunks) {
  let i = 0;
  return async () => (i < chunks.length ? { done: false, chunk: chunks[i++] } : { done: true, chunk: '' });
}

function mkCallbackUpdate(data) {
  return { update_id: 1, callback_query: { id: 'cbq-1', data, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 } } } };
}

function mkTopicReplyUpdate(text) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: AGENT_QUESTIONS_TOPIC_ID, text } };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^the front desk is live and round-trips inline-button callbacks$/, (ctx) => {
    ctx.bridged = [];
    ctx.answered = [];
    ctx.editCalls = [];
    ctx.posted = [];
    ctx.sentReplies = [];
    ctx.recordedMessage = undefined;
  });

  registry.define(/^an agent can file a question through the ask protocol$/, () => {
    // Documented by the Background text itself - operator_ask.bb's real
    // --options flag (BL-466, extended by BL-483's operator-lib/ask-options)
    // is separately unit-tested; nothing further to arrange here.
  });

  // ── multi-option-ask-buttons-01 ────────────────────────────────────────
  registry.define(/^an ask that carries a list of enumerated options$/, (ctx) => {
    ctx.options = OPTIONS;
  });

  registry.define(/^an ask that carries no options$/, (ctx) => {
    ctx.options = undefined;
  });

  registry.define(/^the ask is posted to Telegram$/, async (ctx) => {
    const record = { id: 'r1', threadId: THREAD_ID, text: QUESTION_TEXT, agentQuestion: true, ...(ctx.options ? { options: ctx.options } : {}) };
    await relaySseReplies(
      '',
      {
        readChunk: mkChunkReader([`event: telegram-reply\ndata: ${JSON.stringify(record)}\n\n`]),
        sendReply: async (topicId, text) => {
          ctx.sentReplies.push({ topicId, text });
        },
        sendAskButtons: async (topicId, text, buttons) => {
          ctx.posted.push({ topicId, text, buttons });
          return { success: true, messageId: ASK_MESSAGE_ID };
        },
        recordAskMessage: async (threadId, topicId, messageId, text) => {
          ctx.recordedMessage = { threadId, topicId, messageId, text };
        },
        agentQuestionsTopicId: async () => AGENT_QUESTIONS_TOPIC_ID,
        resolveDelivery: () => {
          throw new Error('resolveDelivery should never be consulted for an agentQuestion record');
        },
        ackReply: async () => {},
      },
      new Set()
    );
  });

  registry.define(/^the post renders one tappable button per option$/, (ctx) => {
    if (ctx.posted.length !== 1) {
      throw new Error(`expected exactly one buttons post, got: ${JSON.stringify(ctx.posted)}`);
    }
    const { buttons } = ctx.posted[0];
    if (buttons.length !== OPTIONS.length || buttons.some((row) => row.length !== 1)) {
      throw new Error(`expected one button per option, one option per row, got: ${JSON.stringify(buttons)}`);
    }
    OPTIONS.forEach((option, index) => {
      if (buttons[index][0].text !== option.label) {
        throw new Error(`expected button ${index} labelled "${option.label}", got "${buttons[index][0].text}"`);
      }
    });
  });

  registry.define(/^each option's description appears in the message body$/, (ctx) => {
    const { text } = ctx.posted[0];
    for (const option of OPTIONS) {
      if (!text.includes(option.description)) {
        throw new Error(`expected the message body to include "${option.description}", got:\n${text}`);
      }
    }
  });

  registry.define(/^the message states that a typed reply answers with something else$/, (ctx) => {
    const { text } = ctx.posted[0];
    if (!/reply with your own answer/i.test(text)) {
      throw new Error(`expected the message to state the free-text fallback, got:\n${text}`);
    }
  });

  registry.define(/^the posted ask renders byte-identically to the pre-change ask contract$/, (ctx) => {
    if (ctx.posted.length !== 0) {
      throw new Error(`expected no buttons post for a no-options ask, got: ${JSON.stringify(ctx.posted)}`);
    }
    if (ctx.sentReplies.length !== 1 || ctx.sentReplies[0].topicId !== AGENT_QUESTIONS_TOPIC_ID || ctx.sentReplies[0].text !== QUESTION_TEXT) {
      throw new Error(`expected the pre-change plain-message send, got: ${JSON.stringify(ctx.sentReplies)}`);
    }
  });

  // ── multi-option-ask-buttons-02 / -03 / -04 ──────────────────────────
  registry.define(/^an options-carrying ask has been posted with tappable buttons$/, (ctx) => {
    ctx.closed = false;
  });

  registry.define(/^an options-carrying ask that has been retracted or already answered$/, (ctx) => {
    ctx.closed = true;
  });

  function callbackAdapters(ctx) {
    return {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(`ask:${THREAD_ID}:1`)] }),
      postToBridge: async (threadId, text, updateId) => {
        ctx.bridged.push({ threadId, text, updateId });
        return true;
      },
      openSubjectAndRecord: async () => {
        throw new Error('openSubjectAndRecord should not be called for a callback_query');
      },
      subjectForTopic: () => undefined,
      backlogForTopic: () => undefined,
      postOperatorContext: async () => {
        throw new Error('postOperatorContext should not be called for a bare callback_query');
      },
      recordApprovalReply: async () => true,
      recordRejectionReply: async () => true,
      setPendingButtonAction: async () => {},
      answerCallbackQuery: async (id, text) => {
        ctx.answered.push({ id, text });
      },
      resolveAskOptions: async (threadId) => (ctx.closed || threadId !== THREAD_ID ? undefined : OPTIONS),
      readAskMessage: async () => ({ topicId: AGENT_QUESTIONS_TOPIC_ID, messageId: ASK_MESSAGE_ID, text: `${QUESTION_TEXT}\n\n1. staging\n2. prod` }),
      editAskMessage: async (topicId, messageId, text) => {
        ctx.editCalls.push({ topicId, messageId, text });
        return true;
      },
    };
  }

  registry.define(/^the human taps an option button$/, async (ctx) => {
    await pollAndForward(0, PRINCIPAL_ID, callbackAdapters(ctx));
  });

  registry.define(/^the human answers with a typed free-text reply$/, async (ctx) => {
    await pollAndForward(0, PRINCIPAL_ID, {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [mkTopicReplyUpdate('use staging please')] }),
      postToBridge: async (threadId, text, updateId) => {
        ctx.bridged.push({ threadId, text, updateId });
        return true;
      },
      openSubjectAndRecord: async () => {
        throw new Error('openSubjectAndRecord should not be called for an Agent Questions topic reply');
      },
      subjectForTopic: () => undefined,
      backlogForTopic: () => undefined,
      postOperatorContext: async () => {
        throw new Error('postOperatorContext should not be called for an Agent Questions topic reply');
      },
      agentQuestionsTopicId: async () => AGENT_QUESTIONS_TOPIC_ID,
      getPendingAgentQuestionThread: async () => THREAD_ID,
    });
    ctx.typedReplyText = 'use staging please';
  });

  registry.define(/^the tapped option's label is routed back as the answer$/, (ctx) => {
    if (ctx.bridged.length !== 1 || ctx.bridged[0].text !== 'prod' || ctx.bridged[0].threadId !== THREAD_ID) {
      throw new Error(`expected the tapped option's label "prod" routed via postToBridge, got: ${JSON.stringify(ctx.bridged)}`);
    }
  });

  registry.define(/^the typed reply is recorded as the answer$/, (ctx) => {
    if (ctx.bridged.length !== 1 || ctx.bridged[0].text !== ctx.typedReplyText || ctx.bridged[0].threadId !== THREAD_ID) {
      throw new Error(`expected the typed reply routed via postToBridge, got: ${JSON.stringify(ctx.bridged)}`);
    }
  });

  registry.define(/^the answer is recorded through the one shared answer effect path$/, (ctx) => {
    // Both the tap (multi-option-ask-buttons-02) and the typed reply
    // (multi-option-ask-buttons-03) converge on the SAME postToBridge call
    // captured above - proven by construction: this step's own scenario
    // already asserted the routed answer via that identical adapter, never
    // a second/parallel effect path.
    if (ctx.bridged.length !== 1) {
      throw new Error(`expected exactly one shared-path answer effect, got: ${JSON.stringify(ctx.bridged)}`);
    }
  });

  registry.define(/^the callback is acknowledged and the ask message updates as answered$/, (ctx) => {
    if (ctx.answered.length !== 1 || ctx.answered[0].id !== 'cbq-1') {
      throw new Error(`expected the callback acknowledged, got: ${JSON.stringify(ctx.answered)}`);
    }
    if (ctx.editCalls.length !== 1 || !/answered/i.test(ctx.editCalls[0].text) || !ctx.editCalls[0].text.includes('prod')) {
      throw new Error(`expected the ask message edited to show it was answered with "prod", got: ${JSON.stringify(ctx.editCalls)}`);
    }
  });

  registry.define(/^no answer side effect is performed$/, (ctx) => {
    if (ctx.bridged.length !== 0) {
      throw new Error(`expected no postToBridge call for a stale tap, got: ${JSON.stringify(ctx.bridged)}`);
    }
  });

  registry.define(/^the ask message is edited to show it is no longer open$/, (ctx) => {
    if (ctx.editCalls.length !== 1 || !/no longer open|already/i.test(ctx.editCalls[0].text)) {
      throw new Error(`expected the ask message edited to a "no longer open" notice, got: ${JSON.stringify(ctx.editCalls)}`);
    }
  });
}

module.exports = { registerSteps };
