'use strict';

// BL-329: step handlers for "A BL topic's content is serialised into the
// repo, so the topic is a projection and not the source of truth". Drives
// the REAL compiled functions (extension/out/concierge/blTopicStore,
// extension/out/tools/telegram-front-desk-bot's postOperatorContext,
// extension/out/tools/backfill-bl-topic-store), never re-implements the
// store or the wiring here - the SAME boundary this session's other
// acceptance suites draw (BL-320/BL-328): real logic, a stubbed network
// leg only where a real Telegram HTTP call would otherwise be required.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { readRecord, appendMessage } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'blTopicStore'));
const { postOperatorContext } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'telegram-front-desk-bot'));
const { routeEvent } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'topicRouter'));
const { backfillBlTopicStore } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'backfill-bl-topic-store'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl329-acceptance-'));
}

// Real routeEvent, real recordMessage -> real appendMessage - only
// sendMessage/createTopic are stubbed (the actual Telegram HTTP leg,
// same boundary BL-320's own acceptance steps draw around sendReply).
function realOutboundAdapters(ctx) {
  return {
    getTopicMap: () => ({ [ctx.ticketId]: 42 }),
    createTopic: async () => ({ success: true, topicId: 42 }),
    recordTopicId: () => {},
    sendMessage: async () => true,
    closeTopic: async () => true,
    recordMessage: (backlogId, text) => appendMessage(ctx.target, backlogId, { author: 'swarm', type: 'outbound', text }),
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a backlog ticket that has its own Telegram topic$/, (ctx) => {
    ctx.target = mkTmp();
    ctx.ticketId = 'BL-900';
  });

  // ── serialise-topic-01 (Scenario Outline) ───────────────────────────
  registry.define(/^an? (inbound|outbound) message is sent in that ticket's topic$/, async (ctx, direction) => {
    ctx.direction = direction;
    // Inbound text is free-form human input. Outbound text is SYSTEM
    // computed (topicRouter.ts's own messageTextForEvent) - not something
    // this step can dictate, so it is set to the exact deterministic
    // string routeEvent will itself generate for the event used below,
    // matching REAL production behavior rather than an invented value.
    ctx.messageText = direction === 'inbound' ? 'a real human question' : 'NeedsApproval: BL-900';
  });

  registry.define(/^the message is handled$/, async (ctx) => {
    if (ctx.direction === 'inbound') {
      // The REAL wired inbound path - exactly what telegram-front-desk-bot.ts
      // calls when a human posts into a BL topic.
      await postOperatorContext(ctx.target, ctx.ticketId, ctx.messageText);
    } else {
      // The REAL wired outbound path - routeEvent's own recordMessage call,
      // exercised through the actual router, not a hand-rolled substitute.
      await routeEvent(
        { type: 'NeedsApproval', backlogId: ctx.ticketId, payload: {} },
        'a fine feature',
        realOutboundAdapters(ctx)
      );
    }
  });

  registry.define(/^it is serialised into that ticket's durable record$/, (ctx) => {
    const record = readRecord(ctx.target, ctx.ticketId);
    if (record.messages.length !== 1) {
      throw new Error(`expected exactly one serialised message, got ${JSON.stringify(record)}`);
    }
    ctx.lastEntry = record.messages[0];
  });

  registry.define(/^the record entry carries its order, its timestamp, its author and its text$/, (ctx) => {
    const entry = ctx.lastEntry;
    if (typeof entry.seq !== 'number') throw new Error(`expected a numeric seq (order), got ${JSON.stringify(entry)}`);
    if (typeof entry.ts !== 'number') throw new Error(`expected a numeric ts (timestamp), got ${JSON.stringify(entry)}`);
    if (!entry.author) throw new Error(`expected a non-empty author, got ${JSON.stringify(entry)}`);
    if (entry.text !== ctx.messageText) throw new Error(`expected the exact sent text preserved, got ${JSON.stringify(entry)}`);
    if (ctx.direction === 'inbound' && entry.author !== 'human') {
      throw new Error(`expected an inbound message's author to be 'human', got ${entry.author}`);
    }
    if (ctx.direction === 'outbound' && entry.author === 'human') {
      throw new Error(`expected an outbound message's author NOT to be 'human', got ${entry.author}`);
    }
  });

  // ── serialise-topic-02 ───────────────────────────────────────────────
  registry.define(/^messages have been serialised for a ticket$/, (ctx) => {
    ctx.otherTicketId = 'BL-901';
    appendMessage(ctx.target, ctx.ticketId, { author: 'human', type: 'inbound', text: 'for this ticket', ts: 1 });
    appendMessage(ctx.target, ctx.otherTicketId, { author: 'human', type: 'inbound', text: 'for a DIFFERENT ticket', ts: 1 });
  });

  registry.define(/^that ticket's record is read$/, (ctx) => {
    ctx.readResult = readRecord(ctx.target, ctx.ticketId);
  });

  registry.define(/^it is found in the repository, keyed by that ticket$/, (ctx) => {
    const recordFile = path.join(ctx.target, 'backlog', 'topics', `${ctx.ticketId}.json`);
    if (!fs.existsSync(recordFile)) {
      throw new Error(`expected the record on disk under backlog/topics/, keyed by ${ctx.ticketId}, at ${recordFile}`);
    }
    if (recordFile.includes('.swarmforge')) {
      throw new Error('expected the record OUTSIDE the gitignored .swarmforge/ tree');
    }
    if (ctx.readResult.id !== ctx.ticketId) {
      throw new Error(`expected the record's own id to be ${ctx.ticketId}, got ${ctx.readResult.id}`);
    }
  });

  registry.define(/^it contains that ticket's messages only$/, (ctx) => {
    const texts = ctx.readResult.messages.map((m) => m.text);
    if (!texts.includes('for this ticket') || texts.includes('for a DIFFERENT ticket')) {
      throw new Error(`expected only this ticket's own messages, got ${JSON.stringify(texts)}`);
    }
  });

  // ── serialise-topic-03 ───────────────────────────────────────────────
  registry.define(/^several messages were sent in a ticket's topic in a known order$/, (ctx) => {
    ctx.sentOrder = ['third-ish text but sent first', 'aaa sent second', 'zzz sent third'];
    ctx.sentOrder.forEach((text, i) => {
      appendMessage(ctx.target, ctx.ticketId, { author: i % 2 === 0 ? 'human' : 'swarm', type: i % 2 === 0 ? 'inbound' : 'outbound', text, ts: i + 1 });
    });
  });

  registry.define(/^the messages appear in the order they were sent$/, (ctx) => {
    const record = readRecord(ctx.target, ctx.ticketId);
    const texts = record.messages.map((m) => m.text);
    if (JSON.stringify(texts) !== JSON.stringify(ctx.sentOrder)) {
      throw new Error(`expected send order preserved ${JSON.stringify(ctx.sentOrder)}, got ${JSON.stringify(texts)}`);
    }
  });

  // ── serialise-topic-04 ───────────────────────────────────────────────
  registry.define(/^the process that serialised them is restarted$/, (ctx) => {
    // Nothing but the filesystem carries state forward across a restart -
    // simulated by making a FRESH require() call irrelevant: readRecord
    // takes no in-memory state at all, so a "restart" here is exactly
    // "read again from a call that has never touched this process's own
    // memory of what it wrote" - the real invariant scenario 04 needs.
    ctx.afterRestart = readRecord(ctx.target, ctx.ticketId);
  });

  registry.define(/^the record still contains every serialised message$/, (ctx) => {
    if (ctx.afterRestart.messages.length !== 1 || ctx.afterRestart.messages[0].text !== 'for this ticket') {
      throw new Error(`expected the pre-restart message to survive, got ${JSON.stringify(ctx.afterRestart)}`);
    }
  });

  // ── serialise-topic-05 ───────────────────────────────────────────────
  registry.define(/^human messages for a ticket exist in the operator event log from before this feature$/, (ctx) => {
    const dir = path.join(ctx.target, '.swarmforge', 'operator');
    fs.mkdirSync(dir, { recursive: true });
    ctx.backfillText = 'a message captured before BL-329 shipped';
    fs.writeFileSync(
      path.join(dir, 'events.jsonl'),
      JSON.stringify({ type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: ctx.ticketId, text: ctx.backfillText }) + '\n'
    );
  });

  registry.define(/^the record is backfilled$/, (ctx) => {
    ctx.backfillResult = backfillBlTopicStore(ctx.target);
  });

  registry.define(/^those messages appear in that ticket's record$/, (ctx) => {
    if (ctx.backfillResult.imported !== 1) {
      throw new Error(`expected exactly one message imported, got ${JSON.stringify(ctx.backfillResult)}`);
    }
    const record = readRecord(ctx.target, ctx.ticketId);
    const texts = record.messages.map((m) => m.text);
    if (!texts.includes(ctx.backfillText)) {
      throw new Error(`expected the backfilled message in the ticket's record, got ${JSON.stringify(texts)}`);
    }
  });
}

module.exports = { registerSteps };
