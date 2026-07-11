'use strict';

// BL-281: step handlers for "Operator hosts per-subject SUP-### threads as
// Telegram forum topics (refocus MVP)". Drives the REAL
// telegram_topic_lib.bb pure functions (via telegram_topic_acceptance_runner.bb,
// mirroring costHealthSidecarHeadlessSteps.js's own bb-runner pattern) - no
// real Telegram network, no real timers.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'telegram_topic_acceptance_runner.bb');

const PRINCIPAL_ID = 111;
const OTHER_USER_ID = 999;

function run(scenario, config) {
  const out = execFileSync('bb', [RUNNER, scenario, JSON.stringify(config)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Operator hosts SUP-### threads as Telegram forum topics$/, () => {
    // Documents the framing; each scenario's own Given builds its fixture.
  });

  // ── telegram-topic-01 ────────────────────────────────────────────────
  registry.define(/^the human opens a new subject$/, (ctx) => {
    ctx.subjectText = 'billing question';
  });

  registry.define(/^the Operator runtime creates the thread$/, (ctx) => {
    ctx.result = run('open-subject', { subjectName: ctx.subjectText, text: ctx.subjectText });
  });

  registry.define(/^a Telegram forum topic is created and mapped one-to-one to a new SUP-###$/, (ctx) => {
    if (!ctx.result.topicId) {
      throw new Error(`expected a Telegram forum topic to be created, got: ${JSON.stringify(ctx.result)}`);
    }
    if (!/^SUP-\d+$/.test(ctx.result.threadId)) {
      throw new Error(`expected a new SUP-### thread mapped to it, got: ${ctx.result.threadId}`);
    }
  });

  // ── telegram-topic-02 / telegram-topic-05 (shared When) ─────────────
  registry.define(/^an inbound message arrives on a topic mapped to a SUP-###$/, (ctx) => {
    ctx.demuxConfig = {
      subjectName: 'billing question',
      openingText: 'need help',
      fromId: PRINCIPAL_ID,
      principalId: PRINCIPAL_ID,
      text: 'any update?',
    };
  });

  registry.define(/^an inbound message from a user who is not the principal$/, (ctx) => {
    ctx.demuxConfig = {
      subjectName: 'billing question',
      openingText: 'need help',
      fromId: OTHER_USER_ID,
      principalId: PRINCIPAL_ID,
      text: 'let me in',
    };
  });

  registry.define(/^the Operator runtime processes the update$/, (ctx) => {
    ctx.result = run('demux', ctx.demuxConfig);
  });

  // ── telegram-topic-02 Then ───────────────────────────────────────────
  registry.define(/^the message is appended to that SUP-###'s transcript$/, (ctx) => {
    if (ctx.result.messageCount !== 2) {
      throw new Error(`expected the message appended (2 total: opening + inbound), got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^a per-topic event is enqueued for that SUP-###$/, (ctx) => {
    if (ctx.result.events.length !== 1 || ctx.result.events[0].type !== 'TELEGRAM_TOPIC_MESSAGE') {
      throw new Error(`expected exactly one TELEGRAM_TOPIC_MESSAGE event enqueued, got: ${JSON.stringify(ctx.result.events)}`);
    }
  });

  // ── telegram-topic-05 Then ───────────────────────────────────────────
  registry.define(/^the message is ignored and no thread event is enqueued$/, (ctx) => {
    if (ctx.result.accepted !== false || ctx.result.reason !== 'not-principal') {
      throw new Error(`expected the update to be rejected as not-principal, got: ${JSON.stringify(ctx.result)}`);
    }
    if (ctx.result.events.length !== 0) {
      throw new Error(`expected no event enqueued, got: ${JSON.stringify(ctx.result.events)}`);
    }
  });

  // ── telegram-topic-03 ────────────────────────────────────────────────
  registry.define(/^the disposable Operator is woken for a SUP-### with prior messages in its transcript$/, () => {
    // Fixture setup lives in the shared runner ('reply-independence' seeds
    // two subjects with prior messages) - nothing scenario-specific to
    // stage here beyond the shared When step below.
  });

  registry.define(/^it handles the wake$/, (ctx) => {
    ctx.result = run('reply-independence', {});
  });

  registry.define(/^it replies into that subject's topic using the thread's reloaded transcript$/, (ctx) => {
    const sent = ctx.result.sent[0];
    if (!sent || sent.topicId !== ctx.result.subjectATopic || sent.text !== 'reply text') {
      throw new Error(`expected a reply sent into subject A's own topic, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── telegram-topic-04 ────────────────────────────────────────────────
  registry.define(/^two subjects each on their own topic$/, () => {
    // Same shared fixture as telegram-topic-03 - see above.
  });

  registry.define(/^the Operator handles an event for one subject$/, (ctx) => {
    ctx.result = run('reply-independence', {});
  });

  registry.define(/^it sees only that subject's transcript, never the other subject's$/, (ctx) => {
    if (ctx.result.reads.length !== 1) {
      throw new Error(`expected exactly one thread to have been read, got: ${JSON.stringify(ctx.result.reads)}`);
    }
    if (!ctx.result.transcriptText.includes('about A') || ctx.result.transcriptText.includes('about B')) {
      throw new Error(`expected subject A's OWN transcript only, got: ${ctx.result.transcriptText}`);
    }
  });
}

module.exports = { registerSteps };
