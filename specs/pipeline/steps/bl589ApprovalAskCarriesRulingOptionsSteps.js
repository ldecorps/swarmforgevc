'use strict';

// BL-589: step handlers for ruling-option approval asks. Drives the REAL
// compiled decideTopicAction (topicRouter.ts), pollAndForward/recordRulingDecisionAndClose
// (telegramFrontDeskBotCore.ts), and recordRulingReply (pendingApprovalReply.ts).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { decideTopicAction } = require(path.join(EXT_DIR, 'out', 'concierge', 'topicRouter'));
const { pollAndForward, decideCallbackQueryAction } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const {
  recordRulingReply,
  readRecordedRuling,
  readRulingOptions,
} = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));

const PRINCIPAL_ID = 111;
const TICKET_ID = 'BL-589';
const ASK_TOPIC_ID = 800;
const ASK_MESSAGE_ID = 42;
const ORIGINAL_ASK_TEXT = `${TICKET_ID} needs your approval before it can proceed. Reply here with "approve ${TICKET_ID}" (or "reject ${TICKET_ID} <reason>") to act.`;

const DEFAULT_BUTTONS = [
  [
    { text: 'Approve', callbackData: `approve:${TICKET_ID}` },
    { text: 'Amend', callbackData: `amend:${TICKET_ID}` },
    { text: 'Reject', callbackData: `reject:${TICKET_ID}` },
    { text: 'Q jump', callbackData: `expedite:${TICKET_ID}` },
  ],
  [
    { text: 'More', callbackData: `more:${TICKET_ID}` },
    { text: 'Ambulance', callbackData: `ambulance:${TICKET_ID}` },
  ],
];

const RULING_OPTIONS = ['approach one', 'approach two'];
const LONG_LABEL = 'x'.repeat(80);

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl589-'));
}

function writeTicket(targetPath, folder, yaml) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${TICKET_ID}-fixture.yaml`), yaml);
}

function ticketPath(targetPath, folder) {
  return path.join(targetPath, 'backlog', folder, `${TICKET_ID}-fixture.yaml`);
}

function mkCallbackUpdate(data) {
  return { update_id: 1, callback_query: { id: 'cbq-1', data, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 } } } };
}

function approvalEvent(payload) {
  return {
    type: 'ApprovalRequested',
    backlogId: TICKET_ID,
    payload: { title: 'ruling fixture', ...payload },
  };
}

function registerSteps(registry) {
  registry.define(/^an approval ask was posted in a ticket's Telegram topic$/, (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.editCalls = [];
    ctx.answered = [];
    ctx.recordedVerdict = undefined;
    ctx.recordedRuling = undefined;
    ctx.tapIndex = 0;
  });

  registry.define(/^the ticket declares ruling options on its yaml$/, (ctx) => {
    writeTicket(
      ctx.targetPath,
      'paused',
      `id: ${TICKET_ID}\ntitle: ruling fixture\nhuman_approval: pending\nruling_options:\n  - approach one\n  - approach two\n`
    );
    ctx.rulingOptions = RULING_OPTIONS;
  });

  registry.define(/^the ticket has no ruling options declared$/, (ctx) => {
    writeTicket(ctx.targetPath, 'paused', `id: ${TICKET_ID}\ntitle: ruling fixture\nhuman_approval: pending\n`);
    ctx.rulingOptions = undefined;
  });

  registry.define(/^the ticket declares a ruling option whose label exceeds the callback_data byte budget$/, (ctx) => {
    writeTicket(
      ctx.targetPath,
      'paused',
      `id: ${TICKET_ID}\ntitle: ruling fixture\nhuman_approval: pending\nruling_options:\n  - ${LONG_LABEL}\n`
    );
    ctx.rulingOptions = [LONG_LABEL];
  });

  registry.define(/^the approval ask inline keyboard is composed for the ticket$/, (ctx) => {
    const action = decideTopicAction(
      approvalEvent({ rulingOptions: ctx.rulingOptions }),
      {},
      'ruling fixture'
    );
    ctx.composedButtons = action.buttons;
  });

  registry.define(
    /^one inline button is rendered per ruling option alongside today's default approval verbs$/,
    (ctx) => {
      const expected = [
        [{ text: 'approach one', callbackData: `rule:${TICKET_ID}:0` }],
        [{ text: 'approach two', callbackData: `rule:${TICKET_ID}:1` }],
        ...DEFAULT_BUTTONS,
      ];
      if (JSON.stringify(ctx.composedButtons) !== JSON.stringify(expected)) {
        throw new Error(`expected ruling-option rows + default verbs, got ${JSON.stringify(ctx.composedButtons)}`);
      }
    }
  );

  registry.define(/^the inline keyboard matches today's default approval ask buttons byte-for-byte$/, (ctx) => {
    if (JSON.stringify(ctx.composedButtons) !== JSON.stringify(DEFAULT_BUTTONS)) {
      throw new Error(`expected default buttons only, got ${JSON.stringify(ctx.composedButtons)}`);
    }
  });

  registry.define(/^the long option's callback_data carries only the option index not the label text$/, (ctx) => {
    const row = ctx.composedButtons?.[0]?.[0];
    if (!row || row.callbackData !== `rule:${TICKET_ID}:0`) {
      throw new Error(`expected index callback_data rule:${TICKET_ID}:0, got ${row?.callbackData}`);
    }
    if (row.callbackData.includes(LONG_LABEL) || row.callbackData.length > 64) {
      throw new Error('callback_data must not embed the long label');
    }
  });

  registry.define(/^the ticket is still pending review$/, (ctx) => {
    ctx.recordedVerdict = undefined;
    ctx.recordedRuling = undefined;
  });

  registry.define(/^a ruling option button on the ask is tapped$/, async (ctx) => {
    ctx.tapIndex = 0;
    await pollAndForward(0, PRINCIPAL_ID, {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(`rule:${TICKET_ID}:0`)] }),
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
      recordApprovalReply: async () => {
        throw new Error('recordApprovalReply should not be called for a ruling tap');
      },
      recordRulingReply: (backlogId, label) => Promise.resolve(recordRulingReply(ctx.targetPath, backlogId, label)),
      resolveRulingOptions: (backlogId) => Promise.resolve(readRulingOptions(ctx.targetPath, backlogId)),
      readRecordedRuling: (backlogId) => Promise.resolve(readRecordedRuling(ctx.targetPath, backlogId)),
      recordRejectionReply: async () => true,
      recordAmendReply: async () => true,
      setPendingButtonAction: async () => {},
      answerCallbackQuery: async (id, text) => {
        ctx.answered.push({ id, text });
      },
      readApprovalAskMessage: async () => ({ topicId: ASK_TOPIC_ID, messageId: ASK_MESSAGE_ID, text: ORIGINAL_ASK_TEXT }),
      editApprovalAskMessage: async (topicId, messageId, text) => {
        ctx.editCalls.push({ topicId, messageId, text });
        return { success: true };
      },
      readRecordedApprovalVerdict: async () => ctx.recordedVerdict,
      explainApprovalRecordNoOp: async () => undefined,
      commitApprovalWrites: async () => true,
    });
  });

  registry.define(/^the ticket records human_ruling with the chosen option label$/, (ctx) => {
    const ruling = readRecordedRuling(ctx.targetPath, TICKET_ID);
    if (ruling !== 'approach one') {
      throw new Error(`expected human_ruling approach one, got ${ruling}`);
    }
    const raw = fs.readFileSync(ticketPath(ctx.targetPath, 'paused'), 'utf8');
    if (!/human_approval:\s*approved/.test(raw)) {
      throw new Error('expected human_approval approved');
    }
  });

  registry.define(/^the ask message is repainted with a Ruled footer naming that option$/, (ctx) => {
    const edited = ctx.editCalls[0]?.text ?? '';
    if (!edited.includes('-- Ruled: approach one')) {
      throw new Error(`expected Ruled footer in edited ask, got ${edited}`);
    }
  });

  registry.define(/^the ticket already carries a recorded human ruling$/, (ctx) => {
    writeTicket(
      ctx.targetPath,
      'paused',
      `id: ${TICKET_ID}\ntitle: ruling fixture\nhuman_approval: approved\nhuman_ruling: |\n  approach one\n`
    );
    ctx.recordedVerdict = 'approved';
    ctx.recordedRuling = 'approach one';
  });

  registry.define(/^a ruling option button on the ask is tapped again$/, async (ctx) => {
    await pollAndForward(0, PRINCIPAL_ID, {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(`rule:${TICKET_ID}:1`)] }),
      postToBridge: async () => {
        throw new Error('postToBridge should not be called');
      },
      openSubjectAndRecord: async () => {
        throw new Error('openSubjectAndRecord should not be called');
      },
      subjectForTopic: () => undefined,
      backlogForTopic: () => undefined,
      postOperatorContext: async () => {
        throw new Error('postOperatorContext should not be called');
      },
      recordRulingReply: async () => {
        throw new Error('recordRulingReply should not be called on stale tap');
      },
      recordApprovalReply: async () => {
        throw new Error('recordApprovalReply should not be called on stale tap');
      },
      recordRejectionReply: async () => true,
      recordAmendReply: async () => true,
      setPendingButtonAction: async () => {},
      answerCallbackQuery: async (id, text) => {
        ctx.answered.push({ id, text });
      },
      readApprovalAskMessage: async () => ({ topicId: ASK_TOPIC_ID, messageId: ASK_MESSAGE_ID, text: ORIGINAL_ASK_TEXT }),
      editApprovalAskMessage: async (topicId, messageId, text) => {
        ctx.editCalls.push({ topicId, messageId, text });
        return { success: true };
      },
      readRecordedApprovalVerdict: async () => ctx.recordedVerdict,
      readRecordedRuling: async () => ctx.recordedRuling,
      resolveRulingOptions: (backlogId) => Promise.resolve(readRulingOptions(ctx.targetPath, backlogId)),
      explainApprovalRecordNoOp: async () => undefined,
    });
  });

  registry.define(/^the tap is answered with an already-ruled toast naming the recorded option$/, (ctx) => {
    const toast = ctx.answered[0]?.text;
    if (toast !== 'Already ruled: approach one') {
      throw new Error(`expected already-ruled toast, got ${toast}`);
    }
  });

  registry.define(/^no further ruling is recorded on the ticket$/, (ctx) => {
    const ruling = readRecordedRuling(ctx.targetPath, TICKET_ID);
    if (ruling !== 'approach one') {
      throw new Error(`expected ruling unchanged, got ${ruling}`);
    }
  });
}

module.exports = { registerSteps };
