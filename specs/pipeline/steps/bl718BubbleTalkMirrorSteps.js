'use strict';

// BL-718: Bubble talk mirror chunks long replies and fails loudly.
// Drives the REAL mirrorLetsTalkTurnToBubble + splitTelegramChunks from the
// compiled extension — same posture as extension/test/letsTalkBridge.test.js.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  mirrorLetsTalkTurnToBubble,
} = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { splitTelegramChunks } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgeCore'));
const { processLetsTalkTurn } = require(path.join(EXT_DIR, 'out', 'bridge', 'letsTalkRoutes'));
const { createMockCursorBridgeAgentSession } = require(path.join(EXT_DIR, 'out', 'bridge', 'cursorBridgeAgentSession'));

const FEATURE = 'Bubble talk mirror chunks long replies and fails loudly';
const BUBBLE_TOPIC_ID = 91;
const CURSOR_TOPIC_ID = 9;
const STATE_REL = '.swarmforge/operator/cursor-bridge-state.json';

const FAILURE_ERRORS = {
  'a Telegram API error': 'Telegram API error: 400 bad request',
  'a network error': 'network error: ECONNRESET',
};

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl718-'));
}

function writeBridgeState(root) {
  const dir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'cursor-bridge-state.json'),
    `${JSON.stringify({ updateOffset: 0, cursorTopicId: CURSOR_TOPIC_ID, bubbleTopicId: BUBBLE_TOPIC_ID }, null, 2)}\n`,
    'utf8'
  );
}

function ensureCtx(ctx) {
  if (!ctx.root) {
    ctx.root = mkFixtureRoot();
    writeBridgeState(ctx.root);
  }
  ctx.sent = ctx.sent || [];
  ctx.polls = ctx.polls || [];
  ctx.splitCalls = ctx.splitCalls || [];
  return ctx;
}

async function withTelegramEnv(fn) {
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = '12345';
  try {
    return await fn();
  } finally {
    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = prevChat;
  }
}

function mirrorDeps(ctx) {
  return {
    splitChunks: (text) => {
      ctx.splitCalls.push(text);
      return splitTelegramChunks(text);
    },
    sendMessage: ctx.sendMessageImpl || (async (_t, _c, text, _r, _p, topicId) => {
      ctx.sent.push({ text, topicId });
      return { success: true, messageId: ctx.sent.length };
    }),
    sendPoll: ctx.sendPollImpl || (async (_t, _c, question, options, topicId) => {
      ctx.polls.push({ question, options, topicId });
      return { success: true, pollId: `poll-${ctx.polls.length}` };
    }),
  };
}

async function runMirror(ctx, transcript, replyText) {
  ensureCtx(ctx);
  ctx.lastTranscript = transcript;
  ctx.lastReply = replyText;
  await withTelegramEnv(async () => {
    await mirrorLetsTalkTurnToBubble(ctx.root, transcript, replyText, mirrorDeps(ctx));
  });
}

function readMirrorFailureEvents(root) {
  const eventsPath = path.join(root, '.swarmforge', 'operator', 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    return [];
  }
  return fs
    .readFileSync(eventsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === 'bubble-talk-mirror-failed');
}

function assertBubbleOnly(ctx) {
  if (ctx.sent.some((s) => s.topicId === CURSOR_TOPIC_ID)) {
    throw new Error('Cursor Remote topic must not receive the ordinary talk dump');
  }
  if (!ctx.sent.every((s) => s.topicId === BUBBLE_TOPIC_ID)) {
    throw new Error(`expected Bubble topic ${BUBBLE_TOPIC_ID}, got: ${JSON.stringify(ctx.sent)}`);
  }
}

function registerSteps(registry) {
  scoped(registry, /^the standing Bubble Telegram topic is bound$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(registry, /^the bridge mirrors successful Let's Talk turns into that topic$/, () => {
    if (typeof mirrorLetsTalkTurnToBubble !== 'function') {
      throw new Error('expected mirrorLetsTalkTurnToBubble from compiled bridgeServer');
    }
  });

  scoped(registry, /^a Let's Talk turn completes with a short reply$/, async (ctx) => {
    await runMirror(ctx, 'hi', 'hello there');
  });

  scoped(registry, /^the Bubble topic receives the transcript as You and Bubble text$/, (ctx) => {
    assertBubbleOnly(ctx);
    const body = ctx.sent.map((s) => s.text).join('');
    const you = ctx.lastTranscript || 'hi';
    const agent = ctx.lastReply || 'hello there';
    if (!body.startsWith(`You: ${you}`) || !body.includes(`Bubble: ${agent}`)) {
      throw new Error(`expected You/Bubble transcript for "${you}" / "${agent}", got: ${JSON.stringify(body)}`);
    }
  });

  scoped(registry, /^the Cursor Remote topic does not receive that ordinary talk dump$/, (ctx) => {
    assertBubbleOnly(ctx);
  });

  scoped(registry, /^a Let's Talk turn completes with a reply longer than one Telegram message$/, async (ctx) => {
    ctx.longReply = 'x'.repeat(5000);
    await runMirror(ctx, 'ask', ctx.longReply);
  });

  scoped(registry, /^the Bubble topic receives every part of the reply as ordered chunks$/, (ctx) => {
    assertBubbleOnly(ctx);
    if (ctx.sent.length < 2) {
      throw new Error(`expected multiple ordered chunks, got ${ctx.sent.length}`);
    }
    const reassembled = ctx.sent.map((s) => s.text).join('');
    if (!/^You: ask/.test(reassembled) || !reassembled.includes(ctx.longReply)) {
      throw new Error('reassembled chunks lost transcript or reply text');
    }
    if (!ctx.sent.every((s) => s.text.length <= 4096)) {
      throw new Error('a chunk exceeded Telegram max length');
    }
  });

  scoped(
    registry,
    /^the mirror splits the text with the shared chunker the Cursor Remote path uses$/,
    (ctx) => {
      if (ctx.splitCalls.length !== 1) {
        throw new Error(`expected one splitTelegramChunks call, got ${ctx.splitCalls.length}`);
      }
    }
  );

  scoped(registry, /^the Bubble topic mirror send fails with (.+)$/, (ctx, failure) => {
    ensureCtx(ctx);
    const err = FAILURE_ERRORS[failure];
    if (!err) {
      throw new Error(`unknown failure example: "${failure}"`);
    }
    ctx.sendMessageImpl = async () => ({ success: false, error: err });
  });

  scoped(registry, /^the retry budget for that send is exhausted$/, async (ctx) => {
    await runMirror(ctx, 'hi', 'hello');
  });

  scoped(registry, /^the mirror failure is surfaced to the operator$/, (ctx) => {
    const events = readMirrorFailureEvents(ctx.root);
    if (events.length === 0) {
      throw new Error('expected bubble-talk-mirror-failed operator event');
    }
    if (events[0].topicId !== BUBBLE_TOPIC_ID) {
      throw new Error(`expected failure on topic ${BUBBLE_TOPIC_ID}, got ${JSON.stringify(events[0])}`);
    }
  });

  scoped(registry, /^the turn is not recorded as having delivered a transcript$/, (ctx) => {
    if (ctx.sent.length !== 0) {
      throw new Error('expected no successful mirror delivery when send failed');
    }
  });

  scoped(registry, /^a Let's Talk reply contains a choice poll$/, async (ctx) => {
    ctx.pollReply = 'Pick one:\n1) Alpha\n2) Beta';
    await runMirror(ctx, 'choose', ctx.pollReply);
  });

  scoped(registry, /^the poll is still mirrored into the Bubble topic$/, (ctx) => {
    if (ctx.polls.length !== 1 || ctx.polls[0].topicId !== BUBBLE_TOPIC_ID) {
      throw new Error(`expected one poll on Bubble topic, got: ${JSON.stringify(ctx.polls)}`);
    }
    if (!ctx.polls[0].options.includes('Alpha') || !ctx.polls[0].options.includes('Beta')) {
      throw new Error(`unexpected poll options: ${JSON.stringify(ctx.polls[0].options)}`);
    }
  });

  scoped(registry, /^the human's Let's Talk turn otherwise succeeded$/, async (ctx) => {
    ensureCtx(ctx);
    const session = createMockCursorBridgeAgentSession(ctx.root);
    session.promptAgent = async () => ({ replyText: 'spoken answer', agentId: 'agent-1' });
    ctx.turnResult = await processLetsTalkTurn(
      { text: 'question' },
      {
        agentSession: session,
        clientTts: true,
        onTurnSuccess: async (turn) => {
          await mirrorLetsTalkTurnToBubble(ctx.root, turn.transcript, turn.replyText, mirrorDeps(ctx));
        },
      }
    );
  });

  scoped(registry, /^the human still receives the spoken reply$/, (ctx) => {
    if (!ctx.turnResult?.success || ctx.turnResult.replyText !== 'spoken answer') {
      throw new Error(`expected successful phone turn, got: ${JSON.stringify(ctx.turnResult)}`);
    }
  });

  scoped(registry, /^the mirror failure is reported on its own channel$/, (ctx) => {
    const events = readMirrorFailureEvents(ctx.root);
    if (events.length === 0) {
      throw new Error('expected mirror failure on operator events channel');
    }
    if (ctx.turnResult?.success !== true) {
      throw new Error('phone turn must stay successful when mirror fails');
    }
  });
}

module.exports = { registerSteps };
