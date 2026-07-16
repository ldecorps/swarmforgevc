'use strict';

// BL-466: step handlers for "An agent's clarifying question surfaces
// directly on Telegram, as a native poll when the options are discrete".
// Combines the REAL operator_ask.bb CLI (Babashka) - which appends the
// question, marked agentQuestion, to the SAME reply outbox every other
// Operator reply uses - with the REAL compiled telegramFrontDeskBotCore.ts
// (relaySseReplies for the OUTBOUND poll/message send, pollAndForward for
// the INBOUND poll-vote/plain-reply answer return), and the REAL
// operator_runtime.bb --tick-once to prove the returned answer actually
// pairs with and clears the pending awaiting-answer state (BL-325's
// existing answer-return machinery - never a parallel path). No live
// Telegram/network anywhere: sendPoll/sendReply/postToBridge are the only
// faked ports, mirroring replyReturnsToAskingThreadSteps.js's own posture.
// postToBridge's fake reproduces exactly what the real bridge's
// /telegram-inbound route does (append to the SUP thread + enqueue a
// TELEGRAM_TOPIC_MESSAGE event) so the REAL operator_runtime.bb tick below
// pairs the answer exactly as production would - never a shortcut that
// skips proving the unblock.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const OPERATOR_ASK_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_ask.bb');
const OPERATOR_RUNTIME_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');
const { relaySseReplies, pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));

const THREAD_ID = 'SUP-1';
const AGENT_QUESTIONS_TOPIC_ID = 42;
const PRINCIPAL_ID = 111;
const QUESTION = 'which environment?';
const OPTIONS = ['staging', 'prod'];

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-agent-question-poll-'));
}

function opPath(root, ...rest) {
  return path.join(root, '.swarmforge', 'operator', ...rest);
}

function threadPath(root, threadId) {
  return path.join(root, '.swarmforge', 'support', 'threads', `${threadId}.json`);
}

function writeThreadMessage(root, threadId, channel, text, timestamp) {
  const p = threadPath(root, threadId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const thread = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { id: threadId, status: 'open', messages: [] };
  thread.messages.push({ channel, timestamp, text });
  fs.writeFileSync(p, JSON.stringify(thread));
}

function ask(root, threadId, question, options) {
  const args = [OPERATOR_ASK_CLI, root, '--thread', threadId, '--question', question];
  if (options) {
    args.push('--options', JSON.stringify(options));
  }
  const out = execFileSync('bb', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

function readOutboxLines(root) {
  try {
    return fs
      .readFileSync(opPath(root, 'telegram-reply-outbox.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function awaitingAnswerPath(root) {
  return opPath(root, 'awaiting-answer.json');
}

function readAwaitingAnswer(root) {
  try {
    return JSON.parse(fs.readFileSync(awaitingAnswerPath(root), 'utf8'));
  } catch {
    return null;
  }
}

function writeEvents(root, events) {
  fs.mkdirSync(opPath(root), { recursive: true });
  fs.writeFileSync(opPath(root, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function tickOnce(root, env = {}) {
  fs.mkdirSync(opPath(root), { recursive: true });
  fs.writeFileSync(opPath(root, 'last-swarm-check'), String(Date.now()));
  const out = execFileSync('bb', [OPERATOR_RUNTIME_BB, root, '--tick-once'], {
    encoding: 'utf8',
    env: { ...process.env, OPERATOR_SKIP_LAUNCH: '1', ...env },
  });
  return JSON.parse(out);
}

function readReplyContext(root) {
  return JSON.parse(fs.readFileSync(opPath(root, 'telegram-reply-context.json'), 'utf8'));
}

// Relays the LAST reply-outbox entry (the agent's own question) through the
// REAL relaySseReplies - the outbound half of the round trip. resolveDelivery
// must never be consulted for an agentQuestion record (deliverAgentQuestion's
// own routing exception) - asserted here by throwing if it ever is.
async function surfaceLastQuestion(ctx) {
  const lines = readOutboxLines(ctx.root);
  const entry = lines[lines.length - 1];
  ctx.polled = [];
  ctx.sentReplies = [];
  ctx.pollMapping = null;
  let readCount = 0;
  await relaySseReplies(
    `event: telegram-reply\ndata: ${JSON.stringify({ id: 'r1', ...entry })}\n\n`,
    {
      readChunk: async () => {
        readCount += 1;
        return { done: readCount > 1, chunk: '' };
      },
      sendReply: async (topicId, text) => {
        ctx.sentReplies.push({ topicId, text });
      },
      sendPoll: async (topicId, question, options) => {
        ctx.polled.push({ topicId, question, options });
        return { pollId: 'poll-1' };
      },
      recordPollMapping: async (pollId, threadId, options) => {
        ctx.pollMapping = { pollId, threadId, options };
      },
      agentQuestionsTopicId: async () => AGENT_QUESTIONS_TOPIC_ID,
      resolveDelivery: () => {
        throw new Error('resolveDelivery must never be consulted for an agentQuestion record');
      },
      ackReply: async () => {},
    },
    new Set()
  );
}

function registerSteps(registry) {
  // ── shared Givens ─────────────────────────────────────────────────────
  registry.define(/^the specifier asks a question with two or more discrete options$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.askResult = ask(ctx.root, THREAD_ID, QUESTION, OPTIONS);
    if (ctx.askResult.asked !== true) {
      throw new Error(`expected the ask to succeed, got ${JSON.stringify(ctx.askResult)}`);
    }
  });

  registry.define(/^the specifier asks a question with no discrete options$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.askResult = ask(ctx.root, THREAD_ID, QUESTION);
    if (ctx.askResult.asked !== true) {
      throw new Error(`expected the ask to succeed, got ${JSON.stringify(ctx.askResult)}`);
    }
  });

  // Needs both the ask AND the outbound relay to have already happened (so
  // a pollId is on record before a vote can be simulated) - composes the
  // discrete-options Given above rather than duplicating it.
  registry.define(/^a question surfaced as a Telegram poll$/, async (ctx) => {
    ctx.root = mkTmp();
    ctx.askResult = ask(ctx.root, THREAD_ID, QUESTION, OPTIONS);
    await surfaceLastQuestion(ctx);
    if (!ctx.pollMapping) {
      throw new Error('expected the poll surfaced with its mapping recorded before a vote can be simulated');
    }
  });

  registry.define(/^a question surfaced to the human that goes unanswered past the await window$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.askResult = ask(ctx.root, THREAD_ID, QUESTION, OPTIONS);
  });

  // ── shared When: "the question is surfaced to the human" (01/03) ─────
  registry.define(/^the question is surfaced to the human$/, async (ctx) => {
    await surfaceLastQuestion(ctx);
  });

  // ── agent-question-poll-01 Then/And ──────────────────────────────────
  registry.define(/^it is posted as a native Telegram poll in the agent-questions topic$/, (ctx) => {
    if (ctx.polled.length !== 1) {
      throw new Error(`expected exactly one native poll sent, got: ${JSON.stringify(ctx.polled)}`);
    }
    if (ctx.polled[0].topicId !== AGENT_QUESTIONS_TOPIC_ID) {
      throw new Error(`expected the poll sent into the Agent Questions topic (${AGENT_QUESTIONS_TOPIC_ID}), got topicId=${ctx.polled[0].topicId}`);
    }
    if (ctx.sentReplies.length !== 0) {
      throw new Error(`expected NO plain message sent alongside a poll, got: ${JSON.stringify(ctx.sentReplies)}`);
    }
  });

  registry.define(/^the poll options are the question's options$/, (ctx) => {
    if (JSON.stringify(ctx.polled[0].options) !== JSON.stringify(OPTIONS)) {
      throw new Error(`expected the poll's own options, got: ${JSON.stringify(ctx.polled[0].options)}`);
    }
  });

  // ── agent-question-poll-02 When/Then/And ─────────────────────────────
  registry.define(/^the human selects an option$/, async (ctx) => {
    const selectedIndex = 1; // "prod"
    ctx.selectedOptionText = OPTIONS[selectedIndex];
    ctx.posted = [];
    await pollAndForward(0, PRINCIPAL_ID, {
      chatId: '1',
      getUpdates: async () => ({
        success: true,
        updates: [{ update_id: 1, poll_answer: { poll_id: ctx.pollMapping.pollId, option_ids: [selectedIndex], user: { id: PRINCIPAL_ID } } }],
      }),
      resolvePollThread: async (pollId) =>
        pollId === ctx.pollMapping.pollId ? { threadId: ctx.pollMapping.threadId, options: ctx.pollMapping.options } : undefined,
      postToBridge: async (subjectId, text, updateId) => {
        ctx.posted.push({ subjectId, text, updateId });
        // Reproduces the real bridge's own /telegram-inbound effect (append
        // to the SUP thread + enqueue TELEGRAM_TOPIC_MESSAGE) - no live
        // bridge server in this acceptance run.
        writeThreadMessage(ctx.root, subjectId, 'telegram', text, '2026-07-16T09:05:00Z');
        writeEvents(ctx.root, [{ type: 'TELEGRAM_TOPIC_MESSAGE', subject: subjectId }]);
        return true;
      },
    });
  });

  registry.define(/^the selected option is returned to the asking agent as the answer$/, (ctx) => {
    if (ctx.posted.length !== 1 || ctx.posted[0].text !== ctx.selectedOptionText) {
      throw new Error(`expected the selected option's text delivered as the answer, got: ${JSON.stringify(ctx.posted)}`);
    }
    ctx.tickResult = tickOnce(ctx.root);
    const replyContext = readReplyContext(ctx.root);
    if (replyContext.answer !== ctx.selectedOptionText) {
      throw new Error(`expected the reply-context's answer to be the selected option's text, got: ${JSON.stringify(replyContext)}`);
    }
  });

  registry.define(/^the agent is unblocked$/, (ctx) => {
    if (fs.existsSync(awaitingAnswerPath(ctx.root))) {
      throw new Error('expected awaiting-answer.json to be cleared once the poll answer is delivered - the agent must be unblocked');
    }
  });

  // ── agent-question-poll-03 Then/And ──────────────────────────────────
  registry.define(/^it is posted as a plain message in the agent-questions topic, not a poll$/, (ctx) => {
    if (ctx.sentReplies.length !== 1 || ctx.sentReplies[0].topicId !== AGENT_QUESTIONS_TOPIC_ID) {
      throw new Error(`expected exactly one plain message sent into the Agent Questions topic, got: ${JSON.stringify(ctx.sentReplies)}`);
    }
    if (ctx.polled.length !== 0) {
      throw new Error(`expected NO poll sent for an open-ended question, got: ${JSON.stringify(ctx.polled)}`);
    }
  });

  registry.define(/^the human's in-thread reply is returned to the asking agent as the answer$/, async (ctx) => {
    ctx.posted = [];
    await pollAndForward(0, PRINCIPAL_ID, {
      chatId: '1',
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 2,
            message: { message_id: 2, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: AGENT_QUESTIONS_TOPIC_ID, text: 'staging' },
          },
        ],
      }),
      agentQuestionsTopicId: async () => AGENT_QUESTIONS_TOPIC_ID,
      getPendingAgentQuestionThread: async () => readAwaitingAnswer(ctx.root)?.thread_id,
      postToBridge: async (subjectId, text, updateId) => {
        ctx.posted.push({ subjectId, text, updateId });
        writeThreadMessage(ctx.root, subjectId, 'telegram', text, '2026-07-16T09:05:00Z');
        writeEvents(ctx.root, [{ type: 'TELEGRAM_TOPIC_MESSAGE', subject: subjectId }]);
        return true;
      },
    });
    if (ctx.posted.length !== 1 || ctx.posted[0].text !== 'staging') {
      throw new Error(`expected the in-thread reply text delivered as the answer, got: ${JSON.stringify(ctx.posted)}`);
    }
    ctx.tickResult = tickOnce(ctx.root);
    const replyContext = readReplyContext(ctx.root);
    if (replyContext.answer !== 'staging') {
      throw new Error(`expected the reply-context's answer to be the human's own reply text, got: ${JSON.stringify(replyContext)}`);
    }
    if (fs.existsSync(awaitingAnswerPath(ctx.root))) {
      throw new Error('expected awaiting-answer.json to be cleared once the plain-message reply is delivered');
    }
  });

  // ── agent-question-poll-04 When/Then ─────────────────────────────────
  registry.define(/^the await window elapses$/, (ctx) => {
    // Forces the recorded asked_at_ms to the epoch so a tiny timeout fires
    // immediately, mirroring operator-ask-03's own OPERATOR_AWAIT_TIMEOUT_MS
    // seam (operatorAskAwaitSteps.js) - the real wall-clock wait is never
    // exercised in a fast test.
    const awaiting = readAwaitingAnswer(ctx.root);
    fs.writeFileSync(awaitingAnswerPath(ctx.root), JSON.stringify({ ...awaiting, asked_at_ms: 0 }));
    ctx.tickResult = tickOnce(ctx.root, { OPERATOR_AWAIT_TIMEOUT_MS: '1' });
  });

  registry.define(/^the agent escalates once and then proceeds, per the inherited human-in-the-loop timeout$/, (ctx) => {
    const lines = readOutboxLines(ctx.root).filter((l) => l.threadId === THREAD_ID && /still needed/i.test(l.text));
    if (lines.length !== 1) {
      throw new Error(`expected exactly one escalation posted, got: ${JSON.stringify(readOutboxLines(ctx.root))}`);
    }
    if (fs.existsSync(awaitingAnswerPath(ctx.root))) {
      throw new Error('expected the wait to be dropped (awaiting-answer.json cleared) after escalating - the agent must proceed, never block forever');
    }
    // A further tick must never re-escalate the same (now-cleared) question.
    const before = readOutboxLines(ctx.root).length;
    tickOnce(ctx.root, { OPERATOR_AWAIT_TIMEOUT_MS: '1' });
    const after = readOutboxLines(ctx.root).length;
    if (after !== before) {
      throw new Error('expected a later tick not to re-escalate an already-dropped question');
    }
  });
}

module.exports = { registerSteps };
