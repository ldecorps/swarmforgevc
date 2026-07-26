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

    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-601.yaml');
    const original = fs.readFileSync(pausedPath, 'utf8');
    assert.match(original, /^priority:\s*20$/m);
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

  const p700 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-700.yaml'), 'utf8');
  const p701 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-701.yaml'), 'utf8');
  const p702 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-702.yaml'), 'utf8');
  assert.match(p700, /^priority:\s*20$/m);
  assert.match(p701, /^priority:\s*10$/m);
  assert.match(p702, /^priority:\s*30$/m);

  const status = execFileSync('git', ['status', '--porcelain', '--', 'backlog'], { cwd: target, encoding: 'utf8' });
  assert.equal(status.trim(), '', 'both changed backlog files should be committed, leaving backlog/ clean');

  const log = execFileSync('git', ['log', '-1', '--format=%s', '--', 'backlog/paused/BL-700.yaml'], {
    cwd: target,
    encoding: 'utf8',
  });
  assert.match(log, /BL-700/);
  assert.match(log, /BL-701/);
});

test('epic-reorder move route: adjacent epics sharing one priority value still reorder strictly (scenario 02)', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'BL-710', 20);
  writeEpic(target, 'BL-711', 20);
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

  const above = Number(fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-710.yaml'), 'utf8').match(/^priority:\s*(\d+)$/m)[1]);
  const moved = Number(fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-711.yaml'), 'utf8').match(/^priority:\s*(\d+)$/m)[1]);
  assert.ok(moved < above, `expected moved (${moved}) < above (${above})`);
});

test('epic-reorder move route: moving the first-priority epic up changes nothing (scenario 03)', async () => {
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
