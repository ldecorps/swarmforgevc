const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startBridge, resolveEpicWritePaths } = require('../out/bridge/bridgeServer');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');

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

// A paused epic with a live child so it appears on the reorder tiles (and
// is a legal Move up / Move down neighbour). Defaults the slug to the
// ticket id so tests that only care about order do not have to invent one.
function writeReorderableEpic(targetPath, id, priority, slug) {
  const epicSlug = slug || id;
  writeEpic(targetPath, id, priority, epicSlug);
  writeTicket(targetPath, 'paused', `${id}-T`, ['type: feature', `epic: ${epicSlug}`, 'priority: 100']);
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
  // BL-1038: copies commit_integrity_cli.bb's load-file CLOSURE (11 files),
  // not the whole live scripts directory - see pinnedRepoFixture.js for why.
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['commit_integrity_cli.bb']);
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
  writeReorderableEpic(target, 'BL-500', 10);
  writeTicket(target, 'paused', 'BL-501', ['type: feature', 'priority: 1']);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.items.map((i) => i.id), ['BL-500']);
    assert.equal(body.total, 1);
  });
});

test('epic-reorder JSON feed: a backlog of only childless paused epics is the empty list, not a row per tracker', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-EMPTY-A', 1, 'empty-a');
  writeEpic(target, 'BL-EMPTY-B', 2, 'empty-b');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    const body = await res.json();
    assert.deepEqual(body.items, []);
    assert.equal(body.total, 0);
  });
});

test('epic-reorder JSON feed: omits a paused epic with no live child, including a done-only tracker, but keeps one whose only child is in-flight', async () => {
  const target = mkTmp();
  writeEpic(target, 'BL-EMPTY', 1, 'empty-slug');
  writeReorderableEpic(target, 'BL-LIVE', 2, 'live-slug');
  writeEpic(target, 'BL-DONE-ONLY', 0, 'done-slug');
  writeTicket(target, 'done', 'BL-DONE-ONLY-T', ['type: feature', 'epic: done-slug', 'priority: 1']);
  writeEpic(target, 'BL-ACTIVE-ONLY', 3, 'active-slug');
  writeTicket(target, 'active', 'BL-ACTIVE-ONLY-T', ['type: feature', 'epic: active-slug', 'priority: 1']);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.items.map((i) => i.id), ['BL-LIVE', 'BL-ACTIVE-ONLY']);
    assert.equal(body.total, 2);
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
  writeReorderableEpic(target, 'BL-003', 5);
  writeReorderableEpic(target, 'BL-002', 1);
  writeReorderableEpic(target, 'BL-005', 1);

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
  writeReorderableEpic(target, 'BL-700', 10);
  writeReorderableEpic(target, 'BL-701', 20);
  writeReorderableEpic(target, 'BL-702', 30);
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
  writeReorderableEpic(target, 'BL-703', 10);
  writeReorderableEpic(target, 'BL-704', 20);
  writeReorderableEpic(target, 'BL-705', 30);
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
  writeReorderableEpic(target, 'BL-708', 5);
  writeReorderableEpic(target, 'BL-710', 20);
  writeReorderableEpic(target, 'BL-711', 20);
  writeReorderableEpic(target, 'BL-712', 500);
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
  writeReorderableEpic(target, 'BL-960', 0);
  writeReorderableEpic(target, 'BL-961', 0);
  writeReorderableEpic(target, 'BL-962', 0);
  writeReorderableEpic(target, 'BL-963', 0);
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
  writeReorderableEpic(target, 'BL-720', 10);
  writeReorderableEpic(target, 'BL-721', 20);
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

test('epic-reorder move route: a childless epic sitting between two populated ones is not a neighbour and is never rewritten', async () => {
  const target = mkGitTarget();
  writeReorderableEpic(target, 'BL-A', 10, 'slug-a');
  writeEpic(target, 'BL-HIDDEN', 20, 'slug-hidden');
  writeReorderableEpic(target, 'BL-C', 30, 'slug-c');
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'seed mixed populated/empty epics'], { cwd: target });

  await withBridge(target, {}, async (handle) => {
    const before = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.deepEqual((await before.json()).items.map((i) => i.id), ['BL-A', 'BL-C']);

    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: 'BL-A', direction: 'down' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.changed, true);

    const after = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.deepEqual((await after.json()).items.map((i) => i.id), ['BL-C', 'BL-A']);
  });

  assert.equal(readPriority(target, 'BL-A'), 30);
  assert.equal(readPriority(target, 'BL-C'), 10);
  assert.equal(readPriority(target, 'BL-HIDDEN'), 20, 'the hidden childless tracker must keep its original priority');
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
  writeReorderableEpic(target, 'BL-960', 0);
  writeReorderableEpic(target, 'BL-961', 0);
  writeReorderableEpic(target, 'BL-962', 0);
  writeReorderableEpic(target, 'BL-963', 0);
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
  writeReorderableEpic(target, 'BL-800', 10);
  writeReorderableEpic(target, 'BL-801', 20);

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
  fs.writeFileSync(path.join(dir, 'BL-900.yaml'), `id: BL-900\ntitle: BL-900 title\n${decoyLine}\ntype: epic\nepic: decoy-slug\npriority: 10\n`);
  writeTicket(target, 'paused', 'BL-900-T', ['type: feature', 'epic: decoy-slug', 'priority: 100']);
  writeReorderableEpic(target, 'BL-901', 20);
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

// ── BL-591: the impure epicEta collector (readEpicEtaCompletionEvents,
// epicEtaPackLabel) - neither is exported, and until now neither had any
// test at all, direct or acceptance. Both are exercised only through the
// real HTTP route, same as the rest of this file: the required_wiring gate
// ("the reorder state feed must fold the estimator's per-epic output into
// its items - a green estimator wired into nothing is the BL-419 shape")
// is a claim about THIS wiring, not the pure estimator's own tests.

// Commits a backlog/done/<id>.yaml at an explicit GIT_AUTHOR_DATE/
// GIT_COMMITTER_DATE so completion-velocity fixtures are deterministic
// against real wall-clock `git log --since` filtering, not test run time.
function commitDoneFiles(target, ids, daysAgo) {
  const dir = path.join(target, 'backlog', 'done');
  mkdirp(dir);
  for (const id of ids) {
    fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: ${id} title\ntype: feature\n`);
  }
  const dateIso = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', `done ${ids.join(',')}`], {
    cwd: target,
    env: { ...process.env, GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso },
  });
}

test('BL-591: epic-reorder JSON feed folds a real, git-derived velocity ETA into each tile (required_wiring smoke test)', async () => {
  const target = mkGitTarget();
  writeReorderableEpic(target, 'BL-591-A', 10);
  for (let d = 1; d <= 20; d++) {
    commitDoneFiles(target, [`BL-DONE-${d}`], d);
  }

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const tile = body.items.find((i) => i.id === 'BL-591-A');
    assert.ok(tile, 'no BL-591-A tile in the response');
    assert.ok(tile.epicEta, 'BL-419 shape: the estimator is wired into nothing - epicEta missing from the tile');
    assert.equal(tile.epicEta.kind, 'ranged', JSON.stringify(tile.epicEta));
    assert.ok(tile.epicEta.lowDays < tile.epicEta.highDays);
    assert.ok(typeof tile.epicEta.paceAssumption === 'string' && tile.epicEta.paceAssumption.length > 0);
    assert.ok(/\d+d window/.test(tile.epicEta.paceAssumption), tile.epicEta.paceAssumption);
  });
});

test('BL-591: completion events are counted per FILE, not per commit - a 3-file commit and 3 one-file commits on the same date yield the same ETA', async () => {
  const sameDayIds = ['BL-D1', 'BL-D2', 'BL-D3'];

  const batched = mkGitTarget();
  writeReorderableEpic(batched, 'BL-591-BATCH', 10);
  commitDoneFiles(batched, sameDayIds, 6);

  const separate = mkGitTarget();
  writeReorderableEpic(separate, 'BL-591-SEPARATE', 10);
  for (const id of sameDayIds) {
    commitDoneFiles(separate, [id], 6);
  }

  const fetchTile = async (target, id) =>
    withBridge(target, {}, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
      const body = await res.json();
      return body.items.find((i) => i.id === id).epicEta;
    });

  const batchedEta = await fetchTile(batched, 'BL-591-BATCH');
  const separateEta = await fetchTile(separate, 'BL-591-SEPARATE');

  assert.equal(batchedEta.kind, 'ranged', JSON.stringify(batchedEta));
  assert.equal(separateEta.kind, 'ranged', JSON.stringify(separateEta));
  // Real-clock git fixtures: tolerate sub-second drift between the two live
  // requests rather than asserting bit-for-bit equality.
  assert.ok(
    Math.abs(batchedEta.lowDays - separateEta.lowDays) < 0.2,
    `expected the same low bound regardless of commit batching, got ${batchedEta.lowDays} vs ${separateEta.lowDays}`
  );
  assert.ok(
    Math.abs(batchedEta.highDays - separateEta.highDays) < 0.2,
    `expected the same high bound regardless of commit batching, got ${batchedEta.highDays} vs ${separateEta.highDays}`
  );
});

test('BL-591: SWARMFORGE_PACK names the pace assumption when set', async () => {
  const target = mkGitTarget();
  writeReorderableEpic(target, 'BL-591-PACK', 10);
  for (let d = 1; d <= 10; d++) {
    commitDoneFiles(target, [`BL-DONE-${d}`], d);
  }
  const prevPack = process.env.SWARMFORGE_PACK;
  process.env.SWARMFORGE_PACK = 'full-forge-test-pack';
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
      const body = await res.json();
      const tile = body.items.find((i) => i.id === 'BL-591-PACK');
      assert.equal(tile.epicEta.kind, 'ranged', JSON.stringify(tile.epicEta));
      assert.ok(tile.epicEta.paceAssumption.includes('full-forge-test-pack'), tile.epicEta.paceAssumption);
    });
  } finally {
    if (prevPack === undefined) {
      delete process.env.SWARMFORGE_PACK;
    } else {
      process.env.SWARMFORGE_PACK = prevPack;
    }
  }
});

test('BL-591: falls back to the .swarmforge/swarm-identity launch_pack line when SWARMFORGE_PACK is unset', async () => {
  const target = mkGitTarget();
  writeReorderableEpic(target, 'BL-591-IDENTITY', 10);
  for (let d = 1; d <= 10; d++) {
    commitDoneFiles(target, [`BL-DONE-${d}`], d);
  }
  mkdirp(path.join(target, '.swarmforge'));
  fs.writeFileSync(path.join(target, '.swarmforge', 'swarm-identity'), 'launch_pack\tmono-router\nother_field\tx\n');

  const prevPack = process.env.SWARMFORGE_PACK;
  delete process.env.SWARMFORGE_PACK;
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
      const body = await res.json();
      const tile = body.items.find((i) => i.id === 'BL-591-IDENTITY');
      assert.equal(tile.epicEta.kind, 'ranged', JSON.stringify(tile.epicEta));
      assert.ok(tile.epicEta.paceAssumption.includes('mono-router'), tile.epicEta.paceAssumption);
    });
  } finally {
    if (prevPack !== undefined) {
      process.env.SWARMFORGE_PACK = prevPack;
    }
  }
});

test('BL-591: falls back to the honest "unknown-pack" label when neither SWARMFORGE_PACK nor swarm-identity is present', async () => {
  const target = mkGitTarget();
  writeReorderableEpic(target, 'BL-591-UNKNOWN', 10);
  for (let d = 1; d <= 10; d++) {
    commitDoneFiles(target, [`BL-DONE-${d}`], d);
  }

  const prevPack = process.env.SWARMFORGE_PACK;
  delete process.env.SWARMFORGE_PACK;
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
      const body = await res.json();
      const tile = body.items.find((i) => i.id === 'BL-591-UNKNOWN');
      assert.equal(tile.epicEta.kind, 'ranged', JSON.stringify(tile.epicEta));
      assert.ok(tile.epicEta.paceAssumption.includes('unknown-pack'), tile.epicEta.paceAssumption);
    });
  } finally {
    if (prevPack !== undefined) {
      process.env.SWARMFORGE_PACK = prevPack;
    }
  }
});

test('BL-591: an unreadable git history (not a git repo) degrades to no-recent-pace, never a crash or a fabricated range', async () => {
  const target = mkTmp();
  writeReorderableEpic(target, 'BL-591-NOGIT', 10);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const tile = body.items.find((i) => i.id === 'BL-591-NOGIT');
    assert.ok(tile.epicEta, 'BL-419 shape: epicEta missing from the tile');
    assert.equal(tile.epicEta.kind, 'no-recent-pace', JSON.stringify(tile.epicEta));
  });
});

test('BL-591: the completion-events cache is keyed per targetPath - two bridges over different git histories never cross-contaminate', async () => {
  const busy = mkGitTarget();
  writeReorderableEpic(busy, 'BL-591-BUSY', 10);
  for (let d = 1; d <= 20; d++) {
    commitDoneFiles(busy, [`BL-BUSY-DONE-${d}`], d);
  }

  const quiet = mkGitTarget();
  writeReorderableEpic(quiet, 'BL-591-QUIET', 10);
  // No completions at all in the trailing window - must stay no-recent-pace
  // even though the "busy" target above was just served from the same
  // process, immediately before, well inside the 5-minute cache TTL.

  const busyEta = await withBridge(busy, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    return (await res.json()).items.find((i) => i.id === 'BL-591-BUSY').epicEta;
  });
  const quietEta = await withBridge(quiet, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    return (await res.json()).items.find((i) => i.id === 'BL-591-QUIET').epicEta;
  });

  assert.equal(busyEta.kind, 'ranged', JSON.stringify(busyEta));
  assert.equal(quietEta.kind, 'no-recent-pace', JSON.stringify(quietEta));
});
