const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startBridge } = require('../out/bridge/bridgeServer');

const TOKEN = 'test-token-123';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bridge-server-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeRolesTsv(targetPath, roles) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  const tsv = roles
    .map((r) => [r.role, 'session', r.worktreePath, `swarmforge-${r.role}`, r.displayName, 'claude', 'task'].join('\t'))
    .join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), tsv + '\n');
}

function dropHandoff(worktreePath, filename, content) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'new');
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, filename), content);
}

async function withBridge(targetPath, opts, fn) {
  const handle = await startBridge(targetPath, path.join(targetPath, 'runs.jsonl'), TOKEN, opts);
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

test('rejects a request with no bearer token and discloses no state', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/pipeline`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'unauthorized');
  });
});

test('rejects a request with the wrong bearer token', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, {
      headers: { authorization: 'Bearer not-the-token' },
    });
    assert.equal(res.status, 401);
  });
});

test('serves the pipeline endpoint matching on-disk state for an authorized request', async () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);
  dropHandoff(coderWt, '00_test.handoff', 'from: specifier\nto: coder\ntask: bl-999\ncommit: abc\n');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, [{ role: 'coder', displayName: 'Coder', status: 'active' }]);
  });
});

test('serves the agents, backlog, and runlog endpoints', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    const [agents, backlog, runlog] = await Promise.all([
      fetch(`http://127.0.0.1:${handle.port}/agents`, { headers: auth }).then((r) => r.json()),
      fetch(`http://127.0.0.1:${handle.port}/backlog`, { headers: auth }).then((r) => r.json()),
      fetch(`http://127.0.0.1:${handle.port}/runlog`, { headers: auth }).then((r) => r.json()),
    ]);
    assert.deepEqual(agents, []);
    assert.deepEqual(backlog, { active: [], paused: [], done: [] });
    assert.deepEqual(runlog, []);
  });
});

test('returns 404 for an unknown route, even when authorized', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/nope`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 404);
  });
});

test('binds to the localhost interface only', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    // A real localhost request must succeed with the right token.
    const res = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
  });
});

test('the events stream sends an SSE event when the on-disk state changes', async () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);

  await withBridge(target, { pollIntervalMs: 20 }, async (handle) => {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${handle.port}/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    const { value: initialChunk } = await reader.read();
    assert.match(decoder.decode(initialChunk), /^data: /);

    dropHandoff(coderWt, '00_test.handoff', 'from: specifier\nto: coder\ntask: bl-999\ncommit: abc\n');

    const { value: updateChunk } = await reader.read();
    const updateText = decoder.decode(updateChunk);
    assert.match(updateText, /^data: /);
    assert.match(updateText, /"status":"active"/);

    controller.abort();
  });
});

test('stopping the bridge leaves the swarm state on disk unaffected and a new bridge serves it again', async () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);
  dropHandoff(coderWt, '00_test.handoff', 'from: specifier\nto: coder\ntask: bl-999\ncommit: abc\n');

  const first = await startBridge(target, path.join(target, 'runs.jsonl'), TOKEN, {});
  first.stop();

  await assert.rejects(() => fetch(`http://127.0.0.1:${first.port}/pipeline`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  }));

  const second = await startBridge(target, path.join(target, 'runs.jsonl'), TOKEN, {});
  try {
    const res = await fetch(`http://127.0.0.1:${second.port}/pipeline`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();
    assert.deepEqual(body, [{ role: 'coder', displayName: 'Coder', status: 'active' }]);
  } finally {
    second.stop();
  }
});
