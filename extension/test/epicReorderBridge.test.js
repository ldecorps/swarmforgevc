const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startBridge, resolveEpicWritePaths } = require('../out/bridge/bridgeServer');

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

function writeEpic(targetPath, id, priority, slug) {
  const fields = ['type: epic', `priority: ${priority}`];
  if (slug) {
    fields.push(`epic: ${slug}`);
  }
  writeTicket(targetPath, 'paused', id, fields);
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
    assert.deepEqual(body, { items: [], total: 0, topics: [] });
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

test('BL-674/BL-686: epic-reorder JSON feed lists every live (paused+hold) topic tagged with the epic TICKET IDS whose slug matches it, ordered by priority/id, with a live-dependency marker', async () => {
  const target = mkTmp();
  // BL-686: the epic ticket's own id ("EPIC-A") is deliberately different
  // from the slug its children declare ("slug-a") - real backlog data never
  // has these equal (verified across all 15 live epic tickets at filing
  // time). A fixture where id === slug would hide the exact defect this
  // ticket fixes.
  writeEpic(target, 'EPIC-A', 0, 'slug-a');
  writeEpic(target, 'EPIC-B', 0, 'slug-b');
  writeTicket(target, 'paused', 'A1', ['type: feature', 'epic: slug-a', 'priority: 1']);
  writeTicket(target, 'paused', 'A3', ['type: feature', 'epic: slug-a', 'priority: 6', 'depends_on: [A1]']);
  writeTicket(target, 'hold', 'B1', ['type: feature', 'epic: slug-b', 'priority: 2']);
  // An epic-less ticket (no epic: field) must never appear in topics.
  writeTicket(target, 'paused', 'BL-999', ['type: feature', 'priority: 0']);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const byId = new Map(body.topics.map((t) => [t.id, t]));
    assert.deepEqual(body.topics.map((t) => t.id), ['A1', 'B1', 'A3']);
    assert.deepEqual(byId.get('A1').epicIds, ['EPIC-A']);
    assert.deepEqual(byId.get('B1').epicIds, ['EPIC-B']);
    assert.equal(byId.get('A1').hasLiveDependency, false);
    assert.equal(byId.get('A3').hasLiveDependency, true, 'A3 depends on live topic A1');
    assert.ok(!byId.has('BL-999'), 'an epic-less ticket must never appear in topics');
    assert.ok(!byId.has('EPIC-A'), 'an epic tracker must never appear as a topic of itself');
    assert.ok(!byId.has('EPIC-B'), 'an epic tracker must never appear as a topic of another epic sharing no slug');
  });
});

// BL-687 invariant 1: the within-epic drill-down's topics now span paused +
// hold + active (done excluded), each tagged inFlight - none of those three
// folders is ever silently absent, and a done/ child never appears.
test('BL-687: epic-reorder JSON feed topics span paused+hold+active (done excluded), each tagged inFlight', async () => {
  const target = mkTmp();
  writeEpic(target, 'EPIC-A', 0, 'slug-a');
  writeTicket(target, 'paused', 'A1', ['type: feature', 'epic: slug-a', 'priority: 20']);
  writeTicket(target, 'hold', 'A2', ['type: feature', 'epic: slug-a', 'priority: 40']);
  writeTicket(target, 'active', 'A3', ['type: feature', 'epic: slug-a', 'priority: 30']);
  writeTicket(target, 'done', 'A4', ['type: feature', 'epic: slug-a', 'priority: 1']);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const byId = new Map(body.topics.map((t) => [t.id, t]));
    assert.deepEqual(body.topics.map((t) => t.id), ['A1', 'A3', 'A2'], 'priority ascending across all three folders');
    assert.equal(byId.get('A1').inFlight, false);
    assert.equal(byId.get('A2').inFlight, false);
    assert.equal(byId.get('A3').inFlight, true, 'A3 is sourced from backlog/active/');
    assert.ok(!byId.has('A4'), 'a done/ child must never appear, even sharing the same epic slug');
  });
});

// BL-687 invariant 2: an active/ dependency must stay just as inert for the
// hasLiveDependency marker as it already is for computeMakeTopPriority's own
// traversal - widening the drill-down's MEMBERSHIP must never widen what
// counts as a live dependency.
test('BL-687: a depends_on naming an in-flight (active/) ticket shows no live-dependency marker', async () => {
  const target = mkTmp();
  writeEpic(target, 'EPIC-A', 0, 'slug-a');
  writeTicket(target, 'active', 'A1', ['type: feature', 'epic: slug-a', 'priority: 10']);
  writeTicket(target, 'hold', 'A2', ['type: feature', 'epic: slug-a', 'priority: 20', 'depends_on: [A1]']);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    const body = await res.json();
    const a2 = body.topics.find((t) => t.id === 'A2');
    assert.equal(a2.hasLiveDependency, false, 'A1 is active/, so it must never light the live-dependency marker');
  });
});

test('BL-686: two epic trackers declaring the same slug both resolve the same topics into their epicIds', async () => {
  const target = mkTmp();
  writeEpic(target, 'EPIC-A', 0, 'shared-slug');
  writeEpic(target, 'EPIC-A2', 1, 'shared-slug');
  writeTicket(target, 'paused', 'A1', ['type: feature', 'epic: shared-slug', 'priority: 1']);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    const body = await res.json();
    const a1 = body.topics.find((t) => t.id === 'A1');
    assert.deepEqual(a1.epicIds.slice().sort(), ['EPIC-A', 'EPIC-A2']);
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

// Every other move test in this file drives 'up' - the UI's own "Move down"
// button (epicReorderUiHtml.ts) and computeEpicReorder's own 'down' handling
// (epicReorderSafety.test.js) are both real, but nothing exercised 'down'
// through the ACTUAL route before this, leaving isEpicReorderMoveRequestShape's
// own `v.direction === 'down'` acceptance branch untested at the HTTP layer.
test('epic-reorder move route: moving a mid-list epic down swaps its priority with its neighbour below', async () => {
  const target = mkGitTarget();
  writeEpic(target, 'BL-703', 10);
  writeEpic(target, 'BL-704', 20);
  writeEpic(target, 'BL-705', 30);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed epics'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-704', direction: 'down' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.changed, true);
  });

  assert.equal(readPriority(target, 'BL-703'), 10);
  assert.equal(readPriority(target, 'BL-704'), 30);
  assert.equal(readPriority(target, 'BL-705'), 20);
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

// isEpicReorderMoveRequestShape's own `!value || typeof value !== 'object'`
// guard is what stops a non-object JSON body reaching `v.id`/`v.direction`
// property access a few lines down - a body of {id: 'X'} (missing direction,
// the case above) never exercises this guard at all, since it's already a
// well-formed object. A body that parses to `null` or a primitive is the
// only way to drive it, and without the guard the route would throw inside
// readValidatedBody's isShape call instead of cleanly responding 400.
test('epic-reorder move route: a JSON body that parses to null is rejected with 400, not a crash', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-760', 10);
  writeEpic(target, 'BL-761', 20);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: 'null',
    });
    assert.equal(res.status, 400);
  });
});

test('epic-reorder move route: a JSON body that parses to a non-object primitive is rejected with 400, not a crash', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-770', 10);
  writeEpic(target, 'BL-771', 20);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: '"just a string"',
    });
    assert.equal(res.status, 400);
  });
});

// Architect bounce #3 (secondary finding): a tie-run cascade can touch 3+
// files, and the write loop must resolve every one of their paths BEFORE
// writing any of them - otherwise a file missing partway through the cascade
// (a real risk under concurrent modification) leaves a partially-rewritten,
// uncommitted backlog matching neither the old nor the new order. `findFn`
// is injected so the missing-mid-cascade case is reproducible without a real
// filesystem race.
test('resolveEpicWritePaths: resolves every write path when all files exist', () => {
  const writes = [{ id: 'BL-1', priority: 1 }, { id: 'BL-2', priority: 2 }];
  const found = { 'BL-1': '/tmp/BL-1.yaml', 'BL-2': '/tmp/BL-2.yaml' };
  const resolved = resolveEpicWritePaths('/tmp', writes, (_targetPath, id) => found[id] ?? null);
  assert.deepEqual(resolved, [
    { write: writes[0], filePath: '/tmp/BL-1.yaml' },
    { write: writes[1], filePath: '/tmp/BL-2.yaml' },
  ]);
});

test('resolveEpicWritePaths: a missing file anywhere in the cascade resolves nothing at all, not just the missing one', () => {
  const writes = [{ id: 'BL-1', priority: 1 }, { id: 'BL-2', priority: 2 }, { id: 'BL-3', priority: 3 }];
  // BL-2 (the MIDDLE write, not the first) is missing - proves the function
  // does not return a partial list for the writes that resolved fine before it.
  const found = { 'BL-1': '/tmp/BL-1.yaml', 'BL-3': '/tmp/BL-3.yaml' };
  const resolved = resolveEpicWritePaths('/tmp', writes, (_targetPath, id) => found[id] ?? null);
  assert.equal(resolved, null);
});

test('epic-reorder move route: a file vanishing partway through a tie-run cascade writes NOTHING to disk (architect bounce #3, secondary)', async () => {
  const target = mkTmp();
  // Four-way tie at priority 0: moving BL-961 up produces a three-file
  // write cascade in the order BL-960, BL-962, BL-963 (see
  // epicReorderSafety.ts's cascade walk) - not just the moved pair. All four
  // files stay on disk (readPausedEpics must still see BL-963 as a real,
  // listed epic so it is genuinely part of the cascade); only the WRITE-TIME
  // path lookup for BL-963 is made to fail, reproducing the concurrent-
  // modification window a real filesystem race would only hit non-
  // deterministically.
  writeEpic(target, 'BL-960', 0);
  writeEpic(target, 'BL-961', 0);
  writeEpic(target, 'BL-962', 0);
  writeEpic(target, 'BL-963', 0);
  const before960 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-960.yaml'), 'utf8');
  const before961 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-961.yaml'), 'utf8');
  const before962 = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-962.yaml'), 'utf8');

  const backlogWriter = require('../out/panel/backlogWriter');
  const originalFind = backlogWriter.findBacklogFilePath;
  backlogWriter.findBacklogFilePath = function (targetPathArg, id) {
    return id === 'BL-963' ? null : originalFind(targetPathArg, id);
  };

  try {
    await withBridge(target, {}, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
        method: 'POST',
        headers: controlAuthHeaders(),
        body: JSON.stringify({ id: 'BL-961', direction: 'up' }),
      });
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(
        body.reason,
        'epic file missing during write',
        'must take the dedicated missing-file 500 path, not fall through to the generic catch-all'
      );
    });
  } finally {
    backlogWriter.findBacklogFilePath = originalFind;
  }

  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-960.yaml'), 'utf8'), before960, 'BL-960 must not be written when a later cascade member is missing');
  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-961.yaml'), 'utf8'), before961);
  assert.equal(fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-962.yaml'), 'utf8'), before962, 'BL-962 must not be written either, even though it resolves fine and comes before the missing file');
});

test('epic-reorder move route: write succeeds but the commit fails - reports the BL-490 reason and leaves the write on disk (architect bounce #3)', async () => {
  // mkTmp() (no git repo, no commit_integrity_cli.bb) makes runCommitIntegrity
  // fail deterministically after the priority files are already rewritten -
  // exactly the "write succeeded but commit failed" shape that motivated
  // epicReorderUiHtml.ts's move()'s reason-swallowing fix (bounce #3). This
  // is the only test that drives that response out of the real route instead
  // of asserting on a hand-built payload.
  const target = mkTmp();
  writeEpic(target, 'BL-800', 10);
  writeEpic(target, 'BL-801', 20);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-801', direction: 'up' }),
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.changed, true);
    assert.equal(body.reason, 'write succeeded but commit failed');
  });

  assert.equal(readPriority(target, 'BL-800'), 20, 'the write itself must have landed despite the commit failure');
  assert.equal(readPriority(target, 'BL-801'), 10);
});

// replacePriorityLine's PRIORITY_LINE regex is anchored with `^` specifically
// so it only ever matches a true `priority:` FIELD line, never a `priority:`
// mention inside a prose field - a real shape, not a hypothetical: this
// ticket's own YAML (backlog/active/BL-572-*.yaml) has the literal field once
// and the bare word "priority:" inside backtick-quoted prose seven more times
// in its `description`/`notes` blocks. Without the anchor, `.replace()`
// (single match) would rewrite whichever line the regex hits FIRST, which
// could be prose above the real field rather than the field itself.
test('epic-reorder move route: a prose mention of "priority:" ABOVE the real field is left untouched; only the real field line changes', async () => {
  const target = mkGitTarget();
  const dir = path.join(target, 'backlog', 'paused');
  mkdirp(dir);
  const decoyLine = 'notes: hand-editing `priority:` in its YAML is what this ticket replaces';
  fs.writeFileSync(path.join(dir, 'BL-900.yaml'), `id: BL-900\ntitle: BL-900 title\n${decoyLine}\ntype: epic\npriority: 10\n`);
  writeEpic(target, 'BL-901', 20);
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed decoy epic'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-901', direction: 'up' }),
    });
    assert.equal(res.status, 200);
  });

  const content = fs.readFileSync(path.join(dir, 'BL-900.yaml'), 'utf8');
  assert.ok(content.includes(decoyLine), 'the prose line mentioning "priority:" must be left byte-identical');
  assert.equal(readPriority(target, 'BL-900'), 20, 'the real priority field, not the decoy prose line, must carry the new value');
});
