'use strict';

// BL-354: step handlers for "A pending question follows the human to the
// thread he is actually in" (Option C, same-thread-clears). Drives the
// REAL operator_ask.bb CLI and the REAL operator_runtime.bb --tick-once
// (real fs, real Babashka process, OPERATOR_SKIP_LAUNCH=1 skips the
// actual LLM spawn) - the exact same proven harness
// operatorAskAwaitSteps.js (BL-306) already uses, deliberately duplicated
// rather than imported (neither file exports its helpers; this
// codebase's own established "small live-glue duplicated across
// independent test surfaces" posture).
//
// HAZARD (the ticket's own, verbatim): three Then steps below are
// near-identical in shape ("delivered to the Operator as X") but assert
// THREE DIFFERENT payloads - pair (pending-question AND answer), re-home
// (pending-question, NO answer), none (neither). Each gets its own full,
// textually-distinct step definition - never a shared loose pattern that
// would swallow all three and assert nothing real.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OPERATOR_ASK_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_ask.bb');
const OPERATOR_RUNTIME_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');

const ASKING_THREAD = 'SUP-A';
const OTHER_THREAD = 'SUP-B';
const QUESTION = 'free-email-scanner is not reachable - tell me 1, 2, or 3';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-answer-pairing-'));
}

function opPath(root, ...rest) {
  return path.join(root, '.swarmforge', 'operator', ...rest);
}

function threadPath(root, threadId) {
  return path.join(root, '.swarmforge', 'support', 'threads', `${threadId}.json`);
}

function writeThread(root, threadId, messages) {
  fs.mkdirSync(path.dirname(threadPath(root, threadId)), { recursive: true });
  fs.writeFileSync(threadPath(root, threadId), JSON.stringify({ id: threadId, status: 'open', messages }));
}

function readThread(root, threadId) {
  return JSON.parse(fs.readFileSync(threadPath(root, threadId), 'utf8'));
}

function ensureThread(root, threadId) {
  if (!fs.existsSync(threadPath(root, threadId))) {
    writeThread(root, threadId, []);
  }
}

function appendHumanMessage(root, threadId, text, timestamp) {
  ensureThread(root, threadId);
  const thread = readThread(root, threadId);
  thread.messages.push({ channel: 'telegram', timestamp, text });
  fs.writeFileSync(threadPath(root, threadId), JSON.stringify(thread));
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

function ask(root, threadId, question) {
  const out = execFileSync('bb', [OPERATOR_ASK_CLI, root, '--thread', threadId, '--question', question], { encoding: 'utf8' });
  return JSON.parse(out);
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

function writeEvents(root, events) {
  fs.mkdirSync(opPath(root), { recursive: true });
  fs.writeFileSync(opPath(root, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function readReplyContext(root) {
  return JSON.parse(fs.readFileSync(opPath(root, 'telegram-reply-context.json'), 'utf8'));
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^the Operator and the human are talking in Telegram topics$/, (ctx) => {
    ctx.root = mkTmp();
  });

  // ── shared Given: a question is pending in the asking thread ───────────
  registry.define(/^the Operator has asked the human a question in the asking thread$/, (ctx) => {
    ctx.askResult = ask(ctx.root, ASKING_THREAD, QUESTION);
    if (ctx.askResult.asked !== true) {
      throw new Error(`expected the ask to succeed, got ${JSON.stringify(ctx.askResult)}`);
    }
    ctx.originalAskedAtMs = readAwaitingAnswer(ctx.root).asked_at_ms;
  });

  // ── answer-pairing-across-threads-01 ─────────────────────────────────────
  registry.define(/^the human replies in the asking thread$/, (ctx) => {
    appendHumanMessage(ctx.root, ASKING_THREAD, '3', '2026-07-13T00:01:19Z');
    writeEvents(ctx.root, [{ type: 'TELEGRAM_TOPIC_MESSAGE', subject: ASKING_THREAD }]);
    ctx.tickResult = tickOnce(ctx.root);
    ctx.replyContext = readReplyContext(ctx.root);
  });

  registry.define(/^that reply is delivered to the Operator as the answer to the pending question$/, (ctx) => {
    const context = ctx.replyContext;
    const pendingQuestion = context.pendingQuestion ?? context['pending-question'];
    if (pendingQuestion !== QUESTION) {
      throw new Error(`expected the reply-context to carry the pending question, got: ${JSON.stringify(context)}`);
    }
    if (context.answer !== '3') {
      throw new Error(`expected the reply-context's answer to be the human's own reply text, got: ${JSON.stringify(context)}`);
    }
  });

  registry.define(/^the Operator sees the question it answers alongside it$/, (ctx) => {
    const pendingQuestion = ctx.replyContext.pendingQuestion ?? ctx.replyContext['pending-question'];
    if (pendingQuestion !== QUESTION) {
      throw new Error('expected the pending question itself to be visible alongside the answer, never a bare contextless reply');
    }
  });

  registry.define(/^the Operator stops awaiting an answer$/, (ctx) => {
    if (fs.existsSync(awaitingAnswerPath(ctx.root))) {
      throw new Error('expected awaiting-answer.json to be cleared');
    }
  });

  // ── answer-pairing-across-threads-02 ─────────────────────────────────────
  registry.define(/^the human writes in a different thread$/, (ctx) => {
    appendHumanMessage(ctx.root, OTHER_THREAD, 'hey, quick question about something else', '2026-07-13T00:01:19Z');
    writeEvents(ctx.root, [{ type: 'TELEGRAM_TOPIC_MESSAGE', subject: OTHER_THREAD }]);
    ctx.tickResult = tickOnce(ctx.root);
    ctx.replyContext = readReplyContext(ctx.root);
  });

  registry.define(/^that message is delivered to the Operator as an ordinary message, with the pending question attached but no answer$/, (ctx) => {
    const context = ctx.replyContext;
    const pendingQuestion = context.pendingQuestion ?? context['pending-question'];
    if (pendingQuestion !== QUESTION) {
      throw new Error(`expected the pending question to still be attached (the Operator must never again say "no numbered list open"), got: ${JSON.stringify(context)}`);
    }
    if ('answer' in context || 'pending-question-answer' in context) {
      throw new Error(`expected NO answer to be attached - this message was never consumed as one, got: ${JSON.stringify(context)}`);
    }
  });

  registry.define(/^the pending question is posted into the different thread$/, (ctx) => {
    const thread = readThread(ctx.root, OTHER_THREAD);
    if (!thread.messages.some((m) => m.text === QUESTION)) {
      throw new Error(`expected the pending question re-posted into ${OTHER_THREAD}'s transcript, got: ${JSON.stringify(thread)}`);
    }
    if (!readOutboxLines(ctx.root).some((l) => l.threadId === OTHER_THREAD && l.text === QUESTION)) {
      throw new Error('expected the pending question re-posted to the reply outbox for the different thread');
    }
  });

  registry.define(/^the Operator is still awaiting an answer$/, (ctx) => {
    const awaiting = readAwaitingAnswer(ctx.root);
    if (!awaiting) {
      throw new Error('expected the await to still be recorded (re-homed, never cleared) after a cross-thread message');
    }
    if (awaiting.thread_id !== OTHER_THREAD) {
      throw new Error(`expected the await to have re-homed to ${OTHER_THREAD}, got thread_id=${awaiting.thread_id}`);
    }
    if (awaiting.asked_at_ms !== ctx.originalAskedAtMs) {
      throw new Error(
        `expected asked_at_ms to survive the re-home UNCHANGED (the deadline runs from the ORIGINAL ask) - original=${ctx.originalAskedAtMs} got=${awaiting.asked_at_ms}`
      );
    }
  });

  // ── answer-pairing-across-threads-03 ─────────────────────────────────────
  registry.define(/^the human has written in a different thread, so the question was posted there$/, (ctx) => {
    appendHumanMessage(ctx.root, OTHER_THREAD, 'hey, quick question about something else', '2026-07-13T00:01:19Z');
    writeEvents(ctx.root, [{ type: 'TELEGRAM_TOPIC_MESSAGE', subject: OTHER_THREAD }]);
    tickOnce(ctx.root);
  });

  registry.define(/^the human replies in that different thread$/, (ctx) => {
    appendHumanMessage(ctx.root, OTHER_THREAD, '3', '2026-07-13T00:03:00Z');
    writeEvents(ctx.root, [{ type: 'TELEGRAM_TOPIC_MESSAGE', subject: OTHER_THREAD }]);
    ctx.tickResult = tickOnce(ctx.root);
    ctx.replyContext = readReplyContext(ctx.root);
  });

  registry.define(/^the human is never asked for that answer again$/, (ctx) => {
    const lines = readOutboxLines(ctx.root).filter((l) => /still needed/i.test(l.text));
    if (lines.length !== 0) {
      throw new Error(`expected no "[still needed]" escalation once the answer was delivered, got: ${JSON.stringify(lines)}`);
    }
  });

  // ── answer-pairing-across-threads-04 ─────────────────────────────────────
  registry.define(/^the Operator has no question pending$/, (ctx) => {
    if (fs.existsSync(awaitingAnswerPath(ctx.root))) {
      fs.rmSync(awaitingAnswerPath(ctx.root));
    }
  });

  registry.define(/^the human sends a message$/, (ctx) => {
    appendHumanMessage(ctx.root, ASKING_THREAD, 'unrelated hello', '2026-07-13T00:01:19Z');
    writeEvents(ctx.root, [{ type: 'TELEGRAM_TOPIC_MESSAGE', subject: ASKING_THREAD }]);
    ctx.tickResult = tickOnce(ctx.root);
    ctx.replyContext = readReplyContext(ctx.root);
  });

  registry.define(/^that message is delivered to the Operator as an ordinary message, with nothing attached$/, (ctx) => {
    const context = ctx.replyContext;
    const pendingQuestion = context.pendingQuestion ?? context['pending-question'];
    if (pendingQuestion !== undefined) {
      throw new Error(`expected no pending question attached when none is pending, got: ${JSON.stringify(context)}`);
    }
    if (context.answer !== undefined) {
      throw new Error(`expected no answer attached when nothing was pending, got: ${JSON.stringify(context)}`);
    }
  });

  // ── answer-pairing-across-threads-05 ─────────────────────────────────────
  registry.define(/^the answer deadline measured from the original question passes with no reply$/, (ctx) => {
    // Same OPERATOR_AWAIT_TIMEOUT_MS seam operatorAskAwaitSteps.js's own
    // operator-ask-03 uses - the deadline is measured from asked_at_ms,
    // which the re-home above left UNCHANGED, so a tiny timeout fires
    // immediately regardless of the re-home's own wall-clock timing.
    ctx.tickResult = tickOnce(ctx.root, { OPERATOR_AWAIT_TIMEOUT_MS: '1' });
  });

  registry.define(/^the human is reminded once, in the different thread$/, (ctx) => {
    const lines = readOutboxLines(ctx.root).filter((l) => l.threadId === OTHER_THREAD && /still needed/i.test(l.text));
    if (lines.length !== 1) {
      throw new Error(`expected exactly one "[still needed]" escalation posted into ${OTHER_THREAD} (the thread the human is actually in), got: ${JSON.stringify(readOutboxLines(ctx.root))}`);
    }
    const stale = readOutboxLines(ctx.root).filter((l) => l.threadId === ASKING_THREAD && /still needed/i.test(l.text));
    if (stale.length !== 0) {
      throw new Error(`expected NO escalation into the abandoned asking thread, got: ${JSON.stringify(stale)}`);
    }
  });
}

module.exports = { registerSteps };
