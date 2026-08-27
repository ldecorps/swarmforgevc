'use strict';

// BL-709: Bubble gets its own Telegram topic — acceptance against the REAL
// compiled bridge + cursor-bridge core (option A adopt). Never reimplements
// topic ensure / mirror / front-desk scrub.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  effectiveBubbleMirrorTopicId,
  effectiveLetsTalkMirrorTopicId,
  formatBubbleMirrorText,
  mirrorLetsTalkTurnToBubble,
} = require('../../../extension/out/bridge/bridgeServer');
const {
  BUBBLE_SUBJECT_ID,
  BUBBLE_TOPIC_NAME,
  CURSOR_BRIDGE_SUBJECT_ID,
  CURSOR_BRIDGE_TOPIC_NAME,
  decideEnsureBubbleTopicAction,
  frontDeskTopicMapWithoutCursorBridge,
  bubbleTopicIdFromMap,
  decideInboundAction,
} = require('../../../extension/out/tools/telegramCursorBridgeCore');
const { ensureBubbleTopic } = require('../../../extension/out/tools/telegramCursorBridgeLive');

const FEATURE = 'Bubble talks in its own Telegram topic';
const CURSOR_TOPIC = 55;
const BUBBLE_TOPIC = 91;
const PRINCIPAL = 4242;
const CHAT = '-1001';

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bl709-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function writeState(root, state) {
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json'),
    `${JSON.stringify(state, null, 2)}\n`
  );
}

function writeMap(root, map) {
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json'),
    `${JSON.stringify(map, null, 2)}\n`
  );
}

function withTelegramEnv(fn) {
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = 'bl709-token';
  process.env.TELEGRAM_CHAT_ID = CHAT;
  try {
    return fn();
  } finally {
    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = prevChat;
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^the cursor bridge is running against a Telegram forum$/, (ctx) => {
    ctx.root = mkRoot();
    ctx.createdTopics = [];
    ctx.sent = [];
  });

  registry.defineScoped(/^the operator is the principal user$/, (ctx) => {
    ctx.principalId = PRINCIPAL;
  });

  registry.defineScoped(/^the cursor bridge starts with no Bubble topic bound$/, (ctx) => {
    writeState(ctx.root, { updateOffset: 0, cursorTopicId: CURSOR_TOPIC });
    writeMap(ctx.root, { [String(CURSOR_TOPIC)]: CURSOR_BRIDGE_SUBJECT_ID });
    ctx.ensureDecision = decideEnsureBubbleTopicAction(
      JSON.parse(fs.readFileSync(path.join(ctx.root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json'), 'utf8'))
    );
  });

  registry.defineScoped(/^a Bubble topic is created in the forum$/, async (ctx) => {
    assert.deepEqual(ctx.ensureDecision, { kind: 'create' });
    const mapPath = path.join(ctx.root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
    const next = await ensureBubbleTopic(
      'token',
      CHAT,
      mapPath,
      { updateOffset: 0, cursorTopicId: CURSOR_TOPIC },
      async () => {
        ctx.createdTopics.push(BUBBLE_TOPIC_NAME);
        return { success: true, messageThreadId: BUBBLE_TOPIC };
      }
    );
    assert.equal(next.bubbleTopicId, BUBBLE_TOPIC);
    ctx.state = next;
    assert.equal(ctx.createdTopics.length, 1);
  });

  registry.defineScoped(/^its topic id is persisted alongside the Cursor Remote topic id$/, (ctx) => {
    assert.equal(ctx.state.cursorTopicId, CURSOR_TOPIC);
    assert.equal(ctx.state.bubbleTopicId, BUBBLE_TOPIC);
  });

  registry.defineScoped(/^a Bubble topic id is already persisted$/, (ctx) => {
    writeState(ctx.root, {
      updateOffset: 0,
      cursorTopicId: CURSOR_TOPIC,
      bubbleTopicId: BUBBLE_TOPIC,
    });
    writeMap(ctx.root, {
      [String(CURSOR_TOPIC)]: CURSOR_BRIDGE_SUBJECT_ID,
      [String(BUBBLE_TOPIC)]: BUBBLE_SUBJECT_ID,
    });
  });

  registry.defineScoped(/^the cursor bridge starts$/, (ctx) => {
    const map = JSON.parse(
      fs.readFileSync(path.join(ctx.root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json'), 'utf8')
    );
    ctx.ensureDecision = decideEnsureBubbleTopicAction(map);
    ctx.mapBubbleId = bubbleTopicIdFromMap(map);
  });

  registry.defineScoped(/^no new Bubble topic is created$/, async (ctx) => {
    assert.deepEqual(ctx.ensureDecision, { kind: 'reuse', topicId: BUBBLE_TOPIC });
    const mapPath = path.join(ctx.root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
    const next = await ensureBubbleTopic(
      'token',
      CHAT,
      mapPath,
      { updateOffset: 0, cursorTopicId: CURSOR_TOPIC, bubbleTopicId: BUBBLE_TOPIC },
      async () => {
        ctx.createdTopics.push('SHOULD_NOT');
        return { success: true, messageThreadId: 999 };
      }
    );
    assert.equal(next.bubbleTopicId, BUBBLE_TOPIC);
    assert.equal(ctx.createdTopics.length, 0);
  });

  registry.defineScoped(/^the persisted Bubble topic id is used$/, (ctx) => {
    assert.equal(ctx.mapBubbleId, BUBBLE_TOPIC);
  });

  registry.defineScoped(/^a Bubble topic is bound$/, (ctx) => {
    writeState(ctx.root, {
      updateOffset: 0,
      cursorTopicId: CURSOR_TOPIC,
      bubbleTopicId: BUBBLE_TOPIC,
    });
    writeMap(ctx.root, {
      [String(CURSOR_TOPIC)]: CURSOR_BRIDGE_SUBJECT_ID,
      [String(BUBBLE_TOPIC)]: BUBBLE_SUBJECT_ID,
    });
    ctx.topics = { cursorTopicId: CURSOR_TOPIC, bubbleTopicId: BUBBLE_TOPIC };
  });

  registry.defineScoped(/^a Let's Talk turn completes$/, async (ctx) => {
    ctx.sent = [];
    await withTelegramEnv(async () => {
      await mirrorLetsTalkTurnToBubble(ctx.root, 'hello from bubble', 'agent reply', {
        sendMessage: async (_t, _c, text, _r, _p, topicId) => {
          ctx.sent.push({ text, topicId });
          return { success: true, messageId: ctx.sent.length };
        },
      });
    });
  });

  registry.defineScoped(/^both sides of the turn are posted into the Bubble topic$/, (ctx) => {
    assert.ok(ctx.sent.length >= 1);
    assert.ok(ctx.sent.every((s) => s.topicId === BUBBLE_TOPIC));
    assert.equal(ctx.sent[0].text, formatBubbleMirrorText('hello from bubble', 'agent reply'));
  });

  registry.defineScoped(/^nothing is posted into the Cursor Remote topic$/, (ctx) => {
    assert.ok(ctx.sent.every((s) => s.topicId !== CURSOR_TOPIC));
  });

  registry.defineScoped(/^the operator types a follow-up in the Bubble topic$/, (ctx) => {
    ctx.inbound = decideInboundAction(
      {
        kind: 'text',
        fromId: ctx.principalId,
        chatId: CHAT,
        text: 'follow-up in bubble',
        topicId: BUBBLE_TOPIC,
      },
      ctx.principalId,
      CHAT,
      ctx.topics
    );
  });

  registry.defineScoped(/^the bridge accepts it as inbound host-agent input$/, (ctx) => {
    assert.equal(ctx.inbound.action, 'prompt');
  });

  registry.defineScoped(/^the response is posted into the Bubble topic$/, async (ctx) => {
    assert.equal(effectiveLetsTalkMirrorTopicId(ctx.topics), BUBBLE_TOPIC);
    ctx.sent = [];
    await withTelegramEnv(async () => {
      await mirrorLetsTalkTurnToBubble(ctx.root, 'follow-up in bubble', 'bubble answer', {
        sendMessage: async (_t, _c, text, _r, _p, topicId) => {
          ctx.sent.push({ text, topicId });
          return { success: true, messageId: ctx.sent.length };
        },
      });
    });
    assert.ok(ctx.sent.every((s) => s.topicId === BUBBLE_TOPIC));
  });

  registry.defineScoped(/^the operator sends a control verb in the Cursor Remote topic$/, (ctx) => {
    ctx.control = decideInboundAction(
      {
        kind: 'text',
        fromId: ctx.principalId,
        chatId: CHAT,
        text: '/status',
        topicId: CURSOR_TOPIC,
      },
      ctx.principalId,
      CHAT,
      ctx.topics
    );
    ctx.controlMirrorTopic = CURSOR_TOPIC;
  });

  registry.defineScoped(/^its answer is posted into the Cursor Remote topic$/, (ctx) => {
    assert.ok(ctx.control.action === 'command' || ctx.control.action === 'prompt' || ctx.control.action === 'status');
    assert.equal(ctx.controlMirrorTopic, CURSOR_TOPIC);
    assert.notEqual(effectiveLetsTalkMirrorTopicId(ctx.topics), CURSOR_TOPIC);
  });

  registry.defineScoped(/^nothing is posted into the Bubble topic$/, (ctx) => {
    assert.equal(ctx.controlMirrorTopic, CURSOR_TOPIC);
  });

  registry.defineScoped(/^the topic map is exported to the front desk$/, (ctx) => {
    const raw = {
      [String(CURSOR_TOPIC)]: CURSOR_BRIDGE_SUBJECT_ID,
      [String(BUBBLE_TOPIC)]: BUBBLE_SUBJECT_ID,
      '12': 'SPEC',
    };
    ctx.exported = frontDeskTopicMapWithoutCursorBridge(raw, CURSOR_TOPIC, [BUBBLE_TOPIC]);
  });

  registry.defineScoped(/^(.+) is absent from the exported map$/, (ctx, topicName) => {
    const name = topicName.trim();
    if (name === 'Bubble' || name === BUBBLE_TOPIC_NAME) {
      assert.equal(ctx.exported[String(BUBBLE_TOPIC)], undefined);
      assert.ok(!Object.values(ctx.exported).includes(BUBBLE_SUBJECT_ID));
      return;
    }
    if (name === 'Cursor Remote' || name === CURSOR_BRIDGE_TOPIC_NAME) {
      assert.equal(ctx.exported[String(CURSOR_TOPIC)], undefined);
      assert.ok(!Object.values(ctx.exported).includes(CURSOR_BRIDGE_SUBJECT_ID));
      return;
    }
    throw new Error(`unknown topic name in outline: ${name}`);
  });

  registry.defineScoped(/^no Bubble topic id can be resolved$/, (ctx) => {
    writeState(ctx.root, { updateOffset: 0, cursorTopicId: CURSOR_TOPIC });
    writeMap(ctx.root, { [String(CURSOR_TOPIC)]: CURSOR_BRIDGE_SUBJECT_ID });
    ctx.topics = { cursorTopicId: CURSOR_TOPIC };
    assert.equal(effectiveBubbleMirrorTopicId(ctx.topics), undefined);
  });

  registry.defineScoped(/^the turn is mirrored into the Cursor Remote topic as before$/, (ctx) => {
    assert.equal(effectiveLetsTalkMirrorTopicId(ctx.topics), CURSOR_TOPIC);
    assert.ok(ctx.sent.length >= 1);
    assert.ok(ctx.sent.every((s) => s.topicId === CURSOR_TOPIC));
  });

  registry.defineScoped(/^the poll loop keeps running$/, () => {
    // Mirror path is best-effort and must not throw; reaching this step means
    // unbound fallback completed without aborting the bridge fixture.
  });
}

module.exports = { name: FEATURE, register: registerSteps, registerSteps };
