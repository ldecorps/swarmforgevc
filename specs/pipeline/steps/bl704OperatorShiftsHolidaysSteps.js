'use strict';

const fs = require('fs');
const path = require('path');

const policy = require('../../../extension/out/tools/telegramCursorOperatorPolicy');
const botCore = require('../../../extension/out/tools/telegramFrontDeskBotCore');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-704 operator shifts, holidays, oncall, and docs';

function mkRoot() {
  const root = trackedTmpRoot('bl704-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function registerSteps(registry) {
  registry.defineScoped(/^BL-702 confirm foundations are in place$/, (ctx) => {
    ctx.root = mkRoot();
  }, FEATURE);

  registry.defineScoped(/^a principal-only Cursor Remote Telegram topic$/, (ctx) => {
    // The standing Operator topic is principal-only: a principal message in
    // it is eligible, a stranger's message in the same topic is dropped.
    const principalId = '111';
    const chatId = '222';
    const topicId = 7;
    const subjectForTopic = (tid) => (tid === topicId ? botCore.OPERATOR_SUBJECT_ID : undefined);
    const principalUpdate = {
      update_id: 1,
      message: { message_id: 1, chat: { id: chatId }, from: { id: principalId }, text: '/pilot BL-698', message_thread_id: topicId },
    };
    const strangerUpdate = {
      update_id: 2,
      message: { message_id: 2, chat: { id: chatId }, from: { id: '999' }, text: '/pilot BL-698', message_thread_id: topicId },
    };
    const principalDecision = botCore.decideUpdateAction(principalUpdate, principalId, chatId, subjectForTopic);
    if (principalDecision.action !== 'post-existing' || principalDecision.subjectId !== botCore.OPERATOR_SUBJECT_ID) {
      throw new Error(`expected principal message in the Operator topic to be eligible, got: ${JSON.stringify(principalDecision)}`);
    }
    const strangerDecision = botCore.decideUpdateAction(strangerUpdate, principalId, chatId, subjectForTopic);
    if (strangerDecision.action !== 'drop' || strangerDecision.reason !== 'not-principal') {
      throw new Error(`expected stranger message in the Operator topic to be dropped as not-principal, got: ${JSON.stringify(strangerDecision)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^a holiday covering today is recorded$/, (ctx) => {
    const today = policy.todayUtcDate();
    const range = { start: today, end: today, reason: 'test' };
    let state = policy.emptyOperatorPolicy();
    state = policy.applyHolidayAdd(state, range);
    policy.writeOperatorPolicy(ctx.root, state);
    ctx.state = state;
  }, FEATURE);

  registry.defineScoped(/^the principal sends "([^"]+)"$/, (ctx, cmd) => {
    const parts = cmd.split(/\s+/);
    const verb = parts[0];
    const rest = parts.slice(1).join(' ');

    if (verb === '/pilot') {
      const state = policy.readOperatorPolicy(ctx.root);
      const holiday = policy.isHolidayQuietToday(state);
      if (holiday && policy.isHolidayBlockedVerb('/pilot')) {
        ctx.reply = policy.formatHolidayRefuse(holiday, '/pilot');
        ctx.buttons = policy.runAnywayButtons('/pilot', rest);
        ctx.refused = true;
      } else {
        ctx.refused = false;
      }
    } else if (verb === '/holiday' && rest.startsWith('add')) {
      const args = rest.slice('add'.length);
      const range = policy.parseHolidayAddArgs(args);
      if (range.error) {
        ctx.reply = range.error;
      } else {
        let state = policy.readOperatorPolicy(ctx.root);
        state = policy.applyHolidayAdd(state, range);
        policy.writeOperatorPolicy(ctx.root, state);
        ctx.reply = 'ok';
        ctx.state = state;
      }
    } else if (verb === '/holiday' && rest.startsWith('list')) {
      const state = policy.readOperatorPolicy(ctx.root);
      ctx.reply = policy.formatHolidayList(state);
    } else if (verb === '/shift' && rest.startsWith('start')) {
      const name = rest.slice('start'.length).trim();
      let state = policy.readOperatorPolicy(ctx.root);
      state = policy.applyShiftStart(state, name, undefined);
      policy.writeOperatorPolicy(ctx.root, state);
      ctx.reply = 'ok';
      ctx.state = state;
    } else if (verb === '/shift' && rest.startsWith('status')) {
      const state = policy.readOperatorPolicy(ctx.root);
      ctx.reply = policy.formatShiftStatus(state);
    }
  }, FEATURE);

  registry.defineScoped(/^the bridge refuses citing holiday quiet$/, (ctx) => {
    if (!ctx.refused) {
      throw new Error('expected bridge to refuse citing holiday quiet');
    }
    if (!ctx.reply.includes('holiday quiet')) {
      throw new Error(`expected reply to cite holiday quiet: ${ctx.reply}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the reply offers a Run anyway confirm$/, (ctx) => {
    const texts = (ctx.buttons || []).flat().map((b) => b.text);
    if (!texts.includes('Run anyway')) {
      throw new Error(`expected Run anyway button, got: ${JSON.stringify(texts)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the principal confirms Run anyway$/, (ctx) => {
    ctx.confirmed = true;
  }, FEATURE);

  registry.defineScoped(/^the pilot path may proceed$/, (ctx) => {
    if (!ctx.confirmed) {
      throw new Error('expected Run anyway confirmation before proceeding');
    }
  }, FEATURE);

  registry.defineScoped(/^the list includes that range$/, (ctx) => {
    if (!ctx.reply.includes('2099-01-01') || !ctx.reply.includes('2099-01-02')) {
      throw new Error(`expected holiday list to include range: ${ctx.reply}`);
    }
  }, FEATURE);

  registry.defineScoped(/^status reports the active shift$/, (ctx) => {
    if (!ctx.reply.includes('evening')) {
      throw new Error(`expected shift status to report evening: ${ctx.reply}`);
    }
  }, FEATURE);

  registry.defineScoped(/^durable state is only under \.swarmforge\/operator\/$/, (ctx) => {
    const policyFile = policy.policyPath(ctx.root);
    if (!policyFile.startsWith(path.join(ctx.root, '.swarmforge', 'operator'))) {
      throw new Error(`expected policy file under .swarmforge/operator, got: ${policyFile}`);
    }
    if (!fs.existsSync(policyFile)) {
      throw new Error(`expected durable policy file at ${policyFile}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
