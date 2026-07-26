const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startBridge } = require('../out/bridge/bridgeServer');

const TOKEN = 'test-token-123';

function mkTmp() {
  return mkTmpDir('sfvc-epic-reorder-bridge-');
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

function writeEpic(targetPath, id, priority) {
  writeTicket(targetPath, 'paused', id, ['type: epic', `priority: ${priority}`]);
}

function readPriority(targetPath, id) {
  const content = fs.readFileSync(path.join(targetPath, 'backlog', 'paused', `${id}.yaml`), 'utf8');
  const match = content.match(/^priority:\s*(-?\d+)$/m);
  return match ? Number(match[1]) : undefined;
}

// BL-572: a real git repo + the real commit_integrity_cli.bb (and its full
// .bb dependency chain) so the "committed to main" scenario drives real git,
// never a hand-rolled substitute - same fixture shape as
// telegramFrontDeskBotCli.test.js's commitExpediteWrites tests.
function mkGitTarget() {
  const root = mkTmp();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: root });
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const repoScriptsDir = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  for (const name of fs.readdirSync(repoScriptsDir)) {
    if (name.endsWith('.bb')) {
      fs.copyFileSync(path.join(repoScriptsDir, name), path.join(scriptsDir, name));
    }
  }
  return root;
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
  return { authorization: `Bearer ${token}`, 'x-control-token': token, 'content-type': 'application/json' };
}

test('epic-reorder JSON feed: empty state when there are no paused epics', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { items: [], total: 0 });
  });
});

test('epic-reorder JSON feed: lists only type: epic paused tickets, excluding other types', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-500', 10);
  writeTicket(target, 'paused', 'BL-501', ['type: feature', 'priority: 1']);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.items.map((i) => i.id), ['BL-500']);
    assert.equal(body.total, 1);
  });
});

test('epic-reorder JSON feed: orders epics by priority ascending, then id ascending on ties', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-003', 5);
  writeEpic(target, 'BL-002', 1);
  writeEpic(target, 'BL-005', 1);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    const body = await res.json();
    assert.deepEqual(body.items.map((i) => i.id), ['BL-002', 'BL-005', 'BL-003']);
  });
});

test('epic-reorder Mini App shell is served without auth and includes basic UI markers', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /epic-reorder-state/);
    assert.match(body, /epic-reorder\/move/);
  });
});

test('console menu links to the epic reorder screen', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/console`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Reorder epics/);
    assert.match(body, /\/epic-reorder/);
  });
});

test('epic-reorder JSON feed requires auth (401 without a token, 200 with query-token)', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const withToken = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(withToken.status, 200);
    const withoutToken = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state`);
    assert.equal(withoutToken.status, 401);
  });
});

test('epic-reorder move route requires control auth (bearer-only 403, wrong token 401)', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-600', 10);
  writeEpic(target, 'BL-601', 20);

  await withBridge(target, {}, async (handle) => {
    const bearerOnly = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-601', direction: 'up' }),
    });
    assert.equal(bearerOnly.status, 403);

    const wrongToken = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders('wrong'),
      body: JSON.stringify({ id: 'BL-601', direction: 'up' }),
    });
    assert.equal(wrongToken.status, 401);

    assert.equal(readPriority(target, 'BL-601'), 20);
  });
});

test('epic-reorder move route: moving a mid-list epic up swaps exactly two backlog YAML files and commits both to main (scenario 01 + 06)', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'BL-700', 10);
  writeEpic(target, 'BL-701', 20);
  writeEpic(target, 'BL-702', 30);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed epics'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-701', direction: 'up' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.changed, true);
  });

  assert.equal(readPriority(target, 'BL-700'), 20);
  assert.equal(readPriority(target, 'BL-701'), 10);
  assert.equal(readPriority(target, 'BL-702'), 30);

  const status = execFileSync('git', ['status', '--porcelain', '--', 'backlog'], { cwd: target, encoding: 'utf8' });
  assert.equal(status.trim(), '', 'both changed backlog files should be committed, leaving backlog/ clean');

  const log = execFileSync('git', ['log', '-1', '--format=%s', '--', 'backlog/paused/BL-700.yaml'], {
    cwd: target,
    encoding: 'utf8',
  });
  assert.match(log, /BL-700/);
  assert.match(log, /BL-701/);
});

test('epic-reorder move route: adjacent epics sharing one priority value still reorder strictly and preserve everyone else\'s relative position (scenario 02)', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'BL-708', 5);
  writeEpic(target, 'BL-710', 20);
  writeEpic(target, 'BL-711', 20);
  writeEpic(target, 'BL-712', 500);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed tied epics'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-711', direction: 'up' }),
    });
    assert.equal(res.status, 200);
  });

  const above = readPriority(target, 'BL-710');
  const moved = readPriority(target, 'BL-711');
  assert.ok(moved < above, `expected moved (${moved}) < above (${above})`);
  // Every epic outside the moved pair (BL-708 before it, BL-712 after it)
  // keeps its exact original value - never touched.
  assert.equal(readPriority(target, 'BL-708'), 5);
  assert.equal(readPriority(target, 'BL-712'), 500);
});

test('epic-reorder move route: a move inside a run tied at priority 0 still reorders, extends only downward, and never goes negative (scenario 07)', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'BL-960', 0);
  writeEpic(target, 'BL-961', 0);
  writeEpic(target, 'BL-962', 0);
  writeEpic(target, 'BL-963', 0);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed four-way tied epics'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const before = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    const beforeItems = (await before.json()).items.map((i) => i.id);
    assert.deepEqual(beforeItems, ['BL-960', 'BL-961', 'BL-962', 'BL-963']);

    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-962', direction: 'up' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.changed, true);

    const after = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    const afterItems = (await after.json()).items.map((i) => i.id);
    // BL-962 shifted exactly one position higher (index 2 -> index 1); every
    // other epic keeps its exact relative order (BL-960 first, BL-963 last).
    assert.deepEqual(afterItems, ['BL-960', 'BL-962', 'BL-961', 'BL-963']);
  });

  assert.equal(readPriority(target, 'BL-960'), 0, 'the untouched epic before the pair must never be written');
  for (const id of ['BL-960', 'BL-961', 'BL-962', 'BL-963']) {
    assert.ok(readPriority(target, id) >= 0, `${id} must never carry a negative priority`);
  }
});

test('epic-reorder move route: moving the first-priority epic up changes nothing and states why (scenario 03)', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-720', 10);
  writeEpic(target, 'BL-721', 20);
  const before720 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-720.yaml'), 'utf8');
  const before721 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-721.yaml'), 'utf8');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-720', direction: 'up' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.changed, false);
    assert.equal(typeof body.reason, 'string');
    assert.ok(body.reason.length > 0, 'a boundary no-op must carry a human-readable reason');
  });

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-720.yaml'), 'utf8'), before720);
  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-721.yaml'), 'utf8'), before721);
});

test('epic-reorder move route: a reorder without control auth is refused and modifies no backlog YAML (scenario 05)', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-730', 10);
  writeEpic(target, 'BL-731', 20);
  const before = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-731.yaml'), 'utf8');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-731', direction: 'up' }),
    });
    assert.equal(res.status, 401);
  });

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-731.yaml'), 'utf8'), before);
});

test('epic-reorder move route: returns 404 and mutates nothing for an id not among the paused epics', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-740', 10);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-NOT-EXIST', direction: 'up' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
  });
});

test('epic-reorder move route: rejects a malformed body without mutating any backlog YAML', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-750', 10);
  writeEpic(target, 'BL-751', 20);
  const before = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-751.yaml'), 'utf8');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-751' }),
    });
    assert.equal(res.status, 400);
  });

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-751.yaml'), 'utf8'), before);
});
