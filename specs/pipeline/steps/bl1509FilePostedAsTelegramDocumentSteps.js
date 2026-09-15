'use strict';

// BL-1509: step handlers for the Telegram document-upload feature. Scenarios
// 01/02 drive the real telegramClient.sendDocument (production code,
// unchanged pattern to sendVoiceNote's own multipart tests) with an
// injected postFn - never a real network call. Scenario 03 drives the real
// exported CLI core (sendTelegramDocumentCore), same "drive the real core,
// fake only the Telegram/network boundary" posture as
// bl426AudioVoiceNoteCoordinatorSteps.js, against a real mkdtemp fixture
// root and TELEGRAM_NOTIFY_FORCE_RESULT (BL-353's own no-network seam) -
// the "send function is injected" the ticket's own scenario notes ask for.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { sendDocument } = require('../../../extension/out/notify/telegramClient');
const { sendTelegramDocumentCore } = require('../../../extension/out/tools/send-telegram-document');

const TOKEN = '123456:test-bot-token';
const CHAT_ID = '999888777';
const TOPIC_ID = 42;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function registerSteps(registry) {
  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.define(/^a bot token, a chat id and a topic id$/, (ctx) => {
    ctx.token = TOKEN;
    ctx.chatId = CHAT_ID;
    ctx.topicId = TOPIC_ID;
  });

  registry.define(/^a file named (\S+) is sent as a document to that topic$/, async (ctx, filename) => {
    ctx.calls = [];
    const postFn = async (url, form) => {
      ctx.calls.push({ url, form });
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 1 } } };
    };
    ctx.filename = filename;
    ctx.result = await sendDocument(ctx.token, ctx.chatId, Buffer.from('contents'), filename, ctx.topicId, undefined, postFn);
  });

  registry.define(/^the client posts one multipart request to the sendDocument endpoint$/, (ctx) => {
    assert.equal(ctx.calls.length, 1, 'expected exactly one multipart request');
    assert.equal(ctx.calls[0].url, `https://api.telegram.org/bot${ctx.token}/sendDocument`);
  });

  registry.define(/^the form carries the chat id, the topic id as message_thread_id, and the file under its own name$/, (ctx) => {
    const form = ctx.calls[0].form;
    assert.equal(form.get('chat_id'), ctx.chatId);
    assert.equal(form.get('message_thread_id'), String(ctx.topicId));
    const document = form.get('document');
    assert.ok(document, 'expected a document form part');
    assert.equal(document.name, ctx.filename);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.define(/^the Bot API answers (.+)$/, (ctx, answer) => {
    const httpMatch = answer.match(/^HTTP (\d+) with description "([^"]*)"$/);
    if (httpMatch) {
      ctx.mode = 'http-error';
      ctx.status = Number(httpMatch[1]);
      ctx.description = httpMatch[2];
      return;
    }
    if (answer === 'a network failure before any response') {
      ctx.mode = 'network-error';
      ctx.networkFailureMessage = `network unreachable (token ${TOKEN})`;
      return;
    }
    throw new Error(`unrecognized Bot API answer: ${answer}`);
  });

  registry.define(/^a file is sent as a document$/, async (ctx) => {
    const postFn = async () => {
      if (ctx.mode === 'http-error') {
        return { ok: false, status: ctx.status, json: { ok: false, description: ctx.description } };
      }
      throw new Error(ctx.networkFailureMessage);
    };
    ctx.result = await sendDocument(TOKEN, CHAT_ID, Buffer.from('contents'), 'report.md', undefined, undefined, postFn);
  });

  registry.define(/^the result is not a success$/, (ctx) => {
    assert.equal(ctx.result.success, false);
  });

  registry.define(/^its error carries (.+) and never the token$/, (ctx, reasonLabel) => {
    assert.ok(ctx.result.error, 'expected an error message');
    if (reasonLabel === 'the description text') {
      assert.match(ctx.result.error, new RegExp(escapeRegExp(ctx.description)));
    } else if (reasonLabel === 'the failure message') {
      assert.match(ctx.result.error, /network unreachable/);
    } else {
      throw new Error(`unknown reason label: ${reasonLabel}`);
    }
    assert.doesNotMatch(ctx.result.error, new RegExp(escapeRegExp(TOKEN)));
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.define(/^a project root whose topic map (.+)$/, (ctx, mapState) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1509-cli-'));
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => fs.rmSync(root, { recursive: true, force: true }));
    ctx.projectRoot = root;
    if (mapState === 'names the Concierge topic') {
      fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'), JSON.stringify({ '777': 'OPERATOR' }));
    } else if (mapState === 'has no Concierge topic yet') {
      // No topic map at all - readTopicMap degrades to {} on a missing file.
    } else {
      throw new Error(`unknown topic map state: ${mapState}`);
    }
  });

  registry.define(/^the front desk's credentials exported as TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID$/, (ctx) => {
    const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_NOTIFY_FORCE_RESULT'];
    ctx.__previousEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat';
    process.env.TELEGRAM_NOTIFY_FORCE_RESULT = JSON.stringify({ success: true });
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => {
      for (const [key, value] of Object.entries(ctx.__previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
  });

  registry.define(/^the send-document CLI runs with a file path$/, async (ctx) => {
    const filePath = path.join(ctx.projectRoot, 'report.md');
    fs.writeFileSync(filePath, '# report');
    ctx.outcome = await sendTelegramDocumentCore(ctx.projectRoot, filePath, undefined);
  });

  registry.define(/^the file is sent to that topic and the CLI exits 0$/, (ctx) => {
    assert.equal(ctx.outcome.success, true, ctx.outcome.reason);
  });

  registry.define(/^the CLI exits non-zero naming operator-topic-not-yet-created$/, (ctx) => {
    assert.equal(ctx.outcome.success, false);
    assert.equal(ctx.outcome.reason, 'operator-topic-not-yet-created');
  });
}

module.exports = { registerSteps };
