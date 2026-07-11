'use strict';

// BL-294: step handlers for "Front Desk Bot opens a subject for DM and
// new-topic inbound". Drives the REAL compiled telegramFrontDeskBotCore.ts
// decideUpdateAction/subjectForTopic (pure) plus the REAL support_thread.bb
// open CLI (real fs, mirroring telegramTopicThreadsSteps.js's own openThread
// helper) for authoritative SUP-### id assignment - no live Telegram
// network, no bridge HTTP (out of this ticket's own scope).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { decideUpdateAction, subjectForTopic, DEFAULT_SUBJECT_KEY } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));

const SUPPORT_THREAD_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'support_thread.bb');
const PRINCIPAL_ID = 111;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-auto-open-subject-'));
}

function openThread(root, text) {
  const out = execFileSync('bb', [SUPPORT_THREAD_CLI, root, 'open', '--channel', 'telegram', '--text', text], { encoding: 'utf8' });
  return JSON.parse(out);
}

function mkUpdate({ fromId, topicId, text }) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: fromId }, message_thread_id: topicId, text } };
}

function topicMapKey(topicId) {
  return topicId === undefined ? DEFAULT_SUBJECT_KEY : String(topicId);
}

// Mirrors pollAndForward's own open-vs-post-existing-vs-drop handling
// (telegramFrontDeskBotCore.ts), but drives the REAL support_thread.bb CLI
// for an open instead of a fake adapter - the same authoritative id
// assignment the live bot uses.
function handleUpdate(ctx, update) {
  const decision = decideUpdateAction(update, PRINCIPAL_ID, (topicId) => subjectForTopic(ctx.topicMap, topicId));
  ctx.lastAction = decision.action;
  if (decision.action === 'post-existing') {
    ctx.lastSubjectId = decision.subjectId;
    return;
  }
  if (decision.action === 'drop') {
    ctx.lastSubjectId = null;
    return;
  }
  const topicId = decision.action === 'open-for-topic' ? decision.topicId : undefined;
  const thread = openThread(ctx.root, decision.text);
  ctx.topicMap[topicMapKey(topicId)] = thread.id;
  ctx.opens = (ctx.opens || 0) + 1;
  ctx.lastSubjectId = thread.id;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the headless Front Desk Bot polls Telegram for the principal's messages$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.topicMap = {};
    ctx.opens = 0;
  });

  // ── auto-open-01 ─────────────────────────────────────────────────────
  registry.define(/^a principal message in a private direct chat with no topic$/, (ctx) => {
    ctx.update = mkUpdate({ fromId: PRINCIPAL_ID, text: 'hello from a DM' });
  });

  registry.define(/^the bot handles it$/, (ctx) => {
    handleUpdate(ctx, ctx.update);
  });

  registry.define(/^it is recorded under a single default subject, not dropped$/, (ctx) => {
    if (ctx.lastAction === 'drop') {
      throw new Error('expected the DM message not to be dropped');
    }
    if (!/^SUP-\d+$/.test(ctx.lastSubjectId || '')) {
      throw new Error(`expected a real SUP-### subject id, got ${ctx.lastSubjectId}`);
    }
    if (ctx.topicMap[DEFAULT_SUBJECT_KEY] !== ctx.lastSubjectId) {
      throw new Error('expected the DM to be recorded under the reserved default-subject key');
    }
  });

  // ── auto-open-02 ─────────────────────────────────────────────────────
  registry.define(/^a principal message on a topic that has no subject mapped yet$/, (ctx) => {
    ctx.update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'new conversation' });
  });

  registry.define(/^a new subject is opened for that topic and the mapping is recorded$/, (ctx) => {
    if (ctx.lastAction !== 'open-for-topic') {
      throw new Error(`expected an open-for-topic decision, got ${ctx.lastAction}`);
    }
    if (ctx.topicMap['42'] !== ctx.lastSubjectId) {
      throw new Error('expected topic 42 to be recorded against the newly opened subject');
    }
  });

  // ── auto-open-03 ─────────────────────────────────────────────────────
  registry.define(/^a context already mapped to a subject$/, (ctx) => {
    ctx.mappedTopicId = 7;
    handleUpdate(ctx, mkUpdate({ fromId: PRINCIPAL_ID, topicId: ctx.mappedTopicId, text: 'opening message' }));
    ctx.opensBeforeReuse = ctx.opens;
    ctx.mappedSubjectId = ctx.lastSubjectId;
  });

  registry.define(/^the bot handles another message there$/, (ctx) => {
    handleUpdate(ctx, mkUpdate({ fromId: PRINCIPAL_ID, topicId: ctx.mappedTopicId, text: 'follow-up message' }));
  });

  registry.define(/^it goes to that same subject, without opening a second one$/, (ctx) => {
    if (ctx.lastAction !== 'post-existing') {
      throw new Error(`expected the follow-up to post to the existing subject, got ${ctx.lastAction}`);
    }
    if (ctx.lastSubjectId !== ctx.mappedSubjectId) {
      throw new Error(`expected the follow-up to land in ${ctx.mappedSubjectId}, got ${ctx.lastSubjectId}`);
    }
    if (ctx.opens !== ctx.opensBeforeReuse) {
      throw new Error(`expected no second subject to be opened, opens went from ${ctx.opensBeforeReuse} to ${ctx.opens}`);
    }
  });

  // ── auto-open-04 ─────────────────────────────────────────────────────
  registry.define(/^a message from a non-principal user$/, (ctx) => {
    ctx.opensBefore = ctx.opens;
    ctx.update = mkUpdate({ fromId: 999, topicId: 7, text: 'let me in' });
  });

  registry.define(/^it is dropped and opens no subject$/, (ctx) => {
    if (ctx.lastAction !== 'drop') {
      throw new Error(`expected the non-principal message to be dropped, got ${ctx.lastAction}`);
    }
    if (ctx.opens !== ctx.opensBefore) {
      throw new Error('expected no subject to be opened for a non-principal message');
    }
  });
}

module.exports = { registerSteps };
