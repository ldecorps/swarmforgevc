'use strict';

// BL-893: Approvals Ambulance button + /ambulance verb — engage the existing
// Control marker only (never approve / Q-jump / expedite). Drives real
// compiled production (topicRouter, telegramFrontDeskBotCore,
// engageOperatorAmbulance) against fake Telegram adapters.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { decideTopicAction } = require(path.join(EXT_DIR, 'out', 'concierge', 'topicRouter'));
const { pollAndForward, APPROVALS_SUBJECT_ID } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { engageOperatorAmbulance, controlAmbulanceStatePath } = require(path.join(
  EXT_DIR,
  'out',
  'tools',
  'telegramOperatorAmbulance'
));
const { parseExpediteTicket } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgeExpedite'));

const FEATURE = 'Approvals offers Ambulance as a hold for that ticket';

const PRINCIPAL_ID = 111;
const TICKET_ID = 'BL-893';
const MISSING_ID = 'BL-99999';
const APPROVALS_TOPIC_ID = 750;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl893-'));
}

function writeTicket(targetPath, folder, id, yaml) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), yaml);
}

function ticketPath(targetPath, folder, id) {
  return path.join(targetPath, 'backlog', folder, `${id}-fixture.yaml`);
}

function markerPath(targetPath) {
  return controlAmbulanceStatePath(targetPath);
}

function mkCallbackUpdate(data) {
  return {
    update_id: 1,
    callback_query: {
      id: 'cbq-1',
      data,
      from: { id: PRINCIPAL_ID },
      message: { chat: { id: 1 }, message_thread_id: APPROVALS_TOPIC_ID },
    },
  };
}

function baseAdapters(ctx, extras) {
  return {
    chatId: '1',
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for Approvals ambulance');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for Approvals ambulance');
    },
    subjectForTopic: (topicId) => (topicId === APPROVALS_TOPIC_ID ? APPROVALS_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for Approvals ambulance');
    },
    recordApprovalReply: async (backlogId) => {
      ctx.approvals.push(backlogId);
      return true;
    },
    recordRejectionReply: async () => true,
    promoteTicketIfPaused: async (backlogId) => {
      ctx.promotions.push(backlogId);
      return true;
    },
    dispatchExpediteBuild: async (backlogId) => {
      ctx.dispatches.push(backlogId);
      return true;
    },
    engageApprovalsAmbulance: async (backlogId) => {
      const result = engageOperatorAmbulance(ctx.targetPath, backlogId);
      ctx.engages.push({ backlogId, ...result });
      return result;
    },
    notifyApprovalsTopic: async (topicId, text) => {
      ctx.notified.push({ topicId, text });
      return true;
    },
    answerCallbackQuery: async (id, text) => {
      ctx.answered.push({ id, text });
    },
    forwardCursorBridgeUpdate: async () => {
      ctx.cursorBridgeForwards.push(1);
      return true;
    },
    ...extras,
  };
}

function tapAmbulance(ctx) {
  return pollAndForward(0, PRINCIPAL_ID, {
    ...baseAdapters(ctx),
    getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(`ambulance:${TICKET_ID}`)] }),
  });
}

function sendApprovalsTopicText(ctx, text) {
  return pollAndForward(0, PRINCIPAL_ID, {
    ...baseAdapters(ctx),
    getUpdates: async () => ({
      success: true,
      updates: [
        {
          update_id: 1,
          message: {
            message_id: 1,
            chat: { id: 1 },
            from: { id: PRINCIPAL_ID },
            message_thread_id: APPROVALS_TOPIC_ID,
            text,
          },
        },
      ],
    }),
  });
}

function resetCtx(ctx) {
  ctx.targetPath = mkTmp();
  // BL-691: engage only succeeds for active/ tickets — fixture stays active with pending.
  writeTicket(
    ctx.targetPath,
    'active',
    TICKET_ID,
    `id: ${TICKET_ID}\ntitle: ambulance fixture\nhuman_approval: pending\n`
  );
  ctx.approvals = [];
  ctx.promotions = [];
  ctx.dispatches = [];
  ctx.engages = [];
  ctx.notified = [];
  ctx.answered = [];
  ctx.cursorBridgeForwards = [];
}

function registerSteps(registry) {
  registry.defineScoped(/^an Approvals ask for a live ticket whose human_approval is pending$/, (ctx) => {
    resetCtx(ctx);
    ctx.action = decideTopicAction(
      { type: 'ApprovalRequested', backlogId: TICKET_ID, payload: {} },
      {},
      'ambulance fixture'
    );
  }, FEATURE);

  registry.defineScoped(/^the human taps Ambulance on that ask$/, async (ctx) => {
    ctx.deliverResult = await tapAmbulance(ctx);
  }, FEATURE);

  registry.defineScoped(/^ambulance is engaged for that ticket via the existing Control marker$/, (ctx) => {
    const raw = JSON.parse(fs.readFileSync(markerPath(ctx.targetPath), 'utf8'));
    if (!raw.active || raw.ticket !== TICKET_ID) {
      throw new Error(`expected active Control marker for ${TICKET_ID}, got: ${JSON.stringify(raw)}`);
    }
    if (!ctx.engages.some((e) => e.backlogId === TICKET_ID && e.ok)) {
      throw new Error(`expected engageApprovalsAmbulance ok for ${TICKET_ID}, got: ${JSON.stringify(ctx.engages)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the ticket's human_approval is still pending$/, (ctx) => {
    const content = fs.readFileSync(ticketPath(ctx.targetPath, 'active', TICKET_ID), 'utf8');
    if (!/^human_approval: pending$/m.test(content)) {
      throw new Error(`expected human_approval still pending, got:\n${content}`);
    }
    if (ctx.approvals.length !== 0) {
      throw new Error(`expected no recordApprovalReply, got: ${JSON.stringify(ctx.approvals)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^a receipt naming the ticket is posted in Approvals$/, (ctx) => {
    const hit = ctx.notified.find((n) => n.text && n.text.includes(TICKET_ID));
    if (!hit) {
      throw new Error(`expected Approvals receipt naming ${TICKET_ID}, got: ${JSON.stringify(ctx.notified)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the Approvals topic$/, (ctx) => {
    resetCtx(ctx);
  }, FEATURE);

  registry.defineScoped(
    /^the human sends "\/ambulance BL-xxx" naming a ticket that exists under backlog\/$/,
    async (ctx) => {
      ctx.deliverResult = await sendApprovalsTopicText(ctx, `/ambulance ${TICKET_ID}`);
    },
    FEATURE
  );

  registry.defineScoped(/^human_approval is not flipped by this command$/, (ctx) => {
    const content = fs.readFileSync(ticketPath(ctx.targetPath, 'active', TICKET_ID), 'utf8');
    if (!/^human_approval: pending$/m.test(content)) {
      throw new Error(`expected human_approval still pending after /ambulance, got:\n${content}`);
    }
    if (ctx.approvals.length !== 0) {
      throw new Error(`expected no approval flip, got: ${JSON.stringify(ctx.approvals)}`);
    }
  }, FEATURE);

  registry.defineScoped(
    /^the human sends "\/ambulance BL-99999" naming no YAML under backlog\/$/,
    async (ctx) => {
      ctx.deliverResult = await sendApprovalsTopicText(ctx, `/ambulance ${MISSING_ID}`);
    },
    FEATURE
  );

  registry.defineScoped(/^ambulance is not engaged$/, (ctx) => {
    if (fs.existsSync(markerPath(ctx.targetPath))) {
      const raw = JSON.parse(fs.readFileSync(markerPath(ctx.targetPath), 'utf8'));
      if (raw.active) {
        throw new Error(`expected no active ambulance marker, got: ${JSON.stringify(raw)}`);
      }
    }
    if (ctx.engages.some((e) => e.ok)) {
      throw new Error(`expected engage to fail, got: ${JSON.stringify(ctx.engages)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the refusal is posted in Approvals$/, (ctx) => {
    const hit = ctx.notified.find((n) => n.text && /refused|no YAML/i.test(n.text));
    if (!hit) {
      throw new Error(`expected refusal in Approvals, got: ${JSON.stringify(ctx.notified)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^an Approvals ask$/, (ctx) => {
    resetCtx(ctx);
  }, FEATURE);

  registry.defineScoped(/^the human taps Ambulance$/, async (ctx) => {
    ctx.deliverResult = await tapAmbulance(ctx);
  }, FEATURE);

  registry.defineScoped(/^the ticket is not force-promoted$/, (ctx) => {
    if (ctx.promotions.length !== 0) {
      throw new Error(`expected no promoteTicketIfPaused, got: ${JSON.stringify(ctx.promotions)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^no build is dispatched$/, (ctx) => {
    if (ctx.dispatches.length !== 0) {
      throw new Error(`expected no dispatchExpediteBuild, got: ${JSON.stringify(ctx.dispatches)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the offline expeditor is not started$/, (ctx) => {
    if (ctx.cursorBridgeForwards.length !== 0) {
      throw new Error(`expected no Cursor-bridge forward, got: ${JSON.stringify(ctx.cursorBridgeForwards)}`);
    }
    if (parseExpediteTicket(`/ambulance ${TICKET_ID}`) !== undefined) {
      throw new Error('offline expeditor parser must not recognize /ambulance');
    }
  }, FEATURE);
}

module.exports = { registerSteps };
