const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridge } = require('../out/bridge/bridgeServer');
const { catchUpReadStatePath } = require('../out/bridge/catchUpReadState');

const TOKEN = 'test-token-123';
const NOW = 1_700_000_000_000;

function mkTmp() {
  return mkTmpDir('sfvc-catch-up-bridge-');
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeTopicRecord(targetPath, id, messages) {
  const dir = path.join(targetPath, 'backlog', 'topics');
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, messages }));
}

function withBridge(targetPath, opts, fn) {
  return startBridge(targetPath, path.join(targetPath, 'runs.jsonl'), TOKEN, opts).then(async (handle) => {
    try {
      return await fn(handle);
    } finally {
      handle.stop();
    }
  });
}

function controlAuthHeaders(token = TOKEN) {
  return { authorization: `Bearer ${token}`, 'x-control-token': token };
}

test('catch-up JSON feed: empty state when there are no unread agent messages', async () => {
  const target = mkTmp();
  await withBridge(target, { nowMs: NOW }, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/catch-up-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { items: [], total: 0 });
  });
});

test('catch-up JSON feed: returns unread outbound messages oldest-first', async () => {
  const target = mkTmp();
  writeTopicRecord(target, 'BL-501', [
    { seq: 0, ts: NOW - 2000, author: 'swarm', type: 'outbound', text: 'older update' },
    { seq: 1, ts: NOW - 1000, author: 'QA', type: 'outbound', text: 'newer update' },
    { seq: 2, ts: NOW, author: 'human', type: 'inbound', text: 'ignored inbound' },
  ]);

  await withBridge(target, { nowMs: NOW }, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/catch-up-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.deepEqual(body.items.map((i) => i.text), ['older update', 'newer update']);
    assert.equal(body.items[1].topicLabel, 'BL-501');
    assert.equal(body.items[1].author, 'QA');
    assert.equal(body.items[1].agoLabel, 'just now');
  });
});

test('catch-up Mini App shell is served without auth and includes UI markers', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/catch-up`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /Catch up/);
    assert.match(body, /All caught up/);
    assert.match(body, /catch-up-state/);
    assert.match(body, /catch-up\/mark-read/);
    assert.match(body, /Mark as read/);
    assert.match(body, /Keep as unread/);
  });
});

test('catch-up JSON feed accepts query-token auth', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const resWithToken = await fetch(`http://127.0.0.1:${handle.port}/catch-up-state?token=${TOKEN}`);
    assert.equal(resWithToken.status, 200);

    const resWithoutToken = await fetch(`http://127.0.0.1:${handle.port}/catch-up-state`);
    assert.equal(resWithoutToken.status, 401);
  });
});

test('catch-up mark-read route requires control auth', async () => {
  const target = mkTmp();
  writeTopicRecord(target, 'BL-510', [
    { seq: 0, ts: NOW, author: 'swarm', type: 'outbound', text: 'hello' },
  ]);

  await withBridge(target, { nowMs: NOW }, async (handle) => {
    const bearerOnlyRes = await fetch(`http://127.0.0.1:${handle.port}/catch-up/mark-read`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ topicId: 'BL-510', seq: 0 }),
    });
    assert.equal(bearerOnlyRes.status, 403);

    const okRes = await fetch(`http://127.0.0.1:${handle.port}/catch-up/mark-read`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ topicId: 'BL-510', seq: 0 }),
    });
    assert.equal(okRes.status, 200);
    const body = await okRes.json();
    assert.deepEqual(body, { success: true, topicId: 'BL-510', seq: 0 });

    const stateRes = await fetch(`http://127.0.0.1:${handle.port}/catch-up-state?token=${TOKEN}`);
    const state = await stateRes.json();
    assert.deepEqual(state, { items: [], total: 0 });
    assert.match(fs.readFileSync(catchUpReadStatePath(target), 'utf8'), /BL-510:0/);
  });
});

test('console menu includes the Catch up button', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/console`);
    const body = await res.text();
    assert.match(body, /Catch up/);
    assert.match(body, /catch-up/);
  });
});
