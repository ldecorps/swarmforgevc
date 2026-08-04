'use strict';

// BL-708: step handlers for "A role's clarifying question reaches its own
// Telegram topic". Drives the REAL relay boundary end to end - a real
// telegram-reply-outbox.jsonl file, the REAL bridge reader
// (readNewReplyOutboxEntries, operatorEventQueue.ts) that the ticket's
// forensics named as the field-stripping site, a real JSON.stringify of the
// resulting entry (byte-for-byte what bridgeServer.ts's relayEntriesFrom
// puts on the wire), and the REAL front-desk relay (relaySseReplies /
// relayOneRecord, telegramFrontDeskBotCore.ts) that decides delivery. Only
// the Telegram network boundary (sendReply/sendAskButtons/
// agentQuestionsTopicId/roleTopicIdFor) and console.error are faked -
// exactly the "drive the real core, fake only the network boundary"
// posture bl425RoleSteeringTopicsSteps.js/bl410ApprovalInlineKeyboardButtonsSteps.js
// already use.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { readNewReplyOutboxEntries } = require(path.join(EXT_DIR, 'out', 'bridge', 'operatorEventQueue'));
const { relaySseReplies } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));

const SPECIFIER_TOPIC_ID = 1595;
const AGENT_QUESTIONS_TOPIC_ID = 42;
const QUESTION_OPTIONS = [{ label: 'staging' }, { label: 'prod' }];

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl708-'));
}

function outboxFile(targetPath) {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
}

function writeOutboxLine(targetPath, record) {
  const file = outboxFile(targetPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

function mkSingleChunkReader(chunk) {
  let sent = false;
  return async () => {
    if (sent) {
      return { done: true, chunk: '' };
    }
    sent = true;
    return { done: false, chunk };
  };
}

// Runs the real bridge-read -> real-SSE-wire -> real-relay pipeline for
// whatever is currently at the outbox's HEAD (sinceIndex 0 - one record per
// scenario) and records every observable outcome onto ctx. console.error is
// monkeypatched directly (this pipeline runs under node:test, not Vitest -
// no vi.spyOn available) - restored in a finally exactly like
// telegramFrontDeskBotCore.property.test.js's recordApprovalDecisionAndClose
// property already does for process.stderr.write.
async function relayCurrentOutbox(ctx) {
  const { entries } = readNewReplyOutboxEntries(ctx.targetPath, 0);
  if (entries.length !== 1) {
    throw new Error(`expected exactly one new outbox entry, got ${entries.length}`);
  }
  ctx.entry = entries[0];
  const sse = `event: telegram-reply\ndata: ${JSON.stringify(ctx.entry)}\n\n`;

  const originalConsoleError = console.error;
  console.error = (msg) => {
    ctx.traces.push(String(msg));
    ctx.eventOrder.push('trace');
  };
  try {
    await relaySseReplies(
      '',
      {
        sendReply: async (topicId, text) => {
          ctx.sentReplies.push({ topicId, text });
          ctx.eventOrder.push('send');
        },
        sendAskButtons: async (topicId, text, buttons) => {
          ctx.posted.push({ topicId, text, buttons });
          ctx.eventOrder.push('send');
          return { success: true, messageId: 555 };
        },
        resolveDelivery: (threadId) => {
          ctx.resolveDeliveryCalls.push(threadId);
          return { kind: 'default' };
        },
        roleTopicIdFor: async (role) => (role in ctx.roleTopicMap ? ctx.roleTopicMap[role] : undefined),
        agentQuestionsTopicId: async () => {
          ctx.agentQuestionsTopicIdCalls += 1;
          return AGENT_QUESTIONS_TOPIC_ID;
        },
        ackReply: async (id) => {
          ctx.acked.push(id);
          ctx.eventOrder.push('ack');
        },
        readChunk: mkSingleChunkReader(sse),
      },
      new Set()
    );
  } finally {
    console.error = originalConsoleError;
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the front desk is relaying reply-outbox records from the bridge$/, (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.roleTopicMap = {};
    ctx.askingRole = 'specifier';
    ctx.sentReplies = [];
    ctx.posted = [];
    ctx.acked = [];
    ctx.traces = [];
    ctx.eventOrder = [];
    ctx.resolveDeliveryCalls = [];
    ctx.agentQuestionsTopicIdCalls = 0;
  });

  registry.define(/^the specifier role is mapped to its own Telegram topic$/, (ctx) => {
    ctx.roleTopicMap.specifier = SPECIFIER_TOPIC_ID;
  });

  // ── Scenario-specific Given ──────────────────────────────────────────
  registry.define(/^the asking role has no Telegram topic mapped$/, (ctx) => {
    ctx.askingRole = 'ghost-role';
  });

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(
    /^a question record marked (roleQuestion|agentQuestion) with options (present|absent) is written to the reply outbox$/,
    async (ctx, questionField, optionsPresence) => {
      const record = { id: 'q1', text: 'which environment?' };
      if (questionField === 'roleQuestion') {
        record.threadId = `role-ask-${ctx.askingRole}`;
        record.roleQuestion = ctx.askingRole;
      } else {
        record.threadId = 'SUP-1';
        record.agentQuestion = true;
      }
      if (optionsPresence === 'present') {
        record.options = QUESTION_OPTIONS;
      }
      ctx.writtenRecord = record;
      ctx.questionField = questionField;
      ctx.optionsPresence = optionsPresence;
      writeOutboxLine(ctx.targetPath, record);
      await relayCurrentOutbox(ctx);
    }
  );

  registry.define(/^a reply record carrying no question field is written to the reply outbox$/, async (ctx) => {
    const record = { id: 'r1', threadId: 'SUP-2', text: 'hello' };
    ctx.writtenRecord = record;
    writeOutboxLine(ctx.targetPath, record);
    await relayCurrentOutbox(ctx);
  });

  // ── Then ─────────────────────────────────────────────────────────────
  registry.define(/^the front desk receives that record with (roleQuestion|agentQuestion) and its options intact$/, (ctx, questionField) => {
    const expected = questionField === 'roleQuestion' ? ctx.askingRole : true;
    if (ctx.entry[questionField] !== expected) {
      throw new Error(`expected entry.${questionField} to be ${JSON.stringify(expected)}, got ${JSON.stringify(ctx.entry[questionField])}`);
    }
    if (ctx.optionsPresence === 'present') {
      if (JSON.stringify(ctx.entry.options) !== JSON.stringify(QUESTION_OPTIONS)) {
        throw new Error(`expected entry.options to survive intact, got ${JSON.stringify(ctx.entry.options)}`);
      }
    } else if ('options' in ctx.entry) {
      throw new Error(`expected no options key when none was written, got ${JSON.stringify(ctx.entry.options)}`);
    }
  });

  registry.define(/^the question is posted into (the asking role's own topic|the shared agent questions topic)$/, (ctx, destination) => {
    const delivered = [...ctx.sentReplies, ...ctx.posted];
    if (delivered.length !== 1) {
      throw new Error(`expected exactly one delivery attempt, got ${JSON.stringify(delivered)}`);
    }
    if (destination === "the asking role's own topic") {
      if (delivered[0].topicId !== ctx.roleTopicMap[ctx.askingRole]) {
        throw new Error(`expected delivery to the role's own topic ${ctx.roleTopicMap[ctx.askingRole]}, got ${delivered[0].topicId}`);
      }
      if (ctx.agentQuestionsTopicIdCalls !== 0) {
        throw new Error('agentQuestionsTopicId must never be consulted for a roleQuestion record');
      }
    } else {
      if (delivered[0].topicId !== AGENT_QUESTIONS_TOPIC_ID) {
        throw new Error(`expected delivery to the shared Agent Questions topic ${AGENT_QUESTIONS_TOPIC_ID}, got ${delivered[0].topicId}`);
      }
      if (ctx.agentQuestionsTopicIdCalls !== 1) {
        throw new Error(`expected agentQuestionsTopicId to be consulted exactly once, got ${ctx.agentQuestionsTopicIdCalls}`);
      }
    }
  });

  registry.define(/^the message posted into the asking role's own topic offers every option as a tappable button$/, (ctx) => {
    if (ctx.posted.length !== 1) {
      throw new Error(`expected exactly one buttons message, got ${JSON.stringify(ctx.posted)}`);
    }
    const labels = ctx.posted[0].buttons.map((row) => row[0].text);
    const expectedLabels = QUESTION_OPTIONS.map((o) => o.label);
    if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) {
      throw new Error(`expected one tappable button per option in order, got labels ${JSON.stringify(labels)}`);
    }
  });

  registry.define(/^the front desk does not deliver it through the ordinary reply path$/, (ctx) => {
    if (ctx.resolveDeliveryCalls.length !== 0) {
      throw new Error(`expected resolveDelivery never consulted for a roleQuestion record, but it was called with ${JSON.stringify(ctx.resolveDeliveryCalls)}`);
    }
  });

  registry.define(/^no delivery is attempted against the synthetic role-ask thread id$/, (ctx) => {
    const syntheticId = `role-ask-${ctx.askingRole}`;
    if (ctx.resolveDeliveryCalls.includes(syntheticId)) {
      throw new Error(`expected no resolveDelivery call against the synthetic thread id ${syntheticId}`);
    }
  });

  registry.define(/^the undeliverable question leaves a surfaced trace naming that role$/, (ctx) => {
    if (!ctx.traces.some((t) => t.includes(ctx.askingRole))) {
      throw new Error(`expected a surfaced trace naming "${ctx.askingRole}", got ${JSON.stringify(ctx.traces)}`);
    }
  });

  registry.define(/^the record is not reported as delivered$/, (ctx) => {
    if (ctx.sentReplies.length !== 0 || ctx.posted.length !== 0) {
      throw new Error(`expected no successful delivery for an undeliverable question, got sentReplies=${JSON.stringify(ctx.sentReplies)} posted=${JSON.stringify(ctx.posted)}`);
    }
    const traceIndex = ctx.eventOrder.indexOf('trace');
    const ackIndex = ctx.eventOrder.indexOf('ack');
    if (traceIndex === -1 || ackIndex === -1 || traceIndex > ackIndex) {
      throw new Error(`expected the trace to fire strictly before the ack, got order ${JSON.stringify(ctx.eventOrder)}`);
    }
  });

  registry.define(/^the front desk delivers it through the ordinary reply path as before$/, (ctx) => {
    if (!ctx.resolveDeliveryCalls.includes(ctx.writtenRecord.threadId)) {
      throw new Error(`expected resolveDelivery to be consulted for ${ctx.writtenRecord.threadId}, got ${JSON.stringify(ctx.resolveDeliveryCalls)}`);
    }
    if (!ctx.sentReplies.some((r) => r.text === ctx.writtenRecord.text)) {
      throw new Error(`expected the ordinary reply to be sent, got ${JSON.stringify(ctx.sentReplies)}`);
    }
  });
}

module.exports = { registerSteps };
