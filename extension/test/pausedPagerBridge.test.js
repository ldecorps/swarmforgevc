const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startBridge } = require('../out/bridge/bridgeServer');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

const TOKEN = 'test-token-123';

function mkTmp() {
  return mkTmpDir('sfvc-paused-pager-bridge-');
}

// BL-892: the Approve route now durably commits its human_approval write
// through the real commit_integrity_cli.bb (never a disk-only success) - a
// target that isn't a real git repo with the CLI present would report the
// commit as (correctly) failed, so any test that expects a genuine Approve
// to SUCCEED needs a real fixture, same pattern as commitIntegrityRunner.
// test.js's own gitFixture()/copyCommitIntegrityScripts().
function mkGitTmpWithCli() {
  const root = mkTmp();
  // BL-1039: the seeded repository comes from the shared fixture - one
  // seeding per RUN instead of init+config+commit per scenario. Four
  // process spawns before the behaviour under test was even reached,
  // repeated across every test in this file. Measured 190ms -> 33ms.
  copySeededRepoInto(root);
  // BL-1038: copies commit_integrity_cli.bb's load-file CLOSURE (11 files),
  // not the whole live scripts directory - see pinnedRepoFixture.js for why.
  // BL-1083: promotion_gates_cli.bb joins it as a second entry point - the
  // Expedite route's promoteToActive now takes its verdict from the shared
  // promotion gates and fails CLOSED, so a fixture without them refuses every
  // promotion. Its dependencies come from the same closure walk, never a
  // hand-written list.
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), [
    'commit_integrity_cli.bb',
    'promotion_gates_cli.bb',
  ]);
  // A cap generous enough that no test here trips it by accident; the depth
  // gate has its own coverage in backlogWriter.test.js.
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 50\n');
  mkdirp(path.join(root, 'backlog', 'done'));
  mkdirp(path.join(root, 'backlog', 'active'));
  return root;
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
  writeBacklogTicket(target, 'paused', 'BL-003', 'id: BL-003\ntitle: third\nstatus: paused\npriority: 5\n');
  writeBacklogTicket(target, 'paused', 'BL-002', 'id: BL-002\ntitle: second\nstatus: paused\npriority: 1\n');
  writeBacklogTicket(target, 'paused', 'BL-001', 'id: BL-001\ntitle: first\nstatus: paused\n');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.deepEqual(body.items.map((i) => i.id), ['BL-002', 'BL-003', 'BL-001']);
    for (const item of body.items) {
      assert.equal(typeof item.yaml, 'string');
      assert.ok(item.canExpedite);
      assert.equal(typeof item.canApprove, 'boolean');
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
    assert.match(body, /paused-pager-state/);
    assert.match(body, /paused-pager\/expedite/);
    assert.match(body, /paused-pager\/approve/);
    assert.match(body, /font-controls/);
    assert.match(body, /id="font-dec"/);
    assert.match(body, /id="font-inc"/);
  });
});

test('paused-pager JSON feed accepts query-token auth for a plain browser navigation', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const resWithToken = await fetch(`http://127.0.0.1:${handle.port}/paused-pager-state?token=${TOKEN}`);
    assert.equal(resWithToken.status, 200);
    assert.match(resWithToken.headers.get('content-type'), /application\/json/);

    const resWithoutToken = await fetch(`http://127.0.0.1:${handle.port}/paused-pager-state`);
    assert.equal(resWithoutToken.status, 401);

    const html = await fetch(`http://127.0.0.1:${handle.port}/paused-pager`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
  });
});

test('paused-pager JSON feed: canApprove is true only for human_approval pending tickets', async () => {
  const target = mkTmp();
  writeBacklogTicket(
    target,
    'paused',
    'BL-040',
    'id: BL-040\ntitle: needs approval\nstatus: paused\nhuman_approval: pending\n'
  );
  writeBacklogTicket(
    target,
    'paused',
    'BL-041',
    'id: BL-041\ntitle: already approved\nstatus: paused\nhuman_approval: approved\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const byId = Object.fromEntries(body.items.map((item) => [item.id, item]));
    assert.equal(byId['BL-040'].canApprove, true);
    assert.equal(byId['BL-041'].canApprove, false);
  });
});

test('paused-pager Approve route requires control auth (bearer + x-control-token)', async () => {
  const target = mkGitTmpWithCli();
  writeBacklogTicket(
    target,
    'paused',
    'BL-050',
    'id: BL-050\ntitle: pending approval\nstatus: paused\nhuman_approval: pending\n'
  );

  await withBridge(target, {}, async (handle) => {
    const bearerOnlyRes = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-050' }),
    });
    assert.equal(bearerOnlyRes.status, 403);

    const okRes = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-050' }),
    });
    assert.equal(okRes.status, 200);
    const body = await okRes.json();
    assert.deepEqual(body, { success: true, id: 'BL-050' });
  });
});

test('paused-pager Approve route flips human_approval to approved without moving folders', async () => {
  const target = mkGitTmpWithCli();
  writeBacklogTicket(
    target,
    'paused',
    'BL-060',
    'id: BL-060\ntitle: pending approval\nstatus: paused\nhuman_approval: pending\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-060' }),
    });
    assert.equal(res.status, 200);

    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-060.yaml');
    assert.equal(fs.existsSync(pausedPath), true);
    const yaml = fs.readFileSync(pausedPath, 'utf8');
    assert.match(yaml, /^human_approval: approved$/m);

    // BL-892 invariant 1: HEAD, not the working tree, is the source of
    // truth. This route is the one commitApprovalWrites caller the
    // exhaustive bl892ApprovalCommitDurability property test does not
    // reach (it drives recordApprovalDecisionAndClose/
    // recordAmendDecisionAndClose directly) - assert it here instead.
    const headYaml = execFileSync('git', ['show', 'HEAD:backlog/paused/BL-060.yaml'], { cwd: target, encoding: 'utf8' });
    assert.match(headYaml, /^human_approval: approved$/m, 'expected the Approve route to commit the flip to HEAD, not just the working tree');
  });
});

test('BL-892: paused-pager Approve route surfaces a durability failure, never unqualified success, when the commit fails', async () => {
  // No git repo, no commit_integrity_cli.bb - the write succeeds (disk),
  // the commit genuinely fails, exactly the shape this ticket's own
  // qa_e2e_procedure step 3 requires.
  const target = mkTmp();
  writeBacklogTicket(
    target,
    'paused',
    'BL-892',
    'id: BL-892\ntitle: pending approval\nstatus: paused\nhuman_approval: pending\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-892' }),
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.deepEqual(body, { success: false, changed: true, id: 'BL-892', reason: 'approved but failed to commit' });

    // disk still holds the flip - the write itself was never rolled back,
    // only its durability guarantee is weaker until a later retry.
    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-892.yaml');
    const yaml = fs.readFileSync(pausedPath, 'utf8');
    assert.match(yaml, /^human_approval: approved$/m);
  });
});

test('paused-pager Approve route is a no-op for tickets not pending approval', async () => {
  const target = mkTmp();
  writeBacklogTicket(
    target,
    'paused',
    'BL-061',
    'id: BL-061\ntitle: already approved\nstatus: paused\nhuman_approval: approved\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-061' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.reason, 'not pending approval');
  });
});

test('paused-pager Expedite route requires control auth (bearer + x-control-token)', async () => {
  // BL-1083: the Expedite route now consults the real promotion gates and
  // fails closed, so its fixture has to carry them.
  const target = mkGitTmpWithCli();
  writeBacklogTicket(target, 'paused', 'BL-010', 'id: BL-010\ntitle: needs expedite\nstatus: paused\npriority: 3\n');

  await withBridge(target, {}, async (handle) => {
    const bearerOnlyRes = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-010' }),
    });
    assert.equal(bearerOnlyRes.status, 403);

    const wrongTokenRes = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'x-control-token': 'wrong', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-010' }),
    });
    assert.equal(wrongTokenRes.status, 401);

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
  const target = mkGitTmpWithCli();
  writeBacklogTicket(target, 'paused', 'BL-020', 'id: BL-020\ntitle: paused\nstatus: paused\npriority: 2\n');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-020' }),
    });
    assert.equal(res.status, 200);

    const activePath = path.join(target, 'backlog', 'active', 'BL-020.yaml');
    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-020.yaml');

    assert.equal(fs.existsSync(pausedPath), false);
    assert.equal(fs.existsSync(activePath), true);

    const yaml = fs.readFileSync(activePath, 'utf8');
    assert.match(yaml, /^priority:\s*0$/m);
  });
});

// BL-1083: the paused-pager Expedite route is the SECOND caller of
// promoteToActive - a fix that only covered the Telegram verb (exercised via
// bl1083PromotionGateSteps.js) would be this defect again with one caller
// fewer (the ticket's own qa_e2e_procedure step 3). Flagged as a zero-coverage
// gap in the architect's pass evidence (BL-1083-architect-pass-20260823.md):
// pausedPagerBridge.test.js's Expedite tests all drove the ALLOW path only.
test('paused-pager Expedite route refuses (409) and leaves the ticket in paused/ when a gate says no', async () => {
  const target = mkGitTmpWithCli();
  const original = 'id: BL-022\ntitle: unlanded dependency\nstatus: paused\ndepends_on: [BL-9999]\n';
  writeBacklogTicket(target, 'paused', 'BL-022', original);

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-022' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.deepEqual(body, {
      success: false,
      id: 'BL-022',
      gate: 'depends_on',
      reason: 'depends_on not yet landed in backlog/done/: BL-9999',
    });

    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-022.yaml');
    const activePath = path.join(target, 'backlog', 'active', 'BL-022.yaml');
    // Invariant 2: a refusal leaves the ticket exactly where it was - never a
    // silent no-op that still shuffles files.
    assert.equal(fs.existsSync(activePath), false);
    assert.equal(fs.readFileSync(pausedPath, 'utf8'), original);
  });
});

test('paused-pager Expedite route sets priority: 0 when the YAML has no existing priority line', async () => {
  // BL-1083: the Expedite route now consults the real promotion gates and
  // fails closed, so its fixture has to carry them.
  const target = mkGitTmpWithCli();
  writeBacklogTicket(target, 'paused', 'BL-021', 'id: BL-021\ntitle: paused no priority\nstatus: paused\n');

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
  // BL-1083: the Expedite route now consults the real promotion gates and
  // fails closed, so its fixture has to carry them.
  const target = mkGitTmpWithCli();
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
  writeBacklogTicket(target, 'paused', 'BL-030', 'id: BL-030\ntitle: malformed body target\nstatus: paused\npriority: 3\n');

  await withBridge(target, {}, async (handle) => {
    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-030.yaml');
    const originalYaml = fs.readFileSync(pausedPath, 'utf8');

    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ notId: 'BL-030' }),
    });
    assert.equal(res.status, 400);

    assert.equal(fs.existsSync(pausedPath), true);
    const yamlAfter = fs.readFileSync(pausedPath, 'utf8');
    assert.equal(yamlAfter, originalYaml);
  });
});

test('paused-pager Expedite route rejects an oversized body without parsing it or mutating YAML/backlog', async () => {
  const target = mkTmp();
  writeBacklogTicket(target, 'paused', 'BL-031', 'id: BL-031\ntitle: oversized body target\nstatus: paused\npriority: 4\n');

  await withBridge(target, {}, async (handle) => {
    const pausedPath = path.join(target, 'backlog', 'paused', 'BL-031.yaml');
    const originalYaml = fs.readFileSync(pausedPath, 'utf8');

    const oversized = { id: 'BL-031', pad: 'x'.repeat(10 * 1024) };
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(oversized),
    }).catch(() => null);

    if (res) {
      assert.notEqual(res.status, 200);
    }
    assert.equal(fs.existsSync(pausedPath), true);
    const yamlAfter = fs.readFileSync(pausedPath, 'utf8');
    assert.equal(yamlAfter, originalYaml);
  });
});

// ── BL-1367: an approval from any surface carries its ruling ───────────────
//
// The pager's Approve called recordApprovalReply(targetPath, backlogId) - a
// signature with no ruling parameter - so a ticket that posed a choice read as
// fully approved with the choice silently discarded. BL-1309, 2026-09-01.

test('BL-1367: the pager refuses to record consent alone for a ticket that poses a choice', async () => {
  const target = mkGitTmpWithCli();
  writeBacklogTicket(
    target,
    'paused',
    'BL-1367',
    'id: BL-1367\ntitle: poses a choice\nstatus: paused\nhuman_approval: pending\nruling_options:\n  - do it in code\n  - do it by rule\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-1367' }),
    });
    // 409, not 500: the request was well formed and the system is healthy; a
    // rule said no - the same posture the promotion gate takes one route up.
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.reason, 'ruling required');
    // The pager shows the gate's own words, so the operator learns WHICH
    // options and where to answer them (BL-572/BL-662).
    assert.deepEqual(body.options, ['do it in code', 'do it by rule']);
    assert.match(body.detail, /ruling keyboard/i);

    // Nothing recorded. Half-recording is the state this ticket removes.
    const yaml = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-1367.yaml'), 'utf8');
    assert.match(yaml, /^human_approval: pending$/m);
    assert.equal(/human_ruling/.test(yaml), false);
  });
});

test('BL-1367: the pager records the ruling when the tap carries one', async () => {
  const target = mkGitTmpWithCli();
  writeBacklogTicket(
    target,
    'paused',
    'BL-1368',
    'id: BL-1368\ntitle: poses a choice\nstatus: paused\nhuman_approval: pending\nruling_options:\n  - do it in code\n  - do it by rule\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-1368', ruling: 'do it by rule' }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, id: 'BL-1368' });

    const yaml = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-1368.yaml'), 'utf8');
    assert.match(yaml, /^human_approval: approved$/m);
    assert.match(yaml, /^human_ruling: \|\n {2}do it by rule$/m);
    // HEAD, not the working tree, is the source of truth (BL-892).
    const headYaml = execFileSync('git', ['show', 'HEAD:backlog/paused/BL-1368.yaml'], { cwd: target, encoding: 'utf8' });
    assert.match(headYaml, /^human_ruling: \|\n {2}do it by rule$/m);
  });
});

test('BL-1367: the pager refuses a ruling the ticket never offered', async () => {
  const target = mkGitTmpWithCli();
  writeBacklogTicket(
    target,
    'paused',
    'BL-1369',
    'id: BL-1369\ntitle: poses a choice\nstatus: paused\nhuman_approval: pending\nruling_options:\n  - do it in code\n  - do it by rule\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-1369', ruling: 'a third way nobody offered' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.reason, 'unknown ruling option');

    const yaml = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-1369.yaml'), 'utf8');
    assert.match(yaml, /^human_approval: pending$/m);
    assert.equal(/human_ruling/.test(yaml), false);
  });
});

test('BL-1367 invariant 3: a ticket posing no choice approves from the pager exactly as before', async () => {
  const target = mkGitTmpWithCli();
  writeBacklogTicket(
    target,
    'paused',
    'BL-1370',
    'id: BL-1370\ntitle: poses no choice\nstatus: paused\nhuman_approval: pending\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-1370' }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, id: 'BL-1370' });

    const yaml = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-1370.yaml'), 'utf8');
    assert.match(yaml, /^human_approval: approved$/m);
    assert.equal(/human_ruling/.test(yaml), false, 'a ticket posing no choice must gain no ruling');
  });
});

test('BL-1367 invariant 2: a pager approval never disturbs a ruling already recorded', async () => {
  const target = mkGitTmpWithCli();
  // The live shape this guards: BL-1296 was re-pended AFTER a ruling existed.
  writeBacklogTicket(
    target,
    'paused',
    'BL-1371',
    'id: BL-1371\ntitle: re-pended after a ruling\nstatus: paused\nhuman_approval: pending\nhuman_ruling: |\n  the answer already given\nruling_options:\n  - do it in code\n  - do it by rule\n'
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'BL-1371' }),
    });
    assert.equal(res.status, 409);

    const yaml = fs.readFileSync(path.join(target, 'backlog', 'paused', 'BL-1371.yaml'), 'utf8');
    assert.match(yaml, /^human_ruling: \|\n {2}the answer already given$/m);
    assert.match(yaml, /^human_approval: pending$/m);
  });
});
