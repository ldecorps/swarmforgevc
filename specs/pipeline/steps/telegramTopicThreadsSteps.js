'use strict';

// BL-281 (reshaped 2026-07-11, bridge-client architecture): step handlers
// for "Telegram front-desk Talk MVP over the bridge". Drives the REAL
// compiled bridgeServer.ts (via startBridge, mirroring gatesListSteps.js's
// own pattern), the REAL operator_reply.bb + support_thread.bb CLIs (real
// fs, mirroring costHealthSidecarHeadlessSteps.js's own bb-shell pattern),
// telegram_topic_lib.bb's reply-context-for against real fixture files,
// and the REAL telegramFrontDeskBotCore.ts pure decision logic - no real
// Telegram network, no real timers.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { sendTelegramMessage } = require(path.join(EXT_DIR, 'out', 'notify', 'telegramClient'));
const { decideUpdateAction, topicForSubject } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));

const SUPPORT_THREAD_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'support_thread.bb');
const OPERATOR_REPLY_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_reply.bb');
const REPLY_CONTEXT_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'telegram_reply_context_acceptance_runner.bb');

const BRIDGE_TOKEN = 'aps-telegram-bridge-token';
const PRINCIPAL_ID = 111;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-telegram-topic-'));
}

function openThread(root, text) {
  const out = execFileSync('bb', [SUPPORT_THREAD_CLI, root, 'open', '--channel', 'telegram', '--text', text], { encoding: 'utf8' });
  return JSON.parse(out);
}

async function withBridge(target, fn) {
  const handle = await startBridge(target, path.join(target, 'runs.jsonl'), BRIDGE_TOKEN);
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

function postTelegramInbound(port, headers, body) {
  return fetch(`http://127.0.0.1:${port}/telegram-inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function controlAuthHeaders() {
  return { authorization: `Bearer ${BRIDGE_TOKEN}`, 'x-control-token': BRIDGE_TOKEN };
}

function readEvents(root) {
  const file = path.join(root, '.swarmforge', 'operator', 'events.jsonl');
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the front desk runs as a Telegram bot that is a client of the bridge$/, () => {
    // Documents the framing; each scenario's own Given builds its fixture.
  });

  // ── telegram-topic-01 ────────────────────────────────────────────────
  registry.define(/^an inbound Telegram message on a topic mapped to a SUP-###$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.thread = openThread(ctx.root, 'need help with billing');
    ctx.text = 'any update?';
  });

  registry.define(/^the Front Desk Bot posts it to the bridge inbound-message route$/, async (ctx) => {
    await withBridge(ctx.root, async (handle) => {
      ctx.postResult = await postTelegramInbound(handle.port, controlAuthHeaders(), {
        subjectId: ctx.thread.id,
        channel: 'telegram',
        text: ctx.text,
      });
      ctx.postStatus = ctx.postResult.status;
    });
  });

  registry.define(/^the bridge ingests it and enqueues a per-SUP-### event$/, (ctx) => {
    if (ctx.postStatus !== 200) {
      throw new Error(`expected the POST to succeed, got status ${ctx.postStatus}`);
    }
    const threadFile = path.join(ctx.root, '.swarmforge', 'support', 'threads', `${ctx.thread.id}.json`);
    const thread = JSON.parse(fs.readFileSync(threadFile, 'utf8'));
    const last = thread.messages[thread.messages.length - 1];
    if (last.text !== ctx.text) {
      throw new Error(`expected the message appended to the transcript, got: ${JSON.stringify(thread)}`);
    }
    const events = readEvents(ctx.root);
    if (!events.some((e) => e.type === 'TELEGRAM_TOPIC_MESSAGE' && e.subject === ctx.thread.id)) {
      throw new Error(`expected a per-SUP-### event enqueued, got: ${JSON.stringify(events)}`);
    }
  });

  // ── telegram-topic-02 ────────────────────────────────────────────────
  registry.define(/^an unauthorized request to the bridge inbound-message route$/, (ctx) => {
    ctx.root = mkTmp();
  });

  registry.define(/^the bridge receives it$/, async (ctx) => {
    await withBridge(ctx.root, async (handle) => {
      const res = await postTelegramInbound(handle.port, {}, { subjectId: 'SUP-1', channel: 'telegram', text: 'hi' });
      // "the request is rejected" is ALSO registered by burnRateSteps.js
      // with the SAME wording (BL-273) - the registry's first-registered
      // handler wins for an identical step text (this project's own
      // convention, see the Gherkin step registry lesson), and that
      // handler reads ctx.status - write the SAME field here rather than
      // adding a second, dead definition of "the request is rejected".
      ctx.status = res.status;
    });
  });

  // ── telegram-topic-03 ────────────────────────────────────────────────
  registry.define(/^the disposable Operator is woken for a SUP-### with prior messages in its transcript$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.thread = openThread(ctx.root, 'my PR is stuck');
    ctx.topicMap = { 42: ctx.thread.id };
  });

  registry.define(/^it handles the wake and writes a reply$/, async (ctx) => {
    ctx.replyText = 'check the CI logs';
    execFileSync('bb', [OPERATOR_REPLY_CLI, ctx.root, '--thread', ctx.thread.id, '--text', ctx.replyText], { encoding: 'utf8' });

    // Prove the SSE relay against the REAL bridge (telegram-topic-03's own
    // "flows out over the bridge SSE stream" wording).
    await withBridge(ctx.root, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/events`, { headers: { authorization: `Bearer ${BRIDGE_TOKEN}` } });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let attempts = 0;
      while (!buffer.includes('event: telegram-reply') && attempts < 10) {
        buffer += decoder.decode((await reader.read()).value);
        attempts += 1;
      }
      ctx.sseBuffer = buffer;
    });
  });

  registry.define(/^the reply flows out over the bridge SSE stream to the bot$/, (ctx) => {
    if (!ctx.sseBuffer || !ctx.sseBuffer.includes('event: telegram-reply')) {
      throw new Error(`expected a telegram-reply SSE event, got: ${ctx.sseBuffer}`);
    }
    if (!ctx.sseBuffer.includes(ctx.thread.id) || !ctx.sseBuffer.includes(ctx.replyText)) {
      throw new Error(`expected the SSE event to carry the thread id + reply text, got: ${ctx.sseBuffer}`);
    }
  });

  registry.define(/^the bot posts it into that subject's topic$/, async (ctx) => {
    const topicId = topicForSubject(ctx.topicMap, ctx.thread.id);
    if (topicId === undefined) {
      throw new Error(`expected the bot to resolve a topic for ${ctx.thread.id}, got: ${JSON.stringify(ctx.topicMap)}`);
    }
    let capturedBody = null;
    const fakePost = async (url, body) => {
      capturedBody = body;
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 1 } } };
    };
    await sendTelegramMessage('fake-token', 'fake-chat', ctx.replyText, undefined, fakePost, topicId);
    const parsed = JSON.parse(capturedBody);
    if (parsed.message_thread_id !== topicId || parsed.text !== ctx.replyText) {
      throw new Error(`expected the bot to post into topic ${topicId} with the reply text, got: ${capturedBody}`);
    }
  });

  // ── telegram-topic-04 ────────────────────────────────────────────────
  registry.define(/^two subjects each on their own topic$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.subjectA = openThread(ctx.root, 'about A');
    ctx.subjectB = openThread(ctx.root, 'about B');
  });

  registry.define(/^the Operator handles an event for one subject$/, (ctx) => {
    const out = execFileSync('bb', [REPLY_CONTEXT_RUNNER, ctx.root, ctx.subjectA.id], { encoding: 'utf8' });
    ctx.replyContext = JSON.parse(out);
  });

  registry.define(/^it sees only that subject's transcript, never the other subject's$/, (ctx) => {
    const text = JSON.stringify(ctx.replyContext);
    if (!text.includes('about A')) {
      throw new Error(`expected subject A's own transcript, got: ${text}`);
    }
    if (text.includes('about B')) {
      throw new Error(`expected NO trace of subject B's transcript, got: ${text}`);
    }
  });

  // ── telegram-topic-05 ────────────────────────────────────────────────
  registry.define(/^a Telegram message from a user who is not the principal$/, (ctx) => {
    ctx.update = { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: 999 }, message_thread_id: 42, text: 'let me in' } };
    ctx.topicMap = { 42: 'SUP-1' };
  });

  registry.define(/^the Front Desk Bot processes updates$/, (ctx) => {
    ctx.decision = decideUpdateAction(ctx.update, PRINCIPAL_ID, (topicId) => ctx.topicMap[String(topicId)]);
  });

  registry.define(/^the message is not posted to the bridge$/, (ctx) => {
    if (ctx.decision.action !== 'drop' || ctx.decision.reason !== 'not-principal') {
      throw new Error(`expected the update to be dropped as not-principal, got: ${JSON.stringify(ctx.decision)}`);
    }
  });
}

module.exports = { registerSteps };
