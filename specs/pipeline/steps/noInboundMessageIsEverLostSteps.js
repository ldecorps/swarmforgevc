'use strict';

// BL-369: step handlers for "A message the human sends is never silently
// lost". Drives the REAL compiled logic on both language sides - the
// front-desk bot's own offset/retry/escalate decisions
// (extension/out/tools/telegramFrontDeskBotCore), the bridge's real
// idempotent ingest (extension/out/bridge/bridgeServer's
// ingestTelegramInboundMessage), the REAL cross-process events.jsonl lock
// (extension/out/bridge/operatorEventQueue's appendOperatorEvent, and the
// REAL swarmforge/scripts/operator_runtime.bb, run as a genuine subprocess) -
// never a hand-rolled substitute for either side of the two-process race
// this ticket exists to fix.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const { pollAndForward, runPollCycle, offsetAfterDelivery } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'telegramFrontDeskBotCore')
);
const { ingestTelegramInboundMessage } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'bridge', 'bridgeServer'));
const { appendOperatorEvent } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'bridge', 'operatorEventQueue'));

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const OPERATOR_RUNTIME_BB_FILES = [
  'operator_lib.bb',
  'operator_runtime.bb',
  'telegram_topic_lib.bb',
  'support_lib.bb',
  'support_thread_store.bb',
  'operator_memory_lib.bb',
  'operator_memory_store.bb',
  'ticket_status_lib.bb',
  'operator_ask.bb',
  'handoff_lib.bb',
  'daemon_alarm_lib.bb',
];

const PRINCIPAL_ID = 111;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkRuntimeFixture() {
  const target = mkTmp('sfvc-bl369-runtime-');
  const scriptsDir = path.join(target, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(target, '.swarmforge', 'operator'), { recursive: true });
  for (const f of OPERATOR_RUNTIME_BB_FILES) {
    fs.copyFileSync(path.join(SWARM_SCRIPTS, f), path.join(scriptsDir, f));
  }
  return target;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queuedEventsText(targetPath) {
  const opDir = path.join(targetPath, '.swarmforge', 'operator');
  let text = '';
  for (const name of ['events.jsonl', 'events.inflight.jsonl']) {
    const p = path.join(opDir, name);
    if (fs.existsSync(p)) {
      text += fs.readFileSync(p, 'utf8');
    }
  }
  return text;
}

function mkUpdate(updateId) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, text: 'a human message' } };
}

// BL-369 no-inbound-message-is-ever-lost-02: a Scenario Outline's <failure>
// column value MUST be validated against an explicit KNOWN_VALUES lookup,
// never a bare passthrough (the engineering article's own rule) - an
// unrecognized value (including gherkin-mutator's own mutant) throws here
// rather than silently taking some default branch. Scenario 05's Given is
// a CONCRETE instantiation of this same parameterized Given (the ticket's
// own IR-DRY note) - one handler correctly serves both.
const FAILURE_KNOWN_VALUES = {
  'the bridge cannot be reached': 'bridge-unreachable',
  'the event cannot be queued': 'event-cannot-be-queued',
};

function fakePollAdapters(ctx, { deliver }) {
  return {
    getUpdates: async () => ({ success: true, updates: [mkUpdate(ctx.updateId)] }),
    postToBridge: async () => {
      if (ctx.failureKind === 'event-cannot-be-queued') {
        const result = ingestTelegramInboundMessage(ctx.bridgeTarget, ctx.subjectId, 'telegram', 'a human message', ctx.updateId);
        return result.success;
      }
      return deliver;
    },
    subjectForTopic: () => ctx.subjectId,
    openSubjectAndRecord: async () => ctx.subjectId,
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the human is talking to the Operator in a Telegram topic$/, (ctx) => {
    ctx.subjectId = 'SUP-1';
  });

  // ── no-inbound-message-is-ever-lost-01 ──────────────────────────────
  registry.define(/^the operator runtime is claiming events from its pending queue$/, (ctx) => {
    ctx.runtimeTarget = mkRuntimeFixture();
    ctx.tickProcess = spawn(
      'bb',
      [path.join(ctx.runtimeTarget, 'swarmforge', 'scripts', 'operator_runtime.bb'), ctx.runtimeTarget, '--tick-once'],
      { env: { ...process.env, OPERATOR_SKIP_LAUNCH: '1', OPERATOR_EVENTS_LOCK_TEST_HOLD_MS: '200' } }
    );
    ctx.tickExit = new Promise((resolve) => ctx.tickProcess.on('exit', resolve));
  });

  registry.define(/^a message from the human arrives at that moment$/, async (ctx) => {
    // A short head start so the runtime is very likely already holding the
    // lock (not required for correctness - either acquire order proves
    // mutual exclusion - just makes the outcome the demonstrative one).
    await sleep(50);
    appendOperatorEvent(ctx.runtimeTarget, { type: 'TELEGRAM_TOPIC_MESSAGE', subject: ctx.subjectId, updateId: 1 });
    await ctx.tickExit;
    ctx.queuedText = queuedEventsText(ctx.runtimeTarget);
  });

  // ── no-inbound-message-is-ever-lost-02 (Scenario Outline) ───────────
  registry.define(/^the front desk cannot durably accept an inbound message because (.+)$/, (ctx, failure) => {
    if (!Object.prototype.hasOwnProperty.call(FAILURE_KNOWN_VALUES, failure)) {
      throw new Error(`no-inbound-message-is-ever-lost: unrecognized failure example value "${failure}"`);
    }
    ctx.failureKind = FAILURE_KNOWN_VALUES[failure];
    ctx.updateId = 77;
    ctx.offset = 0;
    if (ctx.failureKind === 'event-cannot-be-queued') {
      ctx.bridgeTarget = mkTmp('sfvc-bl369-bridge-');
      ctx.lockDir = path.join(ctx.bridgeTarget, '.swarmforge', 'operator', 'events.jsonl.lock');
      fs.mkdirSync(ctx.lockDir, { recursive: true }); // a real, induced failure - "another process" genuinely holds it
      ctx.priorMaxWait = process.env.OPERATOR_EVENTS_LOCK_MAX_WAIT_MS;
      ctx.priorRetryDelay = process.env.OPERATOR_EVENTS_LOCK_RETRY_DELAY_MS;
      process.env.OPERATOR_EVENTS_LOCK_MAX_WAIT_MS = '30';
      process.env.OPERATOR_EVENTS_LOCK_RETRY_DELAY_MS = '5';
    }
  });

  registry.define(/^the human's message is sent$/, async (ctx) => {
    ctx.firstAttempt = await pollAndForward(ctx.offset, PRINCIPAL_ID, fakePollAdapters(ctx, { deliver: false }));
  });

  registry.define(/^the message is delivered again once the failure clears$/, async (ctx) => {
    if (ctx.failureKind === 'event-cannot-be-queued') {
      fs.rmdirSync(ctx.lockDir); // the "other process" releases it - the failure has cleared
    }
    ctx.secondAttempt = await pollAndForward(ctx.firstAttempt.nextOffset, PRINCIPAL_ID, fakePollAdapters(ctx, { deliver: true }));
    if (ctx.secondAttempt.posted !== 1) {
      throw new Error(`expected the SAME update to be redelivered and accepted once the failure cleared, got ${JSON.stringify(ctx.secondAttempt)}`);
    }
    if (ctx.secondAttempt.nextOffset === ctx.firstAttempt.nextOffset) {
      throw new Error('expected the offset to actually advance past the now-delivered update');
    }
  });

  registry.define(/^an Operator is woken for that message$/, (ctx) => {
    if (ctx.queuedText !== undefined) {
      // no-inbound-message-is-ever-lost-01's own context.
      if (!ctx.queuedText.includes('TELEGRAM_TOPIC_MESSAGE')) {
        throw new Error("expected the concurrently-arrived message to be durably queued, never lost to the runtime's own critical section");
      }
      return;
    }
    if (ctx.failureKind === 'event-cannot-be-queued') {
      const text = fs.readFileSync(path.join(ctx.bridgeTarget, '.swarmforge', 'operator', 'events.jsonl'), 'utf8');
      if (!text.includes('TELEGRAM_TOPIC_MESSAGE') || !text.includes(String(ctx.updateId))) {
        throw new Error('expected the retried message to have actually been queued once the lock cleared');
      }
      return;
    }
    // bridge-unreachable: proven by the second pollAndForward attempt
    // itself reporting posted:1 above - nothing further to check here.
    if (!ctx.secondAttempt || ctx.secondAttempt.posted !== 1) {
      throw new Error('expected the retried message to have been posted');
    }
  });

  // ── no-inbound-message-is-ever-lost-03 ──────────────────────────────
  registry.define(/^a message from the human was accepted but its acknowledgement was lost$/, (ctx) => {
    ctx.bridgeTarget = mkTmp('sfvc-bl369-dedup-');
    ctx.updateId = 900;
    const first = ingestTelegramInboundMessage(ctx.bridgeTarget, ctx.subjectId, 'telegram', 'hello', ctx.updateId);
    if (!first.success) {
      throw new Error('expected the first delivery to have been accepted (this scenario is about a LOST ack, not a failed accept)');
    }
  });

  registry.define(/^the same message is delivered again$/, (ctx) => {
    ctx.redelivery = ingestTelegramInboundMessage(ctx.bridgeTarget, ctx.subjectId, 'telegram', 'hello', ctx.updateId);
    if (!ctx.redelivery.success) {
      throw new Error('expected a pure redelivery of an already-accepted message to still report success (it WAS handled)');
    }
  });

  registry.define(/^it appears exactly once in the thread's transcript$/, (ctx) => {
    const threadPath = path.join(ctx.bridgeTarget, '.swarmforge', 'support', 'threads', `${ctx.subjectId}.json`);
    const thread = JSON.parse(fs.readFileSync(threadPath, 'utf8'));
    const matching = thread.messages.filter((m) => m.updateId === ctx.updateId);
    if (matching.length !== 1) {
      throw new Error(`expected exactly one transcript line for updateId ${ctx.updateId}, got ${matching.length}`);
    }
  });

  registry.define(/^exactly one Operator wake is queued for it$/, (ctx) => {
    const eventsPath = path.join(ctx.bridgeTarget, '.swarmforge', 'operator', 'events.jsonl');
    const lines = fs
      .readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const matching = lines.filter((e) => e.type === 'TELEGRAM_TOPIC_MESSAGE' && e.updateId === ctx.updateId);
    if (matching.length !== 1) {
      throw new Error(`expected exactly one queued wake for updateId ${ctx.updateId}, got ${matching.length}`);
    }
  });

  // ── no-inbound-message-is-ever-lost-04 ──────────────────────────────
  registry.define(/^a message from the human is recorded in a thread's transcript$/, (ctx) => {
    ctx.runtimeTarget = mkRuntimeFixture();
    ctx.updateId = 950;
    const threadsDir = path.join(ctx.runtimeTarget, '.swarmforge', 'support', 'threads');
    fs.mkdirSync(threadsDir, { recursive: true });
    fs.writeFileSync(
      path.join(threadsDir, `${ctx.subjectId}.json`),
      JSON.stringify({
        id: ctx.subjectId,
        status: 'open',
        messages: [{ channel: 'telegram', timestamp: '2026-07-14T00:00:00Z', text: 'never woken for', updateId: ctx.updateId }],
      })
    );
  });

  registry.define(/^no Operator was ever woken for it$/, (ctx) => {
    // A structural fact about the fixture just written above (no
    // eventQueued flag, no events file at all yet) - asserted directly
    // rather than re-derived, since the Given step already established it.
    const thread = JSON.parse(fs.readFileSync(path.join(ctx.runtimeTarget, '.swarmforge', 'support', 'threads', `${ctx.subjectId}.json`), 'utf8'));
    if (thread.messages.some((m) => m.eventQueued)) {
      throw new Error('fixture bug: the seeded message must not already be marked eventQueued');
    }
  });

  registry.define(/^the front desk reconciles its threads against its queue$/, (ctx) => {
    const { execFileSync } = require('node:child_process');
    execFileSync('bb', [path.join(ctx.runtimeTarget, 'swarmforge', 'scripts', 'operator_runtime.bb'), ctx.runtimeTarget, '--tick-once'], {
      env: { ...process.env, OPERATOR_SKIP_LAUNCH: '1' },
      encoding: 'utf8',
    });
    ctx.queuedText = queuedEventsText(ctx.runtimeTarget);
  });

  // ── no-inbound-message-is-ever-lost-05 ──────────────────────────────
  const STUCK_CONFIG = { backoffBaseMs: 10, backoffMaxMs: 100, degradedThreshold: 100, stuckRetryLimit: 3 };

  registry.define(/^it has retried up to its limit$/, async (ctx) => {
    ctx.pollState = { offset: 0, consecutiveFailures: 0, stuckAttempts: 0 };
    ctx.escalations = [];
    for (let i = 0; i < STUCK_CONFIG.stuckRetryLimit; i++) {
      const cycle = await runPollCycle(ctx.pollState, PRINCIPAL_ID, fakePollAdapters(ctx, { deliver: false }), STUCK_CONFIG);
      ctx.pollState = cycle.state;
      ctx.escalations.push(cycle.escalateStuckDelivery);
    }
  });

  registry.define(/^it stops retrying$/, (ctx) => {
    if (ctx.escalations.filter(Boolean).length !== 1) {
      throw new Error(`expected exactly one escalation across the retry limit, got ${JSON.stringify(ctx.escalations)}`);
    }
    if (ctx.escalations[ctx.escalations.length - 1] !== true) {
      throw new Error('expected the escalation to fire on exactly the cycle the retry limit was reached');
    }
  });

  // Reused by BL-370's front-desk-liveness-means-listening-04 scenario -
  // IDENTICAL step text ("the failure is escalated to the human"), a
  // different ticket's failure mode entirely (a stalled poll loop giving
  // up on restart, not a stuck per-message delivery). Branches on which
  // ticket's ctx shape is present rather than being duplicated/re-
  // registered (this codebase's own established convention for shared
  // step text - see operatorPassesAQuestionDownSteps.js's own docstring
  // for the same pattern with a different shared step).
  registry.define(/^the failure is escalated to the human$/, (ctx) => {
    if (ctx.escalations) {
      if (!ctx.escalations.includes(true)) {
        throw new Error('expected escalateStuckDelivery to have fired at least once');
      }
      return;
    }
    if (ctx.logText !== undefined) {
      const fragment = 'ok   - front-desk-liveness-04: the failure is escalated to the human (logged loudly)';
      if (!ctx.logText.includes(fragment)) {
        throw new Error(`BL-370: expected the give-up to be escalated (logged), got: ${ctx.logText}`);
      }
      return;
    }
    throw new Error('no recognized ctx shape for "the failure is escalated to the human" - neither BL-369\'s ctx.escalations nor BL-370\'s ctx.logText is set');
  });

  // "the front desk does not treat that message as received" is also used
  // by scenario 05 - the shared handler above already checks
  // ctx.firstAttempt when present; for scenario 05 there is no
  // firstAttempt, so check the poll state's own offset instead.
  registry.define(/^the front desk does not treat that message as received$/, (ctx) => {
    if (ctx.pollState) {
      if (ctx.pollState.offset !== 0) {
        throw new Error(`expected the offset to have never advanced past the un-deliverable message, got ${ctx.pollState.offset}`);
      }
      return;
    }
    if (ctx.firstAttempt.nextOffset !== ctx.offset) {
      throw new Error(`expected the offset to stay at ${ctx.offset} (never advance past an undelivered message), got ${ctx.firstAttempt.nextOffset}`);
    }
    if (ctx.firstAttempt.posted !== 0) {
      throw new Error('expected nothing reported as posted on the failed attempt');
    }
  });
}

module.exports = { registerSteps };
