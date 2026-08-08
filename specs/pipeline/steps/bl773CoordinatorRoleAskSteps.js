'use strict';

// BL-773: step handlers for "the coordinator raises a clarifying question
// through the shared role-ask path". role_ask.bb is already role-generic
// (BL-607 proved it for the specifier); this ticket is wiring, not a new
// mechanism, so these scenarios drive the REAL role_ask.bb CLI (the ask
// leg - writes the real per-role pending file and the real reply-outbox
// line) and the REAL compiled telegramFrontDeskBotCore relay/poll core
// (the delivery leg) against fake Telegram/network adapters, the same
// "drive the real core, fake only the Telegram + tmux boundary" posture
// bl607RoleClarifyingPollSteps.js already established - just parameterized
// on role "coordinator" instead of "specifier".
//
// Registered via defineScoped/FEATURE_NAME (mirroring bl607's own
// collision-avoidance): several step texts here are close enough to
// bl607's own wording that an unscoped registration could shadow it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { pollAndForward, relaySseReplies } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));
const ROLE_ASK_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'role_ask.bb');

const FEATURE_NAME = "The coordinator raises a clarifying question through the shared role-ask path";

// The live map's real coordinator entry (specifier's BL-773 measurement:
// role-topic-map.json already carries "coordinator":3901 - this ticket
// does not touch that map).
const COORDINATOR_TOPIC_ID = 3901;
const SPECIFIER_TOPIC_ID = 1595;
const PRINCIPAL_ID = 111;

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl773-'));
}

function runRoleAsk(root, role, question, options) {
  const args = [ROLE_ASK_CLI, root, '--role', role, '--question', question];
  if (options) {
    args.push('--options', JSON.stringify(options));
  }
  const out = execFileSync('bb', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

function pendingFilePath(root, role) {
  return path.join(root, '.swarmforge', 'operator', 'role-awaiting', `${role}.json`);
}

function readPending(root, role) {
  return JSON.parse(fs.readFileSync(pendingFilePath(root, role), 'utf8'));
}

function outboxPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
}

function readOutboxLastLine(root) {
  const lines = fs
    .readFileSync(outboxPath(root), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

function mkChunkReader(chunks) {
  let i = 0;
  return async () => (i < chunks.length ? { done: false, chunk: chunks[i++] } : { done: true, chunk: '' });
}

function mkTopicReplyUpdate(topicId, text) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: topicId, text } };
}

function relayAdapters(ctx, readChunk) {
  return {
    readChunk,
    sendReply: async (topicId, text) => {
      ctx.sentReplies.push({ topicId, text });
    },
    sendAskButtons: async (topicId, text, buttons) => {
      ctx.posted.push({ topicId, text, buttons });
      return { success: true, messageId: 900 };
    },
    recordAskMessage: async (threadId, topicId, messageId, text) => {
      ctx.recordedMessage = { threadId, topicId, messageId, text };
    },
    roleTopicIdFor: async (role) => (role === 'coordinator' ? COORDINATOR_TOPIC_ID : role === 'specifier' ? SPECIFIER_TOPIC_ID : undefined),
    agentQuestionsTopicId: async () => {
      ctx.agentQuestionsTopicCalled = true;
      return 42;
    },
    resolveDelivery: () => {
      throw new Error('resolveDelivery should never be consulted for a roleQuestion record');
    },
    ackReply: async () => {},
  };
}

async function relayRecord(ctx, record) {
  await relaySseReplies('', relayAdapters(ctx, mkChunkReader([`event: telegram-reply\ndata: ${JSON.stringify(record)}\n\n`])), new Set());
}

function pollAnswerAdapters(ctx, updates) {
  return {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates }),
    postToBridge: async () => {
      throw new Error('postToBridge should never be called for a role question - there is no SUP-### thread on the other end');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a role-topic message');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    readRoleTopicMap: () => ({ coordinator: COORDINATOR_TOPIC_ID, specifier: SPECIFIER_TOPIC_ID }),
    // The coordinator holds a standing tmux session (BL-107) - never
    // dormant - so its answer always resolves through the live-pane leg,
    // per this ticket's own notes ("not affected by BL-846").
    redirectToRole: async (role, text) => {
      ctx.redirected.push({ role, text });
      return { kind: 'delivered' };
    },
    getRolePendingQuestion: async (role) => role === 'coordinator',
    clearRolePendingQuestion: async (role) => {
      ctx.clearedRoles.push(role);
    },
    enqueueRoleAnswerNote: async (role, text) => {
      ctx.queuedNotes.push({ role, text });
      return true;
    },
    answerCallbackQuery: async () => {},
    resolveAskOptions: async () => undefined,
  };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the swarm is running and the coordinator holds a decision it cannot resolve alone$/,
    (ctx) => {
      ctx.root = mkTmpRoot();
      ctx.posted = [];
      ctx.sentReplies = [];
      ctx.recordedMessage = undefined;
      ctx.redirected = [];
      ctx.queuedNotes = [];
      ctx.clearedRoles = [];
      ctx.agentQuestionsTopicCalled = false;
    },
    FEATURE_NAME
  );

  // ── coordinator-role-ask-01 / -02: raising a question ──────────────
  // Shared across scenarios 1, 2, and the coordinator-holder example of
  // scenario 4 (identical step text in all three).
  registry.defineScoped(
    /^the coordinator raises an (optioned|open) clarifying question$/,
    async (ctx, kind) => {
      const question = kind === 'optioned' ? 'which environment?' : 'what should I try next?';
      const options = kind === 'optioned' ? ['staging', 'prod'] : undefined;
      ctx.lastAskQuestion = question;
      ctx.lastAskResult = runRoleAsk(ctx.root, 'coordinator', question, options);
      // A refused ask (already-pending) writes neither an outbox line nor
      // an awaiting-file update - nothing further to relay in that case;
      // scenario 4's own Then steps check the refusal and the untouched
      // prior pending record instead.
      if (ctx.lastAskResult.asked) {
        ctx.outboxRecord = readOutboxLastLine(ctx.root);
        await relayRecord(ctx, ctx.outboxRecord);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the pending-question record for role coordinator names that question$/,
    (ctx) => {
      const pending = readPending(ctx.root, 'coordinator');
      if (pending.question !== ctx.lastAskQuestion) {
        throw new Error(`expected the pending record to name "${ctx.lastAskQuestion}", got ${JSON.stringify(pending)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is published to the coordinator's own topic offering one tappable button per option$/,
    (ctx) => {
      const post = ctx.posted.find((p) => p.topicId === COORDINATOR_TOPIC_ID);
      if (!post) {
        throw new Error(`expected a button post to the coordinator's own topic (${COORDINATOR_TOPIC_ID}), got: ${JSON.stringify(ctx.posted)}`);
      }
      if (post.buttons.length !== 2 || post.buttons.some((row) => row.length !== 1)) {
        throw new Error(`expected one tappable button per option, got: ${JSON.stringify(post.buttons)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is published to the coordinator's own topic offering a free-text reply prompt$/,
    (ctx) => {
      const post = ctx.sentReplies.find((p) => p.topicId === COORDINATOR_TOPIC_ID);
      if (!post) {
        throw new Error(`expected a free-text prompt posted to the coordinator's own topic (${COORDINATOR_TOPIC_ID}), got: ${JSON.stringify(ctx.sentReplies)}`);
      }
      if (ctx.posted.some((p) => p.topicId === COORDINATOR_TOPIC_ID)) {
        throw new Error('expected no button post for an open (option-less) question');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the coordinator ends its turn without waiting for an answer$/,
    (ctx) => {
      if (ctx.lastAskResult.asked !== true) {
        throw new Error(`expected the ask to succeed and return immediately, got ${JSON.stringify(ctx.lastAskResult)}`);
      }
      // The CLI already returned; if an answer somehow existed already the
      // ask could not have been the thing waiting for it.
      const answerPath = path.join(ctx.root, '.swarmforge', 'operator', 'role-answers', 'coordinator.json');
      if (fs.existsSync(answerPath)) {
        throw new Error('expected no answer to exist yet at the moment the ask returns - it must not have blocked waiting for one');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it does not poll for the answer$/,
    () => {
      // Matches actual Clojure loop/sleep FORMS (leading paren or the
      // Thread/sleep call), never plain English prose - role_ask.bb's own
      // doc comments legitimately use the word "while".
      const src = fs.readFileSync(ROLE_ASK_CLI, 'utf8');
      if (/\((?:while|loop)\b|Thread\/sleep/.test(src)) {
        throw new Error('expected role_ask.bb to contain no polling/sleep/wait loop form - it must ask once and return');
      }
    },
    FEATURE_NAME
  );

  // ── coordinator-role-ask-03: the answer comes back ─────────────────
  // Also serves scenario 4's holder="the coordinator" example (identical
  // Given text).
  registry.defineScoped(
    /^the coordinator already has a clarifying question pending$/,
    (ctx) => {
      ctx.pendingQuestion = 'what should I try next?';
      ctx.pendingAskResult = runRoleAsk(ctx.root, 'coordinator', ctx.pendingQuestion);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the human answers it$/,
    async (ctx) => {
      ctx.answerText = 'try staging first';
      await pollAndForward(0, PRINCIPAL_ID, pollAnswerAdapters(ctx, [mkTopicReplyUpdate(COORDINATOR_TOPIC_ID, ctx.answerText)]));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the answer is recorded for role coordinator$/,
    (ctx) => {
      if (!ctx.clearedRoles.includes('coordinator')) {
        throw new Error(`expected the coordinator's pending question recorded/cleared as answered, got: ${JSON.stringify(ctx.clearedRoles)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the coordinator receives a note telling it the answer is ready$/,
    (ctx) => {
      if (!ctx.redirected.some((r) => r.role === 'coordinator' && r.text === ctx.answerText)) {
        throw new Error(`expected the answer delivered into the coordinator's own live pane, got: ${JSON.stringify(ctx.redirected)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no second answer channel is written$/,
    (ctx) => {
      if (ctx.queuedNotes.length !== 0) {
        throw new Error(`expected no queued-note channel used alongside the live-pane delivery (invariant: answerable in exactly one place), got: ${JSON.stringify(ctx.queuedNotes)}`);
      }
    },
    FEATURE_NAME
  );

  // ── coordinator-role-ask-04: the one-pending guard is per role ─────
  registry.defineScoped(
    /^the specifier already has a clarifying question pending$/,
    (ctx) => {
      ctx.specifierPendingQuestion = 'which environment?';
      ctx.specifierAskResult = runRoleAsk(ctx.root, 'specifier', ctx.specifierPendingQuestion);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the coordinator's question is accepted$/,
    (ctx) => {
      if (ctx.lastAskResult.asked !== true) {
        throw new Error(`expected the coordinator's question accepted despite a different role's pending question, got: ${JSON.stringify(ctx.lastAskResult)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the coordinator's question is refused as already-pending$/,
    (ctx) => {
      if (ctx.lastAskResult.asked !== false || ctx.lastAskResult.reason !== 'already-pending') {
        throw new Error(`expected the coordinator's second question refused as already-pending, got: ${JSON.stringify(ctx.lastAskResult)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the question pending for the specifier is untouched$/,
    (ctx) => {
      const pending = readPending(ctx.root, 'specifier');
      if (pending.question !== ctx.specifierPendingQuestion) {
        throw new Error(`expected the specifier's own pending question untouched by the coordinator's ask, got: ${JSON.stringify(pending)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the question pending for the coordinator is untouched$/,
    (ctx) => {
      const pending = readPending(ctx.root, 'coordinator');
      if (pending.question !== ctx.pendingQuestion) {
        throw new Error(`expected the coordinator's own first pending question untouched by its own refused second ask, got: ${JSON.stringify(pending)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
