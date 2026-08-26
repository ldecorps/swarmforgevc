'use strict';

// BL-391: step handlers for "The human is never sent raw terminal output".
// Drives the REAL compiled boundary end to end: a raw tmux pane capture ->
// computeRoleGateStates/extractQuestionSnippet (gateSnapshot.ts,
// needsHumanDetection.ts) -> a NeedsApproval SwarmEvent's own payload.snippet
// -> messageTextForEvent/routeEvent (topicRouter.ts) -> the adapters that
// actually deliver to Telegram and record into the ticket's topic. Uses the
// REAL committed backlog/topics/BL-359.json seq-1 text - the human's own
// "can you make these messages more readable?" fixture - never a
// hand-rolled substitute, per the ticket's own E2E procedure.
const path = require('node:path');
const fs = require('node:fs');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { computeRoleGateStates } = require(path.join(EXT_OUT, 'bridge', 'gateSnapshot'));
const { routeEvent } = require(path.join(EXT_OUT, 'concierge', 'topicRouter'));

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BL_359_RECORD = path.join(REPO_ROOT, 'backlog', 'topics', 'BL-359.json');

function realAnsiPaneText() {
  const record = JSON.parse(fs.readFileSync(BL_359_RECORD, 'utf8'));
  const seq1 = record.messages.find((m) => m.seq === 1);
  if (!seq1) {
    throw new Error('expected backlog/topics/BL-359.json to still carry its real seq-1 NeedsApproval message - the ticket\'s own E2E fixture');
  }
  return seq1.text;
}

function fakeAdapters(ctx) {
  return {
    getTopicMap: () => ({ 'BL-900': 42 }),
    createTopic: async () => ({ success: false }),
    recordTopicId: () => {},
    sendMessage: async (topicId, text) => {
      ctx.sentText = text;
      return true;
    },
    closeTopic: async () => true,
    recordMessage: (backlogId, text) => {
      ctx.recordedText = text;
    },
    ensureOperatorTopic: async () => undefined,
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the swarm has something to tell the human$/, (ctx) => {
    ctx.sentText = undefined;
    ctx.recordedText = undefined;
  });

  // ── the-human-is-never-sent-terminal-chrome-01/02/03 ─────────────────
  registry.define(/^the message was scraped from an agent's terminal$/, (ctx) => {
    const paneText = realAnsiPaneText();
    if (!/\x1b\[/.test(paneText)) {
      throw new Error('fixture bug: expected the real BL-359 seq-1 fixture to actually contain raw ANSI escape codes');
    }
    const [gateState] = computeRoleGateStates(['coder'], () => paneText);
    ctx.event = { type: 'NeedsApproval', backlogId: 'BL-900', payload: gateState.snippet ? { snippet: gateState.snippet } : {} };
  });

  // ── the-human-is-never-sent-terminal-chrome-04 ───────────────────────
  registry.define(/^the message was written as plain prose$/, (ctx) => {
    ctx.plainText = 'Ready to deploy BL-900. Approve this change? (y/n)';
    // An ordinary swarm-authored snippet - never pane-scraped - so it must
    // reach the human byte-identical (the neighbour guard this scenario
    // exists to prove: chrome-stripping must never touch normal prose).
    ctx.event = { type: 'NeedsApproval', backlogId: 'BL-900', payload: { snippet: ctx.plainText } };
  });

  // ── shared When: "the swarm sends it to the human" ───────────────────
  registry.define(/^the swarm sends it to the human$/, async (ctx) => {
    await routeEvent(ctx.event, 'a title', fakeAdapters(ctx));
    if (ctx.sentText === undefined) {
      throw new Error('expected routeEvent to have sent a message to the human');
    }
  });

  // ── the-human-is-never-sent-terminal-chrome-03 ───────────────────────
  registry.define(/^the swarm records it against the ticket$/, async (ctx) => {
    await routeEvent(ctx.event, 'a title', fakeAdapters(ctx));
    if (ctx.recordedText === undefined) {
      throw new Error('expected routeEvent to have recorded a message against the ticket');
    }
  });

  // ── the-human-is-never-sent-terminal-chrome-01 ───────────────────────
  registry.define(/^the human is sent no terminal escape codes$/, (ctx) => {
    if (/\x1b/.test(ctx.sentText)) {
      throw new Error(`expected no raw ESC byte in the text sent to the human, got: ${JSON.stringify(ctx.sentText)}`);
    }
  });

  // ── the-human-is-never-sent-terminal-chrome-02 ───────────────────────
  registry.define(/^the human is sent the readable text that was inside it$/, (ctx) => {
    if (!ctx.sentText.startsWith('NeedsApproval: BL-900')) {
      throw new Error(`expected the readable "NeedsApproval: BL-900 ..." content to survive sanitisation, got: ${JSON.stringify(ctx.sentText)}`);
    }
  });

  // ── the-human-is-never-sent-terminal-chrome-03 ───────────────────────
  registry.define(/^the recorded message carries no terminal escape codes$/, (ctx) => {
    if (/\x1b/.test(ctx.recordedText)) {
      throw new Error(`expected no raw ESC byte in the recorded message, got: ${JSON.stringify(ctx.recordedText)}`);
    }
  });

  // ── the-human-is-never-sent-terminal-chrome-04 ───────────────────────
  registry.define(/^the human is sent that message unchanged$/, (ctx) => {
    const expected = `NeedsApproval: BL-900 - ${ctx.plainText}`;
    if (ctx.sentText !== expected) {
      throw new Error(`expected the ordinary prose message to arrive byte-identical, got: ${JSON.stringify(ctx.sentText)} want: ${JSON.stringify(expected)}`);
    }
  });
}

module.exports = { registerSteps };
