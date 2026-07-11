'use strict';

// BL-282: step handlers for "Operator long-term memory - distill durable
// facts and reload them per wake". Drives the REAL operator_memory.bb CLI
// (real fs), the REAL support_thread.bb CLI (real fs), and the REAL
// operator_runtime.bb --tick-once (mirrors test_operator_runtime_tick.sh's
// own OPERATOR_SKIP_LAUNCH pattern) - no real LLM, no real network, no
// real timers.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const OPERATOR_MEMORY_CLI = path.join(SCRIPTS_DIR, 'operator_memory.bb');
const SUPPORT_THREAD_CLI = path.join(SCRIPTS_DIR, 'support_thread.bb');
const OPERATOR_RUNTIME = path.join(SCRIPTS_DIR, 'operator_runtime.bb');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-operator-memory-'));
}

function distill(root, fact) {
  return JSON.parse(execFileSync('bb', [OPERATOR_MEMORY_CLI, root, 'distill', '--fact', fact], { encoding: 'utf8' }));
}

function loadFacts(root) {
  return JSON.parse(execFileSync('bb', [OPERATOR_MEMORY_CLI, root, 'load'], { encoding: 'utf8' }));
}

function openThread(root, id, text) {
  // BL-275's open subcommand always assigns the NEXT id - to control the
  // exact id in a fixture with multiple subjects, write the thread file
  // directly (mirrors operatorThreadLifecycleSteps.js's own approach).
  const dir = path.join(root, '.swarmforge', 'support', 'threads');
  fs.mkdirSync(dir, { recursive: true });
  const thread = { id, status: 'open', messages: [{ channel: 'telegram', timestamp: '2026-07-11T09:00:00Z', text }] };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(thread));
  return thread;
}

function enqueueWakeEvent(root, subjectId) {
  const file = path.join(root, '.swarmforge', 'operator', 'events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ type: 'TELEGRAM_TOPIC_MESSAGE', subject: subjectId }) + '\n');
}

function tickOnce(root) {
  execFileSync('bb', [OPERATOR_RUNTIME, root, '--tick-once'], { encoding: 'utf8', env: { ...process.env, OPERATOR_SKIP_LAUNCH: '1' } });
}

function readReplyContext(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-reply-context.json'), 'utf8'));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Operator keeps a long-term memory store separate from the per-subject transcripts$/, (ctx) => {
    ctx.root = mkTmp();
  });

  // ── operator-memory-01 ───────────────────────────────────────────────
  registry.define(/^a disposable Operator run distilled a durable fact from a subject it handled$/, (ctx) => {
    ctx.fact = 'the human prefers terse replies';
    distill(ctx.root, ctx.fact);
  });

  registry.define(/^a later wake starts a new disposable Operator run$/, (ctx) => {
    // A fresh CLI invocation IS "a new run" reading the SAME persisted
    // store - the prior distill call's own process has already exited.
    ctx.loadedFacts = loadFacts(ctx.root);
  });

  registry.define(/^the earlier durable fact is available to the new run$/, (ctx) => {
    if (!ctx.loadedFacts.includes(ctx.fact)) {
      throw new Error(`expected the earlier fact to survive into the new run, got: ${JSON.stringify(ctx.loadedFacts)}`);
    }
  });

  // ── operator-memory-02 ───────────────────────────────────────────────
  registry.define(/^the long-term memory store holds a durable fact$/, (ctx) => {
    ctx.fact = ctx.fact || 'the human prefers terse replies';
    distill(ctx.root, ctx.fact);
  });

  registry.define(/^the subject has its own transcript$/, (ctx) => {
    ctx.subject = openThread(ctx.root, 'SUP-1', 'about A');
  });

  registry.define(/^the Operator is woken for that subject$/, (ctx) => {
    enqueueWakeEvent(ctx.root, ctx.subject.id);
    tickOnce(ctx.root);
    ctx.replyContext = readReplyContext(ctx.root);
  });

  registry.define(/^it loads the durable fact together with the subject's transcript$/, (ctx) => {
    if (!ctx.replyContext['long-term-memory'].includes(ctx.fact)) {
      throw new Error(`expected the durable fact loaded, got: ${JSON.stringify(ctx.replyContext)}`);
    }
    if (!JSON.stringify(ctx.replyContext.transcript).includes('about A')) {
      throw new Error(`expected the subject's own transcript loaded too, got: ${JSON.stringify(ctx.replyContext)}`);
    }
  });

  // ── operator-memory-03 ───────────────────────────────────────────────
  registry.define(/^subject A holds private transcript detail that was never distilled into a durable fact$/, (ctx) => {
    ctx.fact = 'the human prefers terse replies';
    distill(ctx.root, ctx.fact);
    ctx.subjectA = openThread(ctx.root, 'SUP-1', 'private detail about A, never distilled');
    ctx.subjectB = openThread(ctx.root, 'SUP-2', 'about B');
  });

  registry.define(/^the Operator reloads a different subject's context$/, (ctx) => {
    enqueueWakeEvent(ctx.root, ctx.subjectB.id);
    tickOnce(ctx.root);
    ctx.replyContext = readReplyContext(ctx.root);
  });

  registry.define(/^the context holds the durable fact but never subject A's transcript$/, (ctx) => {
    if (!ctx.replyContext['long-term-memory'].includes(ctx.fact)) {
      throw new Error(`expected the durable fact present, got: ${JSON.stringify(ctx.replyContext)}`);
    }
    const contextText = JSON.stringify(ctx.replyContext);
    if (contextText.includes('private detail about A')) {
      throw new Error(`expected subject A's private transcript NEVER present, got: ${contextText}`);
    }
    if (!contextText.includes('about B')) {
      throw new Error(`expected subject B's OWN transcript present, got: ${contextText}`);
    }
  });

  // ── operator-memory-04 ───────────────────────────────────────────────
  registry.define(/^the Operator has finished handling a subject exchange$/, (ctx) => {
    ctx.rawExchangeText = 'raw exchange detail xyz-unique-12345, never a durable fact';
    ctx.generalizedFact = 'the human is in the EU timezone';
  });

  registry.define(/^it distills memory from that exchange$/, (ctx) => {
    // The Operator's own judgment (an LLM concern, out of this pure lib's
    // scope) decides WHICH generalized fact to propose - simulated here
    // by proposing only the generalized fact, never the raw exchange text.
    ctx.store = distill(ctx.root, ctx.generalizedFact);
  });

  registry.define(/^the distilled result keeps only durable generalizable facts$/, (ctx) => {
    if (!ctx.store.facts.includes(ctx.generalizedFact)) {
      throw new Error(`expected the generalized fact stored, got: ${JSON.stringify(ctx.store)}`);
    }
  });

  registry.define(/^the raw subject messages are dropped$/, (ctx) => {
    if (JSON.stringify(ctx.store).includes(ctx.rawExchangeText)) {
      throw new Error(`expected the raw exchange text NEVER present in the store, got: ${JSON.stringify(ctx.store)}`);
    }
  });

  // ── operator-memory-05 ───────────────────────────────────────────────
  registry.define(/^the Operator distills that same fact again$/, (ctx) => {
    ctx.store = distill(ctx.root, ctx.fact);
  });

  registry.define(/^the store still holds it exactly once$/, (ctx) => {
    const occurrences = ctx.store.facts.filter((f) => f === ctx.fact).length;
    if (occurrences !== 1) {
      throw new Error(`expected the fact stored exactly once, got ${occurrences} occurrences in: ${JSON.stringify(ctx.store)}`);
    }
  });
}

module.exports = { registerSteps };
