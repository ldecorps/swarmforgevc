'use strict';

// BL-484: step handlers for "A decided approval ask closes itself in its
// Telegram topic". Drives the REAL compiled pollAndForward/
// recordApprovalDecisionAndClose (telegramFrontDeskBotCore.ts) against fake
// PollAdapters - never a hand-rolled reimplementation of the closing rules,
// mirroring bl452/bl455's own step-file convention for this codebase's
// concierge/front-desk machinery.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { pollAndForward, recordApprovalDecisionAndClose, APPROVALS_SUBJECT_ID } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));

const PRINCIPAL_ID = 111;
const TICKET_ID = 'BL-484';
const APPROVALS_TOPIC_ID = 750;
const ASK_TOPIC_ID = 800;
const ASK_MESSAGE_ID = 42;
const ORIGINAL_ASK_TEXT = `${TICKET_ID} needs your approval before it can proceed. Reply here with "approve ${TICKET_ID}" (or "reject ${TICKET_ID} <reason>") to act.`;

function mkCallbackUpdate(data) {
  return { update_id: 1, callback_query: { id: 'cbq-1', data, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 } } } };
}

function mkApprovalsTopicReplyUpdate(text) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: APPROVALS_TOPIC_ID, text } };
}

// Every scenario below starts from the SAME Background fixture - an ask
// already posted with its message_id persisted, buttons live. ctx.* fields
// accumulate the adapters' own tracking, read back by the Then steps.
function registerSteps(registry) {
  registry.define(/^an approval ask was posted in the ticket's topic with its message_id persisted$/, (ctx) => {
    ctx.editCalls = [];
    ctx.answered = [];
    ctx.recordedVerdict = undefined;
    ctx.recordApprovalReplyCalls = [];
    ctx.editSucceeds = true;
  });

  registry.define(/^the posted ask shows an inline keyboard of Approve, Amend, and Reject buttons$/, () => {
    // Documented by the Background text itself - approvalRequestedButtons
    // (topicRouter.ts) is the real production source of these three
    // buttons, separately unit/acceptance-tested by BL-410's own feature.
    // Nothing further to arrange here.
  });

  // ── decided-ask-closes-01: button tap ────────────────────────────────
  registry.define(/^the ticket is still pending review$/, (ctx) => {
    ctx.recordedVerdict = undefined;
  });

  registry.define(/^the Approve button on the ask is tapped$/, async (ctx) => {
    await pollAndForward(0, PRINCIPAL_ID, {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(`approve:${TICKET_ID}`)] }),
      postToBridge: async () => {
        throw new Error('postToBridge should not be called for a callback_query');
      },
      openSubjectAndRecord: async () => {
        throw new Error('openSubjectAndRecord should not be called for a callback_query');
      },
      subjectForTopic: () => undefined,
      backlogForTopic: () => undefined,
      postOperatorContext: async () => {
        throw new Error('postOperatorContext should not be called for a bare callback_query');
      },
      recordApprovalReply: async (backlogId) => {
        ctx.recordApprovalReplyCalls.push(backlogId);
        return true;
      },
      recordRejectionReply: async () => true,
      setPendingButtonAction: async () => {},
      answerCallbackQuery: async (id, text) => {
        ctx.answered.push({ id, text });
      },
      readApprovalAskMessage: async () => ({ topicId: ASK_TOPIC_ID, messageId: ASK_MESSAGE_ID, text: ORIGINAL_ASK_TEXT }),
      editApprovalAskMessage: async (topicId, messageId, text) => {
        ctx.editCalls.push({ topicId, messageId, text });
        return { success: ctx.editSucceeds };
      },
      readRecordedApprovalVerdict: async () => ctx.recordedVerdict,
    });
  });

  // ── decided-ask-closes-02: typed reply (standing Approvals topic) ─────
  registry.define(/^a typed reply of "([^"]+)" is recorded against the ticket$/, async (ctx, text) => {
    await pollAndForward(0, PRINCIPAL_ID, {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [mkApprovalsTopicReplyUpdate(text)] }),
      postToBridge: async () => {
        throw new Error('postToBridge should not be called for an Approvals-topic reply');
      },
      openSubjectAndRecord: async () => {
        throw new Error('openSubjectAndRecord should not be called for an Approvals-topic reply');
      },
      subjectForTopic: (topicId) => (topicId === APPROVALS_TOPIC_ID ? APPROVALS_SUBJECT_ID : undefined),
      backlogForTopic: () => undefined,
      postOperatorContext: async () => {
        throw new Error('postOperatorContext should not be called for an Approvals-topic reply');
      },
      recordApprovalReply: async (backlogId) => {
        ctx.recordApprovalReplyCalls.push(backlogId);
        return true;
      },
      recordRejectionReply: async (backlogId, reason) => {
        ctx.rejectedReason = reason;
        return true;
      },
      readApprovalAskMessage: async () => ({ topicId: ASK_TOPIC_ID, messageId: ASK_MESSAGE_ID, text: ORIGINAL_ASK_TEXT }),
      editApprovalAskMessage: async (topicId, messageId, editedText) => {
        ctx.editCalls.push({ topicId, messageId, text: editedText });
        return { success: ctx.editSucceeds };
      },
      readRecordedApprovalVerdict: async () => ctx.recordedVerdict,
    });
  });

  // ── Then/And steps shared by 01 and 02 ────────────────────────────────
  registry.define(/^the closing routine edits the persisted ask message to remove its inline keyboard$/, (ctx) => {
    if (ctx.editCalls.length !== 1) {
      throw new Error(`expected exactly one editApprovalAskMessage call, got: ${JSON.stringify(ctx.editCalls)}`);
    }
    if (ctx.editCalls[0].topicId !== ASK_TOPIC_ID || ctx.editCalls[0].messageId !== ASK_MESSAGE_ID) {
      throw new Error(`expected the edit to target the persisted {topicId, messageId}, got: ${JSON.stringify(ctx.editCalls[0])}`);
    }
    // editApprovalAskMessage (telegram-front-desk-bot.ts's real wiring)
    // always passes buttons: null to editMessageText, which is what
    // actually strips the keyboard on the wire (telegramClient.test.js
    // proves that half); this step confirms the CLOSING ROUTINE reached
    // that adapter at all, for this exact persisted message.
  });

  registry.define(/^the edited message keeps the original ask text above the appended decision line$/, (ctx) => {
    const editedText = ctx.editCalls[0].text;
    if (!editedText.startsWith(ORIGINAL_ASK_TEXT)) {
      throw new Error(`expected the original ask text preserved verbatim above the decision line, got:\n${editedText}`);
    }
    const decisionLine = editedText.slice(ORIGINAL_ASK_TEXT.length + 1);
    if (!decisionLine.startsWith('-- ')) {
      throw new Error(`expected an appended "-- ..." decision line, got: "${decisionLine}"`);
    }
  });

  registry.define(/^the appended decision line records the Approved verdict and the recorded UTC decision time$/, (ctx) => {
    const editedText = ctx.editCalls[0].text;
    if (!/-- Approved \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(editedText)) {
      throw new Error(`expected an "-- Approved <UTC timestamp>" decision line, got:\n${editedText}`);
    }
  });

  registry.define(/^the appended decision line records the Rejected verdict and the reason "([^"]+)"$/, (ctx, reason) => {
    const editedText = ctx.editCalls[0].text;
    if (editedText !== `${ORIGINAL_ASK_TEXT}\n-- Rejected: ${reason}`) {
      throw new Error(`expected the Rejected decision line to record reason "${reason}", got:\n${editedText}`);
    }
  });

  // ── decided-ask-closes-03: a tap on an already-decided ask ────────────
  registry.define(/^a decision of approved has already been recorded for the ticket$/, (ctx) => {
    ctx.recordedVerdict = 'approved';
  });

  registry.define(/^a button on the already-decided ask is tapped$/, async (ctx) => {
    await pollAndForward(0, PRINCIPAL_ID, {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(`approve:${TICKET_ID}`)] }),
      postToBridge: async () => {
        throw new Error('postToBridge should not be called for a callback_query');
      },
      openSubjectAndRecord: async () => {
        throw new Error('openSubjectAndRecord should not be called for a callback_query');
      },
      subjectForTopic: () => undefined,
      backlogForTopic: () => undefined,
      postOperatorContext: async () => {
        throw new Error('postOperatorContext should not be called for a bare callback_query');
      },
      recordApprovalReply: async (backlogId) => {
        ctx.recordApprovalReplyCalls.push(backlogId);
        return true;
      },
      recordRejectionReply: async () => true,
      setPendingButtonAction: async () => {
        throw new Error('setPendingButtonAction should never be called for a stale tap');
      },
      answerCallbackQuery: async (id, text) => {
        ctx.answered.push({ id, text });
      },
      readApprovalAskMessage: async () => ({ topicId: ASK_TOPIC_ID, messageId: ASK_MESSAGE_ID, text: ORIGINAL_ASK_TEXT }),
      editApprovalAskMessage: async (topicId, messageId, text) => {
        ctx.editCalls.push({ topicId, messageId, text });
        return { success: true };
      },
      readRecordedApprovalVerdict: async () => ctx.recordedVerdict,
    });
  });

  registry.define(/^the callback is answered with an already-decided toast naming the approved verdict$/, (ctx) => {
    if (ctx.answered.length !== 1 || ctx.answered[0].text !== 'Already decided: approved') {
      throw new Error(`expected a single "Already decided: approved" toast, got: ${JSON.stringify(ctx.answered)}`);
    }
  });

  registry.define(/^no decision side effect is performed for that tap$/, (ctx) => {
    if (ctx.recordApprovalReplyCalls.length !== 0) {
      throw new Error(`expected no recordApprovalReply call for a stale tap, got: ${JSON.stringify(ctx.recordApprovalReplyCalls)}`);
    }
    if (ctx.editCalls.length !== 0) {
      throw new Error(`expected no message edit for a stale tap, got: ${JSON.stringify(ctx.editCalls)}`);
    }
  });

  // ── decided-ask-closes-04: a failed message edit ──────────────────────
  registry.define(/^the persisted ask message can no longer be edited because it was deleted from the topic$/, (ctx) => {
    ctx.editSucceeds = false;
  });

  registry.define(/^an approval is recorded for the ticket$/, async (ctx) => {
    const originalErrorWrite = process.stderr.write;
    const errors = [];
    process.stderr.write = (chunk) => {
      errors.push(chunk);
      return true;
    };
    try {
      ctx.changed = await recordApprovalDecisionAndClose(
        {
          recordApprovalReply: async (backlogId) => {
            ctx.recordApprovalReplyCalls.push(backlogId);
            return true;
          },
          recordRejectionReply: async () => true,
          readApprovalAskMessage: async () => ({ topicId: ASK_TOPIC_ID, messageId: ASK_MESSAGE_ID, text: ORIGINAL_ASK_TEXT }),
          editApprovalAskMessage: async (topicId, messageId, text) => {
            ctx.editCalls.push({ topicId, messageId, text });
            return { success: ctx.editSucceeds };
          },
        },
        TICKET_ID,
        { kind: 'approved' },
        0
      );
    } finally {
      process.stderr.write = originalErrorWrite;
    }
    ctx.stderrLines = errors;
  });

  registry.define(/^the failed message edit is logged$/, (ctx) => {
    if (!ctx.stderrLines.some((line) => line.includes(TICKET_ID))) {
      throw new Error(`expected a failed-edit warning naming ${TICKET_ID}, got: ${JSON.stringify(ctx.stderrLines)}`);
    }
  });

  registry.define(/^the ticket's human_approval decision is still recorded as approved$/, (ctx) => {
    if (!ctx.recordApprovalReplyCalls.includes(TICKET_ID)) {
      throw new Error(`expected recordApprovalReply to have been called for ${TICKET_ID}, got: ${JSON.stringify(ctx.recordApprovalReplyCalls)}`);
    }
    if (ctx.changed !== true) {
      throw new Error(`expected the decision recording to be reported as successful, got: ${ctx.changed}`);
    }
  });

  registry.define(/^the decision tick completes without crashing$/, (ctx) => {
    if (ctx.changed === undefined) {
      throw new Error('expected recordApprovalDecisionAndClose to have resolved, not thrown');
    }
  });
}

module.exports = { registerSteps };
