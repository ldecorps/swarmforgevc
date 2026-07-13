'use strict';

// BL-346: step handlers for "A standing Operator topic is the human's front
// door to the Operator". Drives the REAL ensureOperatorTopic/
// decideEnsureOperatorTopicAction/decideUpdateAction/resolveReplyTopicId
// (telegramFrontDeskBotCore.ts + telegram-front-desk-bot.ts, compiled) plus
// the REAL bridge (bridgeServer.ts's startBridge) and REAL operator_reply.bb
// CLI, mirroring telegramTopicThreadsSteps.js's own established pattern -
// no real Telegram network anywhere (createForumTopic is always given a
// fake postFn, same seam telegramClient.test.js itself uses).
//
// The reserved subject id (OPERATOR_SUBJECT_ID, a fixed exported constant,
// never a per-run random value) is what proves "stable" in scenarios 01/07
// - the SAME constant is bound every time the topic is (re)created, so
// there is nothing to compare against a stashed "before" value; being the
// literal same constant IS the stability guarantee, by construction.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { ensureOperatorTopic } = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
const { decideUpdateAction, subjectForTopic, topicForSubject, resolveReplyTopicId, OPERATOR_SUBJECT_ID } = require(
  path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore')
);

const OPERATOR_REPLY_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_reply.bb');
const REPLY_CONTEXT_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'telegram_reply_context_acceptance_runner.bb');

const BRIDGE_TOKEN = 'bl346-bridge-token';
const PRINCIPAL_ID = 111;
const BOT_TOKEN = 'fake-bot-token';
const CHAT_ID = 'fake-chat-id';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl346-acceptance-'));
}

function topicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

function readTopicMapFixture(root) {
  try {
    return JSON.parse(fs.readFileSync(topicMapPath(root), 'utf8'));
  } catch {
    return {};
  }
}

function writeTopicMapFixture(root, map) {
  fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
  fs.writeFileSync(topicMapPath(root), JSON.stringify(map));
}

// A fake createForumTopic postFn (mirrors telegramClient.test.js's own
// convention) - never a real network call. Returns a fresh topic id each
// time it's actually invoked; a scenario proving idempotency (06) wraps
// this to assert it is NEVER invoked a second time.
let nextFakeTopicId = 500;
function fakeCreatePost() {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    nextFakeTopicId += 1;
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: nextFakeTopicId, name: 'Operator' } } };
  };
  return { postFn, calls };
}

async function withBridge(root, fn) {
  const handle = await startBridge(root, path.join(root, 'runs.jsonl'), BRIDGE_TOKEN);
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

function controlAuthHeaders() {
  return { authorization: `Bearer ${BRIDGE_TOKEN}`, 'x-control-token': BRIDGE_TOKEN };
}

function postTelegramInbound(port, body) {
  return fetch(`http://127.0.0.1:${port}/telegram-inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...controlAuthHeaders() },
    body: JSON.stringify(body),
  });
}

async function postHumanMessage(root, text) {
  await withBridge(root, async (handle) => {
    const res = await postTelegramInbound(handle.port, { subjectId: OPERATOR_SUBJECT_ID, channel: 'telegram', text });
    assert.equal(res.status, 200, `expected the inbound POST to succeed, got status ${res.status}`);
  });
}

function replyAsOperator(root, text) {
  execFileSync('bb', [OPERATOR_REPLY_CLI, root, '--thread', OPERATOR_SUBJECT_ID, '--text', text], { encoding: 'utf8' });
}

function mkUpdateInTopic(topicId, text) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: topicId, text } };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a Telegram forum the swarm posts into$/, () => {
    // Narrative only - the real forum/bot process is BL-274/BL-281's own
    // established live infrastructure, not re-proven here.
  });
  registry.define(/^a restricted front-desk Operator that answers the human but cannot act on the swarm$/, () => {
    // Narrative only - BL-334's own boundary (--tools "") is proven by
    // restrictedFrontDeskOperatorSteps.js; this ticket must not widen it
    // and does not touch launch-front-desk-operator! at all.
  });

  // ── standing-operator-topic-01 ──────────────────────────────────────
  registry.define(/^no Operator topic has been created yet$/, (ctx) => {
    ctx.root = mkTmp(); // no telegram-topic-map.json at all yet
  });

  // ── standing-operator-topic-06/07 share this exact Given text with 01's
  //    own When below ("the front desk starts up") ─────────────────────
  registry.define(/^the front desk starts up$/, async (ctx) => {
    const { postFn } = fakeCreatePost();
    await ensureOperatorTopic(ctx.root, BOT_TOKEN, CHAT_ID, postFn);
    ctx.startupCreateCalls = (ctx.startupCreateCalls || 0) + 1;
  });

  // Dual role by design: as a GIVEN (scenarios 02-06's first step) it
  // builds a fresh fixture with the Operator topic already bound; as a
  // THEN (scenarios 01/07, after "the front desk starts up" already ran)
  // it only asserts. ctx.root existing already is what distinguishes the
  // two - never rebuilt out from under an already-running scenario.
  registry.define(/^the Operator topic exists$/, async (ctx) => {
    if (ctx.root === undefined) {
      ctx.root = mkTmp();
      const { postFn } = fakeCreatePost();
      await ensureOperatorTopic(ctx.root, BOT_TOKEN, CHAT_ID, postFn);
    }
    const map = readTopicMapFixture(ctx.root);
    ctx.topicId = topicForSubject(map, OPERATOR_SUBJECT_ID);
    assert.notEqual(ctx.topicId, undefined, `expected the Operator topic to exist (bound in the map), got: ${JSON.stringify(map)}`);
  });

  registry.define(/^it is bound to a stable reserved subject$/, (ctx) => {
    const map = readTopicMapFixture(ctx.root);
    assert.equal(map[String(ctx.topicId)], OPERATOR_SUBJECT_ID, `expected the fixed reserved subject id, got: ${JSON.stringify(map)}`);
  });

  // ── standing-operator-topic-02 / -05 (shared Given/When) ─────────────
  registry.define(/^the human posts a message in the Operator topic$/, (ctx) => {
    const update = mkUpdateInTopic(ctx.topicId, 'a question for the Operator');
    ctx.decision = decideUpdateAction(update, PRINCIPAL_ID, (topicId) => subjectForTopic(readTopicMapFixture(ctx.root), topicId));
  });

  registry.define(/^the restricted Operator receives it as a conversation message$/, (ctx) => {
    assert.deepEqual(
      { action: ctx.decision.action, subjectId: ctx.decision.subjectId },
      { action: 'post-existing', subjectId: OPERATOR_SUBJECT_ID },
      `expected the message to resolve as an ordinary post into the reserved subject, got: ${JSON.stringify(ctx.decision)}`
    );
  });

  registry.define(/^it is not filed as a new support issue$/, (ctx) => {
    assert.notEqual(ctx.decision.action, 'open-for-topic', 'expected no fresh SUP-### to be minted for an already-bound Operator topic');
    assert.notEqual(ctx.decision.action, 'open-default');
  });

  // ── standing-operator-topic-03 ────────────────────────────────────────
  registry.define(/^the human has posted a message in the Operator topic$/, async (ctx) => {
    await postHumanMessage(ctx.root, 'my PR is stuck');
  });

  registry.define(/^the Operator replies$/, (ctx) => {
    ctx.replyText = 'check the CI logs';
    replyAsOperator(ctx.root, ctx.replyText);
  });

  registry.define(/^the reply appears in the Operator topic$/, async (ctx) => {
    const map = readTopicMapFixture(ctx.root);
    const resolvedTopicId = resolveReplyTopicId(map, {}, OPERATOR_SUBJECT_ID);
    assert.equal(resolvedTopicId, ctx.topicId, `expected the reply to resolve back into the SAME Operator topic, got: ${resolvedTopicId}`);

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
      assert.ok(buffer.includes('event: telegram-reply'), `expected a telegram-reply SSE event, got: ${buffer}`);
      assert.ok(buffer.includes(OPERATOR_SUBJECT_ID) && buffer.includes(ctx.replyText), `expected the SSE event to carry the reserved subject id + reply text, got: ${buffer}`);
    });
  });

  // ── standing-operator-topic-04 ────────────────────────────────────────
  registry.define(/^the human has already exchanged messages with the Operator in that topic$/, async (ctx) => {
    ctx.firstQuestion = 'what is the swarm status right now';
    ctx.firstAnswer = 'everything is green, nothing stuck';
    await postHumanMessage(ctx.root, ctx.firstQuestion);
    replyAsOperator(ctx.root, ctx.firstAnswer);
  });

  registry.define(/^the human posts a follow-up that refers to the earlier exchange$/, async (ctx) => {
    ctx.followUp = 'and is that still true now';
    await postHumanMessage(ctx.root, ctx.followUp);
  });

  registry.define(/^the Operator's reply is informed by the earlier messages in that topic$/, (ctx) => {
    const out = execFileSync('bb', [REPLY_CONTEXT_RUNNER, ctx.root, OPERATOR_SUBJECT_ID], { encoding: 'utf8' });
    const transcript = JSON.stringify(JSON.parse(out));
    assert.ok(transcript.includes(ctx.firstQuestion), `expected the earlier question in the transcript, got: ${transcript}`);
    assert.ok(transcript.includes(ctx.firstAnswer), `expected the earlier answer in the transcript, got: ${transcript}`);
    assert.ok(transcript.includes(ctx.followUp), `expected the follow-up in the SAME transcript, got: ${transcript}`);
  });

  // ── standing-operator-topic-05 ────────────────────────────────────────
  registry.define(/^no new support issue is allocated for that topic$/, (ctx) => {
    assert.equal(ctx.decision.action, 'post-existing', `expected the ordinary post-existing routing, no new subject allocated, got: ${JSON.stringify(ctx.decision)}`);
  });

  // ── standing-operator-topic-06 ────────────────────────────────────────
  registry.define(/^the front desk starts up again$/, async (ctx) => {
    const calls = [];
    const postFn = async () => {
      calls.push(1);
      throw new Error('createForumTopic must never be called on a restart when the Operator topic is already bound');
    };
    await ensureOperatorTopic(ctx.root, BOT_TOKEN, CHAT_ID, postFn);
    ctx.secondStartupCreateCalls = calls.length;
  });

  registry.define(/^exactly one Operator topic exists$/, (ctx) => {
    assert.equal(ctx.secondStartupCreateCalls, 0, 'expected the second startup to never call createForumTopic again');
    const map = readTopicMapFixture(ctx.root);
    const boundTopicIds = Object.entries(map).filter(([, subjectId]) => subjectId === OPERATOR_SUBJECT_ID);
    assert.equal(boundTopicIds.length, 1, `expected exactly one topic bound to the reserved subject, got: ${JSON.stringify(map)}`);
  });

  // ── standing-operator-topic-07 ────────────────────────────────────────
  registry.define(/^the Operator topic is absent from the recorded topics$/, (ctx) => {
    ctx.root = mkTmp();
    // Other, unrelated topics are already recorded - proves this is a
    // targeted "this ONE reserved binding is missing" absence, not just
    // an empty/fresh map (standing-operator-topic-01's own case).
    writeTopicMapFixture(ctx.root, { '7': 'SUP-1', '8': 'SUP-2' });
  });

  registry.define(/^it is bound to the same stable reserved subject as before$/, (ctx) => {
    const map = readTopicMapFixture(ctx.root);
    assert.equal(map[String(ctx.topicId)], OPERATOR_SUBJECT_ID, `expected the SAME fixed reserved subject id as any other creation, got: ${JSON.stringify(map)}`);
    // The other, pre-existing recorded topics are untouched.
    assert.equal(map['7'], 'SUP-1');
    assert.equal(map['8'], 'SUP-2');
  });
}

module.exports = { registerSteps };
