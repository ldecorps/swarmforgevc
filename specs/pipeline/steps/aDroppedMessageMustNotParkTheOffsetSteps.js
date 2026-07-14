'use strict';

// BL-389 (LIVE INCIDENT): step handlers for "A message dropped on purpose
// does not trap the front desk in a loop". Drives the REAL compiled core
// (extension/out/tools/telegramFrontDeskBotCore's pollAndForward, the exact
// function whose boolean/outcome conflation parked the Telegram offset
// forever) for scenarios 01-03, and the REAL compiled live wrapper
// (extension/out/tools/telegram-front-desk-bot's postOperatorContext, the
// exact adapter that flooded backlog/topics/BL-359.json with 209 duplicate
// commits) plus its blTopicStore record for scenarios 04-05 - never a
// hand-rolled substitute for either.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { pollAndForward } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));
const { postOperatorContext } = require(path.join(EXT_OUT, 'tools', 'telegram-front-desk-bot'));
const { readRecord } = require(path.join(EXT_OUT, 'concierge', 'blTopicStore'));

const PRINCIPAL_ID = 111;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkUpdate(id, { principal, text }) {
  return { update_id: id, message: { message_id: id, chat: { id: 1 }, from: { id: principal ? PRINCIPAL_ID : 999 }, text } };
}

function pushDropped(ctx) {
  ctx.updates = ctx.updates || [];
  const id = 100 + ctx.updates.length;
  // A non-principal sender is a DELIBERATE drop (decideUpdateAction's own
  // not-principal branch) - the same class of drop as a photo/sticker/
  // service message the ticket's notes call out, chosen here because it
  // needs no extra fixture machinery to express as a pure update.
  ctx.updates.push({ kind: 'dropped', update: mkUpdate(id, { principal: false, text: 'not the principal' }) });
  ctx.droppedUpdateId = id;
  return id;
}

function pushFailed(ctx) {
  ctx.updates = ctx.updates || [];
  const id = 100 + ctx.updates.length;
  ctx.updates.push({ kind: 'failed', update: mkUpdate(id, { principal: true, text: 'a real message' }) });
  ctx.failedUpdateId = id;
  return id;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the front desk is collecting messages$/, (ctx) => {
    ctx.updates = [];
  });

  // ── a-dropped-message-must-not-park-the-offset-01/03 ────────────────
  registry.define(/^a message the front desk drops on purpose$/, (ctx) => {
    pushDropped(ctx);
  });

  // ── a-dropped-message-must-not-park-the-offset-02 ───────────────────
  registry.define(/^a message whose delivery failed$/, (ctx) => {
    pushFailed(ctx);
  });

  // ── a-dropped-message-must-not-park-the-offset-03 (second Given) ────
  registry.define(/^a later message whose delivery failed$/, (ctx) => {
    pushFailed(ctx);
  });

  // ── shared When (01/02/03) ───────────────────────────────────────────
  registry.define(/^the front desk collects the waiting messages$/, async (ctx) => {
    const adapters = {
      getUpdates: async () => ({ success: true, updates: ctx.updates.map((u) => u.update) }),
      postToBridge: async (subjectId, text, updateId) => {
        const entry = ctx.updates.find((u) => u.update.update_id === updateId);
        return entry.kind !== 'failed';
      },
      subjectForTopic: () => 'SUP-1',
      openSubjectAndRecord: async () => {
        throw new Error('openSubjectAndRecord should not be called - every update in this scenario is either dropped or routes to an already-mapped subject');
      },
      backlogForTopic: () => undefined,
      postOperatorContext: async () => true,
      recordApprovalReply: async () => true,
    };
    ctx.result = await pollAndForward(0, PRINCIPAL_ID, adapters);
  });

  // ── a-dropped-message-must-not-park-the-offset-01 ───────────────────
  registry.define(/^the front desk moves past that message$/, (ctx) => {
    if (ctx.result.nextOffset <= ctx.droppedUpdateId) {
      throw new Error(`expected the offset to advance past the dropped update ${ctx.droppedUpdateId}, got nextOffset=${ctx.result.nextOffset}`);
    }
  });

  // ── a-dropped-message-must-not-park-the-offset-02 ───────────────────
  registry.define(/^the front desk does not move past that message$/, (ctx) => {
    if (ctx.result.nextOffset > ctx.failedUpdateId) {
      throw new Error(`expected the offset to NOT advance past the failed update ${ctx.failedUpdateId}, got nextOffset=${ctx.result.nextOffset}`);
    }
  });

  // ── a-dropped-message-must-not-park-the-offset-03 (two DISTINCT Then
  //    steps, deliberately worded differently from 01/02's own "that
  //    message" Then steps above - the antonym pair this ticket's notes
  //    warn about, registered as exact, non-overlapping regexes) ────────
  registry.define(/^the front desk moves past the dropped message$/, (ctx) => {
    if (ctx.result.nextOffset <= ctx.droppedUpdateId) {
      throw new Error(`expected the offset to advance past the dropped update ${ctx.droppedUpdateId}, got nextOffset=${ctx.result.nextOffset}`);
    }
  });

  registry.define(/^the front desk does not move past the failed message$/, (ctx) => {
    if (ctx.result.nextOffset > ctx.failedUpdateId) {
      throw new Error(`expected the offset to NOT advance past the failed update ${ctx.failedUpdateId}, got nextOffset=${ctx.result.nextOffset}`);
    }
  });

  // ── a-dropped-message-must-not-park-the-offset-04/05 ────────────────
  registry.define(/^a message already recorded against its ticket$/, async (ctx) => {
    ctx.target = mkTmp('sfvc-bl389-record-');
    ctx.ticketId = 'BL-777';
    ctx.updateId = 501;
    ctx.text = 'nothing to approve right now';
    await postOperatorContext(ctx.target, ctx.ticketId, ctx.text, ctx.updateId);
  });

  registry.define(/^a message already answered by the swarm$/, async (ctx) => {
    ctx.target = mkTmp('sfvc-bl389-answer-');
    ctx.ticketId = 'BL-778';
    ctx.updateId = 601;
    ctx.text = 'nothing to approve right now';
    await postOperatorContext(ctx.target, ctx.ticketId, ctx.text, ctx.updateId);
  });

  registry.define(/^the front desk is given that same message again$/, async (ctx) => {
    await postOperatorContext(ctx.target, ctx.ticketId, ctx.text, ctx.updateId);
  });

  registry.define(/^it is not recorded against that ticket a second time$/, (ctx) => {
    const record = readRecord(ctx.target, ctx.ticketId);
    if (record.messages.length !== 1) {
      throw new Error(`expected exactly one recorded message against ${ctx.ticketId}, got ${record.messages.length}`);
    }
  });

  registry.define(/^the human is not answered a second time$/, (ctx) => {
    const file = path.join(ctx.target, '.swarmforge', 'operator', 'events.jsonl');
    const lines = fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const matching = lines.filter((e) => e.backlogId === ctx.ticketId);
    if (matching.length !== 1) {
      throw new Error(`expected exactly one Operator wake for ${ctx.ticketId}, got ${matching.length}`);
    }
  });
}

module.exports = { registerSteps };
