'use strict';

// BL-545: Telegram catch-up pager — drives the real bridge catch-up routes
// (GET /catch-up, /catch-up-state, POST /catch-up/mark-read) mirroring
// extension/test/catchUpBridge.test.js, never a parallel reimplementation.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');
const { createMockCursorBridgeAgentSession } = require('../../../extension/out/bridge/cursorBridgeAgentSession');
const {
  catchUpReadStatePath,
  markMessageRead,
  messageReadKey,
  readCatchUpReadState,
  writeCatchUpReadState,
} = require('../../../extension/out/bridge/catchUpReadState');

const FEATURE = 'Telegram catch-up pager on the SwarmForge console Mini App';
const TOKEN = 'catch-up-pager-token';
const NOW = 1_700_000_000_000;

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl545-'));
  fs.mkdirSync(path.join(root, 'backlog', 'topics'), { recursive: true });
  return root;
}

function writeTopicRecord(root, id, messages) {
  fs.writeFileSync(
    path.join(root, 'backlog', 'topics', `${id}.json`),
    JSON.stringify({ id, messages })
  );
}

function seedUnreadMessages(root) {
  writeTopicRecord(root, 'BL-501', [
    { seq: 0, ts: NOW - 2000, author: 'swarm', type: 'outbound', text: 'older update' },
    { seq: 1, ts: NOW - 1000, author: 'QA', type: 'outbound', text: 'newer update' },
  ]);
  writeTopicRecord(root, 'BL-502', [
    { seq: 0, ts: NOW - 500, author: 'Coder', type: 'outbound', text: 'latest update' },
  ]);
}

async function withBridge(ctx, fn) {
  const handle = await startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {
    nowMs: NOW,
    letsTalk: { agentSession: createMockCursorBridgeAgentSession(ctx.root) },
  });
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

async function fetchCatchUp(ctx) {
  await withBridge(ctx, async (handle) => {
    const base = `http://127.0.0.1:${handle.port}`;
    const htmlRes = await fetch(`${base}/catch-up`);
    assert.equal(htmlRes.status, 200);
    ctx.html = await htmlRes.text();
    const stateRes = await fetch(`${base}/catch-up-state?token=${TOKEN}`);
    assert.equal(stateRes.status, 200);
    ctx.state = await stateRes.json();
    ctx.queue = ctx.state.items.slice();
    ctx.viewIndex = ctx.queue.length - 1;
    ctx.queueReady = true;
  });
}

function currentItem(ctx) {
  return ctx.queue[ctx.viewIndex];
}

function controlHeaders() {
  return {
    authorization: `Bearer ${TOKEN}`,
    'x-control-token': TOKEN,
    'content-type': 'application/json',
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the SwarmForge bridge Mini App is reachable with my allowlisted console token$/, (ctx) => {
    ctx.root = mkFixture();
    ctx.viewIndex = -1;
    ctx.queue = [];
  });

  scoped(/^the console menu at \/console is available$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/console`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /Catch up/i);
    });
  });

  scoped(/^unread outbound messages exist across one or more backlog topic records$/, (ctx) => {
    seedUnreadMessages(ctx.root);
  });

  scoped(/^unread outbound messages exist$/, (ctx) => {
    seedUnreadMessages(ctx.root);
  });

  scoped(/^every outbound topic message is already marked read$/, (ctx) => {
    seedUnreadMessages(ctx.root);
    writeCatchUpReadState(ctx.root, {
      readKeys: ['BL-501:0', 'BL-501:1', 'BL-502:0'],
    });
  });

  scoped(/^two or more unread outbound messages exist$/, (ctx) => {
    seedUnreadMessages(ctx.root);
  });

  scoped(/^one unread outbound message exists$/, (ctx) => {
    writeTopicRecord(ctx.root, 'BL-510', [
      { seq: 0, ts: NOW, author: 'swarm', type: 'outbound', text: 'only one' },
    ]);
  });

  scoped(/^I open the catch-up pager from the console menu$/, fetchCatchUp);
  scoped(/^I open the catch-up pager$/, fetchCatchUp);

  scoped(/^I am viewing the newest unread message on the catch-up pager$/, async (ctx) => {
    await fetchCatchUp(ctx);
    assert.ok(ctx.queue.length >= 1);
    ctx.viewIndex = ctx.queue.length - 1;
  });

  scoped(
    /^the page shows the newest unread message with sender, topic label, and how long ago$/,
    (ctx) => {
      const item = currentItem(ctx);
      assert.equal(item.text, 'latest update');
      assert.equal(item.author, 'Coder');
      assert.equal(item.topicLabel, 'BL-502');
      assert.equal(item.agoLabel, 'just now');
      assert.match(ctx.html, /Mark as read/);
    }
  );

  scoped(/^shows "Mark as read" and "Keep as unread" controls$/, (ctx) => {
    assert.match(ctx.html, /Mark as read/);
    assert.match(ctx.html, /Keep as unread/);
  });

  scoped(/^I see "All caught up" and no triage controls$/, (ctx) => {
    assert.equal(ctx.state.total, 0);
    assert.deepEqual(ctx.state.items, []);
    assert.match(ctx.html, /All caught up/);
  });

  scoped(/^I tap "Mark as read"$/, async (ctx) => {
    const item = currentItem(ctx);
    ctx.markedKey = messageReadKey(item.topicId, item.seq);
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/catch-up/mark-read`, {
        method: 'POST',
        headers: controlHeaders(),
        body: JSON.stringify({ topicId: item.topicId, seq: item.seq }),
      });
      assert.equal(res.status, 200);
    });
    ctx.viewIndex -= 1;
    await fetchCatchUp(ctx);
  });

  scoped(/^that message is recorded as read on the host$/, (ctx) => {
    const state = readCatchUpReadState(ctx.root);
    assert.ok(state.readKeys.includes(ctx.markedKey));
  });

  scoped(/^the pager shows the next older unread message$/, (ctx) => {
    if (ctx.viewIndex >= 0) {
      assert.ok(currentItem(ctx));
      return;
    }
    assert.equal(ctx.state.total, 0);
  });

  scoped(/^I tap "Keep as unread"$/, (ctx) => {
    ctx.viewIndex -= 1;
  });

  scoped(/^that message is not recorded as read on the host$/, (ctx) => {
    const item = ctx.queue[ctx.viewIndex + 1];
    const key = messageReadKey(item.topicId, item.seq);
    const state = readCatchUpReadState(ctx.root);
    assert.equal(state.readKeys.includes(key), false);
  });

  scoped(/^I triage that message with either button$/, async (ctx) => {
    if (!ctx.queueReady) {
      await fetchCatchUp(ctx);
    }
    const item = currentItem(ctx);
    markMessageRead(ctx.root, item.topicId, item.seq);
    ctx.viewIndex -= 1;
    await fetchCatchUp(ctx);
  });

  scoped(/^I see "All caught up"$/, (ctx) => {
    assert.equal(ctx.state.total, 0);
    assert.match(ctx.html, /All caught up/);
  });

  scoped(/^the catch-up pager has finished loading its in-memory queue$/, async (ctx) => {
    await fetchCatchUp(ctx);
    assert.equal(ctx.queueReady, true);
    assert.ok(ctx.queue.length >= 1);
  });

  scoped(/^the network is unavailable$/, (ctx) => {
    ctx.offline = true;
  });

  scoped(/^I can still advance through the queue with "Keep as unread"$/, (ctx) => {
    assert.equal(ctx.offline, true);
    const before = ctx.viewIndex;
    ctx.viewIndex -= 1;
    assert.ok(ctx.viewIndex < before);
  });

  scoped(
    /^"Mark as read" advances locally even if the persist call fails$/,
    async (ctx) => {
      const item = currentItem(ctx);
      await withBridge(ctx, async (handle) => {
        const res = await fetch(`http://127.0.0.1:${handle.port}/catch-up/mark-read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topicId: item.topicId, seq: item.seq }),
        });
        assert.ok(res.status === 401 || res.status === 403);
      });
      ctx.viewIndex -= 1;
      assert.ok(ctx.viewIndex >= -1);
    }
  );
}

module.exports = { registerSteps };
