const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridge } = require('../out/bridge/bridgeServer');

const TOKEN = 'test-token-123';

function mkTmp() {
  return mkTmpDir('sfvc-paused-pager-bridge-');
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeBacklogTicket(targetPath, folder, id, yaml) {
  const dir = path.join(targetPath, 'backlog', folder);
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, `${id}.yaml`), yaml);
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

test('paused-pager JSON feed: empty state when there are no paused tickets', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { items: [], index: 0, total: 0 });
  });
});

test('paused-pager JSON feed: orders paused tickets by priority ascending, then id ascending', async () => {
  const target = mkTmp();
  // Three paused tickets:
  // - BL-003: priority 5
  // - BL-002: priority 1
  // - BL-001: no priority (treated as MAX_SAFE_INTEGER)
  writeBacklogTicket(
    target,
    'paused',
    'BL-003',
    'id: BL-003\ntitle: third\nstatus: paused\npriority: 5\n'
  );
  writeBacklogTicket(
    target,
    'paused',
    'BL-002',
    'id: BL-002\ntitle: second\nstatus: paused\npriority: 1\n'
  );
  writeBacklogTicket(
    target,
    'paused',
    'BL-001',
    'id: BL-001\ntitle: first\nstatus: paused\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.deepEqual(
      body.items.map((i) => i.id),
      ['BL-002', 'BL-003', 'BL-001'],
      'expected ordering by priority ascending, then id ascending'
    );
    for (const item of body.items) {
      assert.equal(typeof item.yaml, 'string');
      assert.ok(item.canExpedite);
    }
  });
});


test('paused-pager Mini App shell is served without auth and includes basic UI markers', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /Paused tickets/);
    assert.match(body, /No paused tickets\./);
    assert.match(body, /Set highest priority, expedite/);
    assert.match(body, /paused-pager\/expedite/);
  });
});

test('paused-pager JSON feed accepts query-token auth for a plain browser navigation', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const resWithToken = await fetch(`http://127.0.0.1:${handle.port}/paused-pager-state?token=${TOKEN}`);
    assert.equal(resWithToken.status, 200);
    assert.match(resWithToken.headers.get('content-type'), /application\/json/);

    const resWithoutToken = await fetch(`http://127.0.0.1:${handle.port}/paused-pager-state`);
    // JSON data route without query-token or bearer must be unauthorized.
    assert.equal(resWithoutToken.status, 401);

    // HTML shell remains pre-auth (same as other Mini Apps).
    const html = await fetch(`http://127.0.0.1:${handle.port}/paused-pager`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
  });
});

test('paused-pager Expedite route requires control auth (bearer + x-control-token)', async () => {
  const target = mkTmp();
  writeBacklogTicket(
    target,
    'paused',
    'BL-010',
    'id: BL-010\ntitle: needs expedite\nstatus: paused\npriority: 3\n'
  );

  await withBridge(target, {}, async (handle) => {
    // Bearer-only: should be refused with 403.
    const bearerOnlyRes = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-010' }),
    });
    assert.equal(bearerOnlyRes.status, 403);

    // Wrong token: refused before control check.
    const wrongTokenRes = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'x-control-token': 'wrong', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-010' }),
    });
    assert.equal(wrongTokenRes.status, 401);

    // Correct control auth: succeeds.
    const okRes = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-010' }),
    });
    assert.equal(okRes.status, 200);
    const body = await okRes.json();
    assert.deepEqual(body, { success: true, id: 'BL-010' });
  });
});

test('paused-pager Expedite route promotes a paused ticket to active and sets priority: 0 in YAML', async () => {
  const target = mkTmp();
  writeBacklogTicket(
    target,
    'paused',
    'BL-020',
    'id: BL-020\ntitle: paused\nstatus: paused\npriority: 2\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-020' }),
    });
    assert.equal(res.status, 200);

    const activePath = path.join(target, 'backlog', 'active', 'BL-020.yaml');
    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-020.yaml');

    assert.equal(fs.existsSync(pausedPath), false, 'ticket must be promoted out of paused');
    assert.equal(fs.existsSync(activePath), true, 'ticket must appear in active');

    const yaml = fs.readFileSync(activePath, 'utf8');
    assert.match(yaml, /^priority:\s*0$/m);
  });
});

test('paused-pager Expedite route sets priority: 0 when the YAML has no existing priority line', async () => {
  const target = mkTmp();
  writeBacklogTicket(
    target,
    'paused',
    'BL-021',
    'id: BL-021\ntitle: paused no priority\nstatus: paused\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-021' }),
    });
    assert.equal(res.status, 200);

    const activePath = path.join(target, 'backlog', 'active', 'BL-021.yaml');
    const yaml = fs.readFileSync(activePath, 'utf8');
    assert.match(yaml, /^priority:\s*0$/m);
  });
});

test('paused-pager Expedite route returns 404 when the ticket cannot be found in active/paused', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-NOT-EXIST' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.reason, 'ticket not found in active/paused');
  });
});

test('paused-pager Expedite route rejects a malformed body without performing any YAML or backlog mutation', async () => {
  const target = mkTmp();
  writeBacklogTicket(
    target,
    'paused',
    'BL-030',
    'id: BL-030\ntitle: malformed body target\nstatus: paused\npriority: 3\n'
  );

  await withBridge(target, {}, async (handle) => {
    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-030.yaml');
    const originalYaml = fs.readFileSync(pausedPath, 'utf8');

    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ notId: 'BL-030' }),
    });
    assert.equal(res.status, 400);

    // Ticket must remain in paused, YAML must be unchanged.
    assert.equal(fs.existsSync(pausedPath), true);
    const yamlAfter = fs.readFileSync(pausedPath, 'utf8');
    assert.equal(yamlAfter, originalYaml);
  });
});

test('paused-pager Expedite route rejects an oversized body without parsing it or mutating YAML/backlog', async () => {
  const target = mkTmp();
  writeBacklogTicket(
    target,
    'paused',
    'BL-031',
    'id: BL-031\ntitle: oversized body target\nstatus: paused\npriority: 4\n'
  );

  await withBridge(target, {}, async (handle) => {
    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-031.yaml');
    const originalYaml = fs.readFileSync(pausedPath, 'utf8');

    const oversized = { id: 'BL-031', pad: 'x'.repeat(10 * 1024) };
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(oversized),
    }).catch(() => null);

    // Either a rejected HTTP response or a fetch-level network error is
    // acceptable as "body too large refused" — the critical guard is that
    // backlog/YAML are unchanged.
    if (res) {
      assert.notEqual(res.status, 200);
    }
    assert.equal(fs.existsSync(pausedPath), true);
    const yamlAfter = fs.readFileSync(pausedPath, 'utf8');
    assert.equal(yamlAfter, originalYaml);
  });
});
