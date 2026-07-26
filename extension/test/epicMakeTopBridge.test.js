const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startBridge } = require('../out/bridge/bridgeServer');

const TOKEN = 'test-token-123';

function mkTmp() {
  return mkTmpDir('sfvc-epic-make-top-bridge-');
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

function writeEpic(targetPath, folder, id, priority, dependsOn) {
  const fields = ['type: epic', `priority: ${priority}`];
  if (dependsOn && dependsOn.length > 0) {
    fields.push(`depends_on: [${dependsOn.join(', ')}]`);
  }
  writeTicket(targetPath, folder, id, fields);
}

function writeTopic(targetPath, folder, id, priority) {
  writeTicket(targetPath, folder, id, ['type: feature', `priority: ${priority}`]);
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

async function makeTop(handle, id) {
  const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/make-top`, {
    method: 'POST',
    headers: controlAuthHeaders(),
    body: JSON.stringify({ id }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('make-top route requires control auth (bearer-only 403, wrong token 401)', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'BL-600', 10);

  await withBridge(target, {}, async (handle) => {
    const bearerOnly = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/make-top`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-600' }),
    });
    assert.equal(bearerOnly.status, 403);

    const wrongToken = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/make-top`, {
      method: 'POST',
      headers: controlAuthHeaders('wrong'),
      body: JSON.stringify({ id: 'BL-600' }),
    });
    assert.equal(wrongToken.status, 401);

    assert.equal(readPriority(target, 'paused', 'BL-600'), 10);
  });
});

test('scenario 01/06: make-top on a dependency-free epic makes it the unique top of BOTH paused epics AND paused/hold topics, committed to main', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'paused', 'E1', 0);
  writeEpic(target, 'paused', 'E2', 0);
  writeEpic(target, 'paused', 'E3', 2);
  writeTopic(target, 'paused', 'T1', 0);
  writeTopic(target, 'hold', 'T2', 5);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await makeTop(handle, 'E3');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.changed, true);
  });

  const e3 = readPriority(target, 'paused', 'E3');
  for (const [folder, id] of [['paused', 'E1'], ['paused', 'E2'], ['paused', 'T1'], ['hold', 'T2']]) {
    assert.ok(e3 < readPriority(target, folder, id), `expected E3 (${e3}) to rank strictly before ${id}`);
  }

  const status = execFileSync('git', ['status', '--porcelain', '--', 'backlog'], { cwd: target, encoding: 'utf8' });
  assert.equal(status.trim(), '', 'expected backlog/ to be clean - all changed files committed');
});

test('scenario 03: re-applying to an already-top epic is a committed no-op with a reason', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'paused', 'E1', 0);
  writeEpic(target, 'paused', 'E2', 5);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    // E2 starts ranked worse than E1 - the first tap is a REAL move (proves
    // the no-op below is genuinely re-applying to an already-top target, not
    // just naming a target that started there for free).
    const first = await makeTop(handle, 'E2');
    assert.equal(first.body.changed, true);

    const beforeE2 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'E2.yaml'), 'utf8');
    const second = await makeTop(handle, 'E2');
    assert.equal(second.status, 200);
    assert.equal(second.body.success, true);
    assert.equal(second.body.changed, false);
    assert.equal(typeof second.body.reason, 'string');
    assert.ok(second.body.reason.length > 0);
    assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'E2.yaml'), 'utf8'), beforeE2, 'no file may change on a no-op');
  });
});

test('scenario 04: a live better-ranked dependency bounds the move instead of being outranked', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'paused', 'E1', 0);
  writeEpic(target, 'paused', 'E2', 1);
  writeEpic(target, 'paused', 'E3', 2, ['E1']);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await makeTop(handle, 'E3');
    assert.equal(status, 200);
    assert.equal(body.changed, true);
    assert.match(body.reason, /E1/, 'a bounded (non-absolute-top) success must name the bounding dependency');
  });

  const e1 = readPriority(target, 'paused', 'E1');
  const e2 = readPriority(target, 'paused', 'E2');
  const e3 = readPriority(target, 'paused', 'E3');
  assert.ok(e1 < e3, `expected E1 (${e1}) to still rank before E3 (${e3})`);
  assert.ok(e3 < e2, `expected E3 (${e3}) to now rank before E2 (${e2})`);
});

test('scenario 05: a live dependency ranked worse than the target refuses fail-closed, writing nothing', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'E1', 0);
  writeEpic(target, 'paused', 'E3', 2, ['T2']);
  writeTopic(target, 'paused', 'T2', 5);
  const beforeE3 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'E3.yaml'), 'utf8');

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await makeTop(handle, 'E3');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.changed, false);
    assert.match(body.reason, /T2/);
  });

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'E3.yaml'), 'utf8'), beforeE3);
});

test('scenario 05: a cyclic depends_on chain refuses fail-closed', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'E3', 2, ['E4']);
  writeEpic(target, 'paused', 'E4', 0, ['E3']);

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await makeTop(handle, 'E3');
    assert.equal(status, 200);
    assert.equal(body.changed, false);
    assert.match(body.reason, /cycle/);
  });
});

test('scenario 05: a dangling depends_on id refuses fail-closed', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'E3', 2, ['GHOST-1']);

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await makeTop(handle, 'E3');
    assert.equal(status, 200);
    assert.equal(body.changed, false);
    assert.match(body.reason, /GHOST-1/);
  });
});

test('scenario 06: a done dependency and an active dependency neither bound nor refuse the move', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'paused', 'E1', 0);
  writeEpic(target, 'paused', 'E3', 2, ['DONE-1', 'ACTIVE-1']);
  writeTicket(target, 'done', 'DONE-1', ['type: feature', 'priority: 0']);
  writeTicket(target, 'active', 'ACTIVE-1', ['type: feature', 'priority: 0']);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await makeTop(handle, 'E3');
    assert.equal(status, 200);
    assert.equal(body.changed, true);
  });

  assert.ok(readPriority(target, 'paused', 'E3') < readPriority(target, 'paused', 'E1'));
});

test('scenario 07: make-top without control auth is refused and modifies no backlog YAML', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'E3', 2);
  const before = fs.readFileSync(path.join(target, 'backlog', 'paused', 'E3.yaml'), 'utf8');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/make-top`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'E3' }),
    });
    assert.equal(res.status, 401);
  });

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'E3.yaml'), 'utf8'), before);
});

test('make-top route returns 404 and mutates nothing for an id not in paused or hold', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'E1', 0);

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await makeTop(handle, 'NOT-A-REAL-ID');
    assert.equal(status, 404);
    assert.equal(body.success, false);
  });
});

test('make-top route rejects a malformed body without mutating any backlog YAML', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'E1', 0);
  const before = fs.readFileSync(path.join(target, 'backlog', 'paused', 'E1.yaml'), 'utf8');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/make-top`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ notAnId: true }),
    });
    assert.equal(res.status, 400);
  });

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'E1.yaml'), 'utf8'), before);
});

test('make-top route: write succeeds but the commit fails - reports the BL-490 reason and leaves the write on disk', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'E1', 0);
  writeEpic(target, 'paused', 'E2', 5);

  await withBridge(target, {}, async (handle) => {
    const { status, body } = await makeTop(handle, 'E2');
    assert.equal(status, 500);
    assert.equal(body.success, false);
    assert.equal(body.changed, true);
    assert.equal(body.reason, 'write succeeded but commit failed');
  });

  assert.ok(readPriority(target, 'paused', 'E2') < readPriority(target, 'paused', 'E1'), 'the write itself must have landed despite the commit failure');
});

test('make-top route: a write target file goes missing mid-cascade - dedicated 500, nothing written', async () => {
  // Mirrors epicReorderBridge.test.js's BL-960..963 concurrent-modification
  // coverage for the shared move route: applyMakeTopPriorityResult must
  // take the SAME dedicated resolveEpicWritePaths-returned-null branch, not
  // fall through to the generic catch-all, when a make-top cascade touches
  // a file that vanished between decision and write.
  const target = mkTmp();
  writeEpic(target, 'paused', 'E1', 0);
  writeEpic(target, 'paused', 'E2', 1);
  writeEpic(target, 'paused', 'E3', 2);
  const before1 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'E1.yaml'), 'utf8');
  const before2 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'E2.yaml'), 'utf8');

  const backlogWriter = require('../out/panel/backlogWriter');
  const originalFind = backlogWriter.findBacklogFilePath;
  backlogWriter.findBacklogFilePath = function (targetPathArg, id) {
    return id === 'E2' ? null : originalFind(targetPathArg, id);
  };

  try {
    await withBridge(target, {}, async (handle) => {
      const { status, body } = await makeTop(handle, 'E3');
      assert.equal(status, 500);
      assert.equal(body.success, false);
      assert.equal(
        body.reason,
        'backlog file missing during write',
        'must take the dedicated missing-file 500 path, not fall through to the generic catch-all'
      );
    });
  } finally {
    backlogWriter.findBacklogFilePath = originalFind;
  }

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'E1.yaml'), 'utf8'), before1, 'nothing writes when a later cascade member is missing');
  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'E2.yaml'), 'utf8'), before2);
});

test('make-top route: an unexpected write-time error is caught and reported, not thrown through the handler', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'E1', 0);
  writeEpic(target, 'paused', 'E2', 5);
  const before1 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'E1.yaml'), 'utf8');

  const atomicWriteModule = require('../out/util/atomicWrite');
  const originalAtomicWrite = atomicWriteModule.atomicWrite;
  atomicWriteModule.atomicWrite = function () {
    throw new Error('simulated disk failure');
  };

  try {
    await withBridge(target, {}, async (handle) => {
      const { status, body } = await makeTop(handle, 'E2');
      assert.equal(status, 500);
      assert.equal(body.success, false);
      assert.equal(body.reason, 'simulated disk failure');
    });
  } finally {
    atomicWriteModule.atomicWrite = originalAtomicWrite;
  }

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'E1.yaml'), 'utf8'), before1, 'nothing else must be left rewritten when the write itself throws');
});

test('make-top route: a non-Error thrown value still reports a reason, not a crash', async () => {
  const target = mkTmp();
  writeEpic(target, 'paused', 'E1', 0);
  writeEpic(target, 'paused', 'E2', 5);

  const atomicWriteModule = require('../out/util/atomicWrite');
  const originalAtomicWrite = atomicWriteModule.atomicWrite;
  atomicWriteModule.atomicWrite = function () {
    // eslint-disable-next-line no-throw-literal
    throw 'a plain string, not an Error instance';
  };

  try {
    await withBridge(target, {}, async (handle) => {
      const { status, body } = await makeTop(handle, 'E2');
      assert.equal(status, 500);
      assert.equal(body.success, false);
      assert.equal(body.reason, 'unknown error');
    });
  } finally {
    atomicWriteModule.atomicWrite = originalAtomicWrite;
  }
});
