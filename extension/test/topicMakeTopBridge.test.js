const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startBridge } = require('../out/bridge/bridgeServer');

const TOKEN = 'test-token-123';

function mkTmp() {
  return mkTmpDir('sfvc-topic-make-top-bridge-');
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

function writeTopic(targetPath, folder, id, epicSlug, priority, dependsOn) {
  const fields = ['type: feature', `epic: ${epicSlug}`, `priority: ${priority}`];
  if (dependsOn && dependsOn.length > 0) {
    fields.push(`depends_on: [${dependsOn.join(', ')}]`);
  }
  writeTicket(targetPath, folder, id, fields);
}

// BL-686: a real epic ticket's own `epic:` slug is never its `id:` (verified
// across all 15 live epic tickets at filing time) - every test below gives
// its epic ticket id ("EA"/"EB") a DIFFERENT slug ("slug-ea"/"slug-eb") that
// its topics declare, so these fixtures exercise the real id/slug split
// rather than the shape that hid BL-686 through the whole pipeline.
function writeEpic(targetPath, id, epicSlug, priority) {
  writeTicket(targetPath, 'paused', id, ['type: epic', `epic: ${epicSlug}`, `priority: ${priority}`]);
}

function readPriority(targetPath, folder, id) {
  const content = fs.readFileSync(path.join(targetPath, 'backlog', folder, `${id}.yaml`), 'utf8');
  const match = content.match(/^priority:\s*(-?\d+)$/m);
  return match ? Number(match[1]) : undefined;
}

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

async function topicMakeTop(handle, epicId, topicId) {
  const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/topic-make-top`, {
    method: 'POST',
    headers: controlAuthHeaders(),
    body: JSON.stringify({ epicId, topicId }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('topic make-top route requires control auth (bearer-only 403, wrong token 401)', async () => {
  const target = mkTmp();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeTopic(target, 'paused', 'A3', 'slug-ea', 6);

  await withBridge(target, {}, async (handle) => {
    const bearerOnly = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/topic-make-top`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ epicId: 'EA', topicId: 'A3' }),
    });
    assert.equal(bearerOnly.status, 403);

    const wrongToken = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/topic-make-top`, {
      method: 'POST',
      headers: controlAuthHeaders('wrong'),
      body: JSON.stringify({ epicId: 'EA', topicId: 'A3' }),
    });
    assert.equal(wrongToken.status, 401);

    assert.equal(readPriority(target, 'paused', 'A3'), 6);
  });
});

test('scenario 01/02: a dependency-free topic becomes the strict top of its own epic, other epics untouched, one commit', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeEpic(target, 'EB', 'slug-eb', 0);
  writeTopic(target, 'paused', 'A1', 'slug-ea', 1);
  writeTopic(target, 'paused', 'A2', 'slug-ea', 4);
  writeTopic(target, 'paused', 'A3', 'slug-ea', 6);
  writeTopic(target, 'paused', 'B1', 'slug-eb', 2);
  writeTopic(target, 'hold', 'B2', 'slug-eb', 5);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await topicMakeTop(handle, 'EA', 'A3');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.changed, true);
  });

  const a3 = readPriority(target, 'paused', 'A3');
  assert.ok(a3 < readPriority(target, 'paused', 'A1'));
  assert.ok(a3 < readPriority(target, 'paused', 'A2'));
  // B1/B2 (a different epic) keep their relative order to each other and to
  // A1/A2 - invariant 2 promises relative ORDER, never raw VALUE, is
  // preserved for every pair other than the target (B1's own numeric value
  // may shift as part of the cascade if A3's walk passes it on the way up).
  assert.ok(
    readPriority(target, 'paused', 'B1') < readPriority(target, 'hold', 'B2'),
    'expected B1 to still rank before B2'
  );

  const status = execFileSync('git', ['status', '--porcelain', '--', 'backlog'], { cwd: target, encoding: 'utf8' });
  assert.equal(status.trim(), '', 'expected backlog/ to be clean - all changed files committed');
});

test('scenario 03: a better-ranked live dependency (also a peer) bounds the move below itself', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeTopic(target, 'paused', 'A1', 'slug-ea', 1);
  writeTopic(target, 'paused', 'A2', 'slug-ea', 4);
  writeTopic(target, 'paused', 'A3', 'slug-ea', 6, ['A1']);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await topicMakeTop(handle, 'EA', 'A3');
    assert.equal(status, 200);
    assert.equal(body.changed, true);
    assert.match(body.reason, /A1/);
  });

  assert.ok(readPriority(target, 'paused', 'A1') < readPriority(target, 'paused', 'A3'));
  assert.ok(readPriority(target, 'paused', 'A3') < readPriority(target, 'paused', 'A2'));
});

test('scenario 04: a cross-epic live dependency ranked worse refuses the move, writing nothing', async () => {
  const target = mkTmp();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeEpic(target, 'EB', 'slug-eb', 0);
  writeTopic(target, 'paused', 'A3', 'slug-ea', 1, ['B2']);
  writeTopic(target, 'paused', 'B2', 'slug-eb', 5);
  const beforeA3 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'A3.yaml'), 'utf8');

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await topicMakeTop(handle, 'EA', 'A3');
    assert.equal(status, 200);
    assert.equal(body.changed, false);
    assert.match(body.reason, /B2/);
  });

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'A3.yaml'), 'utf8'), beforeA3);
});

test('scenario 05: a cyclic depends_on chain refuses fail-closed', async () => {
  const target = mkTmp();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeTopic(target, 'paused', 'A3', 'slug-ea', 6, ['A4']);
  writeTopic(target, 'paused', 'A4', 'slug-ea', 0, ['A3']);

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await topicMakeTop(handle, 'EA', 'A3');
    assert.equal(status, 200);
    assert.equal(body.changed, false);
    assert.match(body.reason, /cycle/);
  });
});

test('scenario 05: a dangling depends_on id refuses fail-closed', async () => {
  const target = mkTmp();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeTopic(target, 'paused', 'A3', 'slug-ea', 6, ['GHOST-1']);

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await topicMakeTop(handle, 'EA', 'A3');
    assert.equal(status, 200);
    assert.equal(body.changed, false);
    assert.match(body.reason, /GHOST-1/);
  });
});

test('scenario 06: done and active dependencies neither bound nor refuse the move', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeTopic(target, 'paused', 'A1', 'slug-ea', 1);
  writeTopic(target, 'paused', 'A3', 'slug-ea', 6, ['DONE-1', 'ACTIVE-1']);
  writeTicket(target, 'done', 'DONE-1', ['type: feature', 'priority: 0']);
  writeTicket(target, 'active', 'ACTIVE-1', ['type: feature', 'priority: 0']);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await topicMakeTop(handle, 'EA', 'A3');
    assert.equal(status, 200);
    assert.equal(body.changed, true);
  });

  assert.ok(readPriority(target, 'paused', 'A3') < readPriority(target, 'paused', 'A1'));
});

test('scenario 07: a topic outside the named epic is refused without writes', async () => {
  const target = mkTmp();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeEpic(target, 'EB', 'slug-eb', 0);
  writeTopic(target, 'paused', 'B1', 'slug-eb', 2);
  const before = fs.readFileSync(path.join(target, 'backlog', 'paused', 'B1.yaml'), 'utf8');

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await topicMakeTop(handle, 'EA', 'B1');
    assert.equal(status, 404);
    assert.equal(body.success, false);
  });

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'B1.yaml'), 'utf8'), before);
});

test('scenario 08: re-applying to a topic already in its best permitted slot is a no-op with a reason', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeTopic(target, 'paused', 'A1', 'slug-ea', 1);
  writeTopic(target, 'paused', 'A3', 'slug-ea', 6);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const first = await topicMakeTop(handle, 'EA', 'A3');
    assert.equal(first.body.changed, true);

    const beforeA3 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'A3.yaml'), 'utf8');
    const second = await topicMakeTop(handle, 'EA', 'A3');
    assert.equal(second.status, 200);
    assert.equal(second.body.success, true);
    assert.equal(second.body.changed, false);
    assert.equal(typeof second.body.reason, 'string');
    assert.ok(second.body.reason.length > 0);
    assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'A3.yaml'), 'utf8'), beforeA3);
  });
});

test('topic make-top route returns 404 and mutates nothing for a topic id that does not exist at all', async () => {
  const target = mkTmp();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeTopic(target, 'paused', 'A1', 'slug-ea', 1);

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await topicMakeTop(handle, 'EA', 'NOT-A-REAL-ID');
    assert.equal(status, 404);
    assert.equal(body.success, false);
  });
});

test('topic make-top route rejects a malformed body without mutating any backlog YAML', async () => {
  const target = mkTmp();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeTopic(target, 'paused', 'A1', 'slug-ea', 1);
  const before = fs.readFileSync(path.join(target, 'backlog', 'paused', 'A1.yaml'), 'utf8');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/topic-make-top`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ epicId: 'EA' }),
    });
    assert.equal(res.status, 400);
  });

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'A1.yaml'), 'utf8'), before);
});

test('topic make-top route: write succeeds but the commit fails - reports the BL-490 reason and leaves the write on disk', async () => {
  const target = mkTmp();
  writeEpic(target, 'EA', 'slug-ea', 0);
  writeTopic(target, 'paused', 'A1', 'slug-ea', 1);
  writeTopic(target, 'paused', 'A3', 'slug-ea', 6);

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await topicMakeTop(handle, 'EA', 'A3');
    assert.equal(status, 500);
    assert.equal(body.success, false);
    assert.equal(body.changed, true);
    assert.equal(body.reason, 'write succeeded but commit failed');
  });

  assert.ok(readPriority(target, 'paused', 'A3') < readPriority(target, 'paused', 'A1'));
});
