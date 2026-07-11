'use strict';

// BL-298: step handlers for "Human replies in a BL-### topic reach the
// Operator as that task's context". Drives the REAL compiled
// decideUpdateAction/subjectForTopic (telegramFrontDeskBotCore.ts) and
// backlogForTopic (topicRouter.ts) directly against fixture maps - no live
// Telegram, no network, mirroring frontDeskAutoOpenSubjectSteps.js's own
// "handleUpdate dispatches on the real decision" pattern.
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { decideUpdateAction, subjectForTopic } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { backlogForTopic } = require(path.join(EXT_DIR, 'out', 'concierge', 'topicRouter'));

const PRINCIPAL_ID = 111;
const TOPIC_ID = 42;

function mkUpdate({ fromId, topicId, text }) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: fromId }, message_thread_id: topicId, text } };
}

// Mirrors pollAndForward's own post-existing/operator-context/drop
// dispatch (telegramFrontDeskBotCore.ts's processUpdate), against fake
// capture arrays instead of real adapters.
function routeReply(ctx) {
  const decision = decideUpdateAction(
    ctx.update,
    PRINCIPAL_ID,
    (topicId) => subjectForTopic(ctx.subjectMap, topicId),
    (topicId) => backlogForTopic(ctx.backlogTopicMap, topicId)
  );
  ctx.lastAction = decision.action;
  if (decision.action === 'post-existing') {
    ctx.threadPosts.push({ subjectId: decision.subjectId, text: decision.text });
  } else if (decision.action === 'operator-context') {
    ctx.operatorContexts.push({ backlogId: decision.backlogId, text: decision.text });
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a principal reply arrives in a Telegram topic that the Concierge must route$/, (ctx) => {
    ctx.subjectMap = {};
    ctx.backlogTopicMap = {};
    ctx.operatorContexts = [];
    ctx.threadPosts = [];
    ctx.update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: TOPIC_ID, text: 'progress update' });
  });

  // ── topic-reply-01 ───────────────────────────────────────────────────
  registry.define(/^the topic maps to a backlog item$/, (ctx) => {
    ctx.backlogTopicMap = { 'BL-123': TOPIC_ID };
  });

  registry.define(/^the Concierge routes the reply$/, (ctx) => {
    routeReply(ctx);
  });

  registry.define(/^it reaches the Operator as context for that backlog item$/, (ctx) => {
    if (ctx.operatorContexts.length !== 1 || ctx.operatorContexts[0].backlogId !== 'BL-123') {
      throw new Error(`expected exactly one operator-context reply for BL-123, got ${JSON.stringify(ctx.operatorContexts)}`);
    }
  });

  registry.define(/^it does not touch any support discussion thread$/, (ctx) => {
    if (ctx.threadPosts.length !== 0) {
      throw new Error(`expected no support thread post, got ${JSON.stringify(ctx.threadPosts)}`);
    }
  });

  // ── topic-reply-02 ───────────────────────────────────────────────────
  registry.define(/^the topic maps to a support subject$/, (ctx) => {
    ctx.subjectMap = { [String(TOPIC_ID)]: 'SUP-1' };
  });

  registry.define(/^it is appended to that support subject's thread$/, (ctx) => {
    if (ctx.threadPosts.length !== 1 || ctx.threadPosts[0].subjectId !== 'SUP-1') {
      throw new Error(`expected exactly one post into SUP-1, got ${JSON.stringify(ctx.threadPosts)}`);
    }
    if (ctx.operatorContexts.length !== 0) {
      throw new Error(`expected no operator-context routing for a support-subject topic, got ${JSON.stringify(ctx.operatorContexts)}`);
    }
  });

  // ── topic-reply-03 ───────────────────────────────────────────────────
  registry.define(/^the reply is from a non-principal user$/, (ctx) => {
    ctx.backlogTopicMap = { 'BL-123': TOPIC_ID };
    ctx.update = mkUpdate({ fromId: 999, topicId: TOPIC_ID, text: 'let me in' });
  });

  registry.define(/^it is dropped and reaches neither the Operator nor a thread$/, (ctx) => {
    if (ctx.lastAction !== 'drop') {
      throw new Error(`expected the reply to be dropped, got ${ctx.lastAction}`);
    }
    if (ctx.operatorContexts.length !== 0 || ctx.threadPosts.length !== 0) {
      throw new Error(`expected neither an operator-context nor a thread post, got ${JSON.stringify({ operatorContexts: ctx.operatorContexts, threadPosts: ctx.threadPosts })}`);
    }
  });
}

module.exports = { registerSteps };
