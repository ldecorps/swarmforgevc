'use strict';

// BL-239: step handlers for the Telegram chat adapter feature. Drives the
// REAL compiled narrator/relay classes (out/notify/telegramNarrator.js,
// out/notify/telegramInboundRelay.js) with a fake sendOnce/answerGate
// adapter pair - no real network, no real tmux/vscode - mirroring
// telegramAdapterComposition.test.js's own composition-proof pattern.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { TelegramNarrator } = require(path.join(EXT_DIR, 'out', 'notify', 'telegramNarrator'));
const { TelegramInboundRelay } = require(path.join(EXT_DIR, 'out', 'notify', 'telegramInboundRelay'));

const AUTHORIZED_CHAT_ID = '999888777';
const RETRY_CONFIG = { maxAttempts: 3, backoffBaseMs: 1, backoffMaxMs: 4 };

function snapshot(overrides = {}) {
  return { runName: 'swarm-1', prUrl: null, pipeline: [], gates: [], deadLetters: [], ...overrides };
}

// Same composition extension.ts's startOrRestartTelegramAdapter wires live:
// a successfully-posted 'gate' narration event registers as a pending gate
// prompt the relay can later match a reply against.
function wireAdapter() {
  const sent = [];
  const relayed = [];
  const rejected = [];
  let nextMessageId = 1;

  const relay = new TelegramInboundRelay(AUTHORIZED_CHAT_ID, {
    answerGate: (role, answer) => ({ success: true, role, answer }),
    onRelayed: (role, answer, result) => relayed.push({ role, answer, result }),
    onRejected: (reason, update) => rejected.push({ reason, update }),
  });

  const narrator = new TelegramNarrator(RETRY_CONFIG, {
    sendOnce: async (text, replyToMessageId) => {
      const messageId = nextMessageId++;
      sent.push({ text, replyToMessageId, messageId });
      return { success: true, messageId };
    },
    onSendResult: (event, result) => {
      if (event.kind === 'gate' && event.role && result.success && result.messageId !== undefined) {
        relay.recordGatePrompt(result.messageId, event.role);
      }
    },
    wait: async () => {},
  });

  return { narrator, relay, sent, relayed, rejected };
}

function mkHandoffMailbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-telegram-mailbox-'));
  fs.writeFileSync(
    path.join(dir, 'existing.handoff'),
    'TYPE: git_handoff\nFROM: coder\nTO: cleaner\nPRIORITY: 50\nTASK: BL-1\nPAYLOAD:\nx\n'
  );
  return dir;
}

function listDirState(dir) {
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => `${name}:${fs.readFileSync(path.join(dir, name), 'utf8')}`);
}

function registerSteps(registry) {
  registry.define(
    /^a run whose events are in the on-disk message store, projected by the bridge to a Telegram bot$/,
    (ctx) => {
      Object.assign(ctx, wireAdapter());
    }
  );

  // ── per-run-thread-narrates-01 ──────────────────────────────────────────
  registry.define(/^a run in progress$/, (ctx) => {
    // Establishes the "before" narrated state (idle, no gate, no dead
    // letter, no PR) so the When step's snapshot has something to diff
    // against and actually produce transition events.
    ctx.baselineSnapshot = snapshot({
      pipeline: [{ role: 'coder', status: 'active' }],
      gates: [{ role: 'coder', gated: false }],
      deadLetters: [],
    });
  });

  registry.define(/^stage transitions, gates, dead-letters, and the final PR link occur$/, async (ctx) => {
    const now = Date.now();
    await ctx.narrator.sweep(ctx.baselineSnapshot, now);
    await ctx.narrator.sweep(
      snapshot({
        pipeline: [{ role: 'coder', status: 'idle' }],
        gates: [{ role: 'coder', gated: true, snippet: 'Merge now? (y/n)' }],
        deadLetters: [{ role: 'cleaner', filePath: '/x/y.handoff.dead', chaseCount: 3 }],
        prUrl: 'https://example.com/pr/1',
      }),
      now + 1000
    );
  });

  registry.define(/^the bot posts each of them to that run's single Telegram thread$/, (ctx) => {
    if (ctx.sent.length !== 4) {
      throw new Error(`expected exactly 4 narrated messages (transition, gate, dead-letter, PR link), got: ${JSON.stringify(ctx.sent)}`);
    }
    const kinds = [/active -> idle/, /needs you/, /dead-letter for/, /PR ready:/];
    kinds.forEach((pattern, i) => {
      if (!pattern.test(ctx.sent[i].text)) {
        throw new Error(`expected message ${i} to match ${pattern}, got: "${ctx.sent[i].text}"`);
      }
    });
    const rootId = ctx.sent[0].messageId;
    if (ctx.sent[0].replyToMessageId !== undefined) {
      throw new Error('the first narrated message must start a new thread (no reply target)');
    }
    for (let i = 1; i < ctx.sent.length; i++) {
      if (ctx.sent[i].replyToMessageId !== rootId) {
        throw new Error(`expected message ${i} to reply into the run's single thread root ${rootId}, got: ${ctx.sent[i].replyToMessageId}`);
      }
    }
  });

  // ── human-reply-answers-gate-02 ──────────────────────────────────────────
  registry.define(/^the bot posted a to-human gate prompt in the thread$/, async (ctx) => {
    await ctx.narrator.sweep(snapshot({ gates: [{ role: 'coder', gated: false }] }), Date.now());
    await ctx.narrator.sweep(
      snapshot({ gates: [{ role: 'coder', gated: true, snippet: 'Merge now? (y/n)' }] }),
      Date.now() + 1000
    );
    ctx.gatePromptMessageId = ctx.sent[ctx.sent.length - 1].messageId;
  });

  registry.define(/^the human replies to that prompt in Telegram$/, (ctx) => {
    ctx.relay.handleUpdate({
      update_id: 1,
      message: {
        message_id: 900,
        chat: { id: Number(AUTHORIZED_CHAT_ID) },
        text: 'y',
        reply_to_message: { message_id: ctx.gatePromptMessageId },
      },
    });
  });

  registry.define(/^the reply is turned into an answer for that gate and the pipeline unblocks$/, (ctx) => {
    if (ctx.relayed.length !== 1) {
      throw new Error(`expected exactly one relayed gate answer, got: ${JSON.stringify(ctx.relayed)}`);
    }
    const [relayed] = ctx.relayed;
    if (relayed.role !== 'coder' || relayed.answer !== 'y' || !relayed.result.success) {
      throw new Error(`expected a successful answer for coder, got: ${JSON.stringify(relayed)}`);
    }
  });

  // ── human-only-not-agent-bus-03 ──────────────────────────────────────────
  registry.define(/^agents coordinating through the on-disk message store$/, (ctx) => {
    ctx.mailboxDir = mkHandoffMailbox();
    ctx.mailboxBefore = listDirState(ctx.mailboxDir);
  });

  registry.define(/^the chat adapter runs$/, async (ctx) => {
    await ctx.narrator.sweep(snapshot({ gates: [{ role: 'coder', gated: false }] }), Date.now());
    await ctx.narrator.sweep(
      snapshot({
        pipeline: [{ role: 'coder', status: 'idle' }],
        gates: [{ role: 'coder', gated: true, snippet: 'Merge now? (y/n)' }],
        deadLetters: [{ role: 'cleaner', filePath: '/x/y.handoff.dead', chaseCount: 3 }],
        prUrl: 'https://example.com/pr/1',
      }),
      Date.now() + 1000
    );
    const gateMessageId = ctx.sent[ctx.sent.length - 3].messageId;
    ctx.relay.handleUpdate({
      update_id: 1,
      message: {
        message_id: 901,
        chat: { id: Number(AUTHORIZED_CHAT_ID) },
        text: 'y',
        reply_to_message: { message_id: gateMessageId },
      },
    });
  });

  registry.define(/^it only projects store events outward and relays human replies inward$/, (ctx) => {
    if (ctx.sent.length === 0) {
      throw new Error('expected the adapter to have projected at least one store event outward');
    }
    if (ctx.relayed.length !== 1) {
      throw new Error('expected the one human reply to have been relayed inward as a gate answer');
    }
    const rawHandoffPattern = /\bFROM:|\bTO:|\bTYPE:\s*git_handoff|\.handoff\b/;
    for (const message of ctx.sent) {
      if (rawHandoffPattern.test(message.text)) {
        throw new Error(`a narrated message must never echo raw handoff-store content, got: "${message.text}"`);
      }
    }
  });

  registry.define(/^no agent-to-agent handoff is routed through Telegram$/, (ctx) => {
    const mailboxAfter = listDirState(ctx.mailboxDir);
    if (JSON.stringify(mailboxAfter) !== JSON.stringify(ctx.mailboxBefore)) {
      throw new Error('the on-disk handoff mailbox must be untouched by driving the chat adapter - it is not a coordination channel');
    }
  });

  // ── controls-out-of-scope-04 ─────────────────────────────────────────────
  registry.define(/^the operator's remote scope is answer captured gates only$/, () => {
    // Documents the precondition (matches BL-240's own operator-confirmed
    // scope) - nothing to fix up, TelegramInboundRelay has no wider surface
    // than answerGate to begin with (see telegramAdapterComposition.test.js
    // and telegramInboundRelay.test.js's own adapter-surface assertion).
  });

  registry.define(/^a human sends a stop, respawn, or arbitrary command in the thread$/, (ctx) => {
    ctx.relay.handleUpdate({
      update_id: 1,
      message: { message_id: 902, chat: { id: Number(AUTHORIZED_CHAT_ID) }, text: '/stop' },
    });
    ctx.relay.handleUpdate({
      update_id: 2,
      message: { message_id: 903, chat: { id: Number(AUTHORIZED_CHAT_ID) }, text: '/respawn coder' },
    });
  });

  registry.define(/^it is not executed and only gate answers are accepted inbound$/, (ctx) => {
    if (ctx.relayed.length !== 0) {
      throw new Error(`expected no command to have been executed/relayed, got: ${JSON.stringify(ctx.relayed)}`);
    }
    if (ctx.rejected.length !== 2) {
      throw new Error(`expected both commands to be rejected, got: ${JSON.stringify(ctx.rejected)}`);
    }
  });
}

module.exports = { registerSteps };
