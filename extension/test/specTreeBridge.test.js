const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridge } = require('../out/bridge/bridgeServer');

// BL-592 hardening: `isSpecTreePath`/`isSpecTreeStatePath` and their entries
// in QUERY_TOKEN_ELIGIBLE_PATHS + buildJsonRoutes are required_wiring the
// architect verified by READING the source - but nothing anywhere calls the
// real startBridge() and hits these routes over real HTTP. A mutant in the
// path string, the auth wiring, or the compute() wiring would go completely
// undetected. Same withBridge/fetch-against-a-real-port pattern as
// epicReorderBridge.test.js beside it.

const TOKEN = 'test-token-123';

function mkTmp() {
  return mkTmpDir('sfvc-spec-tree-bridge-');
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeTicket(targetPath, folder, id, extraFields) {
  const dir = path.join(targetPath, 'backlog', folder);
  mkdirp(dir);
  const lines = [`id: ${id}`, `title: ${id} title`, ...extraFields];
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `${lines.join('\n')}\n`);
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

test('spec-tree JSON feed: serves computeDocsTree output over the bridge, epic-grouped', async () => {
  const target = mkTmp();
  writeTicket(target, 'active', 'BL-592', ['status: active', 'milestone: M8', 'epic: swarmforge-console']);
  writeTicket(target, 'active', 'BL-100', ['status: active', 'milestone: M8']);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/spec-tree-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.schemaVersion, 2);
    const m8 = body.milestones.find((m) => m.milestone === 'M8');
    assert.ok(m8, 'expected an M8 milestone in the live tree');
    const consoleEpic = m8.epics.find((e) => e.epicKey === 'swarmforge-console');
    const noEpic = m8.epics.find((e) => e.epicKey === '(no epic)');
    assert.deepEqual(consoleEpic.tickets.map((t) => t.id), ['BL-592']);
    assert.deepEqual(noEpic.tickets.map((t) => t.id), ['BL-100']);
  });
});

test('spec-tree JSON feed requires auth (401 without a token, 200 with query-token)', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const withToken = await fetch(`http://127.0.0.1:${handle.port}/spec-tree-state?token=${TOKEN}`);
    assert.equal(withToken.status, 200);
    const withoutToken = await fetch(`http://127.0.0.1:${handle.port}/spec-tree-state`);
    assert.equal(withoutToken.status, 401);
  });
});

test('spec-tree Mini App shell is served without auth and includes basic UI markers', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/spec-tree`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /spec-tree-state/);
  });
});

test('BL-1412: ?q= narrows the served tree to matching tickets; the same request without q returns the full tree', async () => {
  const target = mkTmp();
  writeTicket(target, 'active', 'BL-592', ['status: active', 'milestone: M8', 'epic: swarmforge-console']);
  writeTicket(target, 'active', 'BL-100', ['status: active', 'milestone: M9']);

  await withBridge(target, {}, async (handle) => {
    const full = await fetch(`http://127.0.0.1:${handle.port}/spec-tree-state?token=${TOKEN}`);
    const fullBody = await full.json();
    assert.deepEqual(fullBody.tickets.map((t) => t.id).sort(), ['BL-100', 'BL-592']);

    const filtered = await fetch(`http://127.0.0.1:${handle.port}/spec-tree-state?token=${TOKEN}&q=BL-592+title`);
    assert.equal(filtered.status, 200);
    const filteredBody = await filtered.json();
    assert.equal(filteredBody.schemaVersion, 2);
    assert.deepEqual(filteredBody.tickets.map((t) => t.id), ['BL-592']);
    assert.deepEqual(filteredBody.milestones.map((m) => m.milestone), ['M8']);
  });
});

test('console menu links to the spec tree screen', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/console`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Spec tree/);
    assert.match(body, /\/spec-tree/);
  });
});
