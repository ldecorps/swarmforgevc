'use strict';

// BL-306: step handlers for "The Operator asks the human a clarifying
// question in the front-desk thread and waits for the answer without
// getting stuck". Drives the REAL operator_ask.bb CLI and the REAL
// operator_runtime.bb --tick-once (real fs, real Babashka process, no
// real tmux/network/timers - OPERATOR_SKIP_LAUNCH=1 skips the actual LLM
// spawn), mirroring operatorProactiveNotifySteps.js's own real-CLI pattern
// and test_operator_runtime_tick.sh's own --tick-once fixture conventions.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OPERATOR_ASK_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_ask.bb');
const OPERATOR_RUNTIME_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');

const THREAD_ID = 'SUP-1';
const QUESTION = 'which environment?';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-operator-ask-'));
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

function opPath(root, ...rest) {
  return path.join(root, '.swarmforge', 'operator', ...rest);
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
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Operator has a decision it may not make on its own and asks the human$/, (ctx) => {
    ctx.root = mkTmp();
  });

  // ── operator-ask-01 ──────────────────────────────────────────────────
  registry.define(/^the Operator asks its clarifying question$/, (ctx) => {
    ctx.askResult = ask(ctx.root, THREAD_ID, QUESTION);
  });

  registry.define(/^the question is posted into the front-desk support thread$/, (ctx) => {
    if (ctx.askResult.asked !== true) {
      throw new Error(`expected the ask to succeed, got ${JSON.stringify(ctx.askResult)}`);
    }
    const thread = readThread(ctx.root, THREAD_ID);
    if (!thread.messages.some((m) => m.text === QUESTION)) {
      throw new Error(`expected the question in the thread transcript, got: ${JSON.stringify(thread)}`);
    }
    if (!readOutboxLines(ctx.root).some((l) => l.threadId === THREAD_ID && l.text === QUESTION)) {
      throw new Error('expected the question posted to the reply outbox');
    }
  });

  registry.define(/^an awaiting-answer state is recorded so it is not asked again$/, (ctx) => {
    const awaiting = readAwaitingAnswer(ctx.root);
    if (!awaiting || awaiting.question !== QUESTION || awaiting.thread_id !== THREAD_ID) {
      throw new Error(`expected an awaiting-answer record for the question, got: ${JSON.stringify(awaiting)}`);
    }
    const second = ask(ctx.root, THREAD_ID, 'a different question?');
    if (second.asked !== false) {
      throw new Error(`expected a second ask while one is pending to be refused, got: ${JSON.stringify(second)}`);
    }
  });

  // ── operator-ask-02 ──────────────────────────────────────────────────
  registry.define(/^the Operator is awaiting an answer$/, (ctx) => {
    fs.mkdirSync(opPath(ctx.root), { recursive: true });
    fs.writeFileSync(awaitingAnswerPath(ctx.root), JSON.stringify({ question: QUESTION, thread_id: THREAD_ID, asked_at_ms: Date.now() }));
    writeThread(ctx.root, THREAD_ID, [{ channel: 'operator', timestamp: '2026-07-11T09:00:00Z', text: QUESTION }]);
  });

  registry.define(/^the human replies in the front-desk thread$/, (ctx) => {
    const thread = readThread(ctx.root, THREAD_ID);
    thread.messages.push({ channel: 'telegram', timestamp: '2026-07-11T09:05:00Z', text: 'use staging' });
    fs.writeFileSync(threadPath(ctx.root, THREAD_ID), JSON.stringify(thread));
    writeEvents(ctx.root, [{ type: 'TELEGRAM_TOPIC_MESSAGE', subject: THREAD_ID }]);
    ctx.tickResult = tickOnce(ctx.root);
  });

  registry.define(/^the reply is delivered to the Operator as that question's answer$/, (ctx) => {
    const context = readReplyContext(ctx.root);
    if (context.pendingQuestion !== QUESTION && context['pending-question'] !== QUESTION) {
      throw new Error(`expected the reply-context to pair the pending question, got: ${JSON.stringify(context)}`);
    }
    if (context.answer !== 'use staging') {
      throw new Error(`expected the reply-context's answer to be the human's own reply text, got: ${JSON.stringify(context)}`);
    }
  });

  registry.define(/^the awaiting-answer state is cleared$/, (ctx) => {
    if (fs.existsSync(awaitingAnswerPath(ctx.root))) {
      throw new Error('expected awaiting-answer.json to be cleared once the reply is delivered');
    }
  });

  // ── operator-ask-03 ──────────────────────────────────────────────────
  registry.define(/^the await window elapses with no reply$/, (ctx) => {
    fs.writeFileSync(awaitingAnswerPath(ctx.root), JSON.stringify({ question: QUESTION, thread_id: THREAD_ID, asked_at_ms: 0 }));
    ctx.tickResult = tickOnce(ctx.root, { OPERATOR_AWAIT_TIMEOUT_MS: '1' });
  });

  registry.define(/^the question is escalated once and the Operator stops waiting on it$/, (ctx) => {
    const lines = readOutboxLines(ctx.root).filter((l) => l.threadId === THREAD_ID && /still needed/i.test(l.text));
    if (lines.length !== 1) {
      throw new Error(`expected exactly one escalation posted, got ${JSON.stringify(readOutboxLines(ctx.root))}`);
    }
    if (fs.existsSync(awaitingAnswerPath(ctx.root))) {
      throw new Error('expected the wait to be dropped (awaiting-answer.json cleared) after escalating');
    }
  });

  registry.define(/^the Operator never guesses the answer on its own$/, (ctx) => {
    // Structural: check-awaiting-answer's own {:event :escalate-and-drop}
    // never carries a fabricated :answer field - the escalation text names
    // only the ORIGINAL question, confirmed above; a second tick must not
    // re-escalate/re-fabricate anything either.
    const before = readOutboxLines(ctx.root).length;
    tickOnce(ctx.root, { OPERATOR_AWAIT_TIMEOUT_MS: '1' });
    const after = readOutboxLines(ctx.root).length;
    if (after !== before) {
      throw new Error('expected a later tick not to post anything further for an already-dropped question');
    }
  });

  // ── operator-ask-04 ──────────────────────────────────────────────────
  registry.define(/^a swarm emergency needs handling$/, (ctx) => {
    fs.writeFileSync(awaitingAnswerPath(ctx.root), JSON.stringify({ question: QUESTION, thread_id: THREAD_ID, asked_at_ms: Date.now() }));
    writeEvents(ctx.root, [{ type: 'HUMAN_COMMAND', detail: 'emergency' }]);
    ctx.tickResult = tickOnce(ctx.root);
  });

  registry.define(/^the Operator still handles the emergency$/, (ctx) => {
    if (ctx.tickResult['launched?'] !== true) {
      throw new Error(`expected the emergency event to still dispatch while a question is pending, got: ${JSON.stringify(ctx.tickResult)}`);
    }
    const awaiting = readAwaitingAnswer(ctx.root);
    if (!awaiting || awaiting.thread_id !== THREAD_ID) {
      throw new Error('expected the still-pending (not yet due) question to be left untouched');
    }
  });
}

module.exports = { registerSteps };
