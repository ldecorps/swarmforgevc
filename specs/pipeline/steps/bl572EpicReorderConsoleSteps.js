'use strict';

// BL-572: step handlers for "Reorder epic priority from the Mini App
// console". Drives the real bridge server (extension/out/bridge/bridgeServer)
// against a real git repo fixture with the real commit_integrity_cli.bb
// (and its full .bb dependency chain) copied in - scenario 06's "committed
// to main" is real git history, never a mocked commit, same fixture shape
// as pausedPagerBridge.test.js / telegramFrontDeskBotCli.test.js's own
// commit-integrity tests.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');

const FEATURE = 'Reorder epic priority from the Mini App console';
const TOKEN = 'epic-reorder-token';

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl572-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: root });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const repoScriptsDir = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
  for (const name of fs.readdirSync(repoScriptsDir)) {
    if (name.endsWith('.bb')) {
      fs.copyFileSync(path.join(repoScriptsDir, name), path.join(scriptsDir, name));
    }
  }
  return root;
}

function epicRelPath(id) {
  return path.join('backlog', 'paused', `${id}.yaml`);
}

function epicPath(ctx, id) {
  return path.join(ctx.root, epicRelPath(id));
}

// Only writes + commits when the content actually differs, so a scenario's
// Given step re-affirming a value the Background already set (e.g.
// scenario 01 restating "priority 20") is a safe no-op instead of an empty
// `git commit` failing on nothing-to-commit.
function writeEpicTicket(ctx, id, priority) {
  const content = `id: ${id}\ntitle: ${id} epic\ntype: epic\npriority: ${priority}\n`;
  const filePath = epicPath(ctx, id);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return;
  }
  fs.writeFileSync(filePath, content);
  execFileSync('git', ['add', '-A'], { cwd: ctx.root });
  execFileSync('git', ['commit', '-q', '-m', `seed ${id}`], { cwd: ctx.root });
}

function readPriority(ctx, id) {
  const content = fs.readFileSync(epicPath(ctx, id), 'utf8');
  const match = content.match(/^priority:\s*(-?\d+)$/m);
  return match ? Number(match[1]) : undefined;
}

async function withBridge(ctx, fn) {
  const handle = await startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {});
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

function controlAuthHeaders() {
  return { authorization: `Bearer ${TOKEN}`, 'x-control-token': TOKEN, 'content-type': 'application/json' };
}

function snapshotEpicFiles(ctx, ids) {
  ctx.snapshot = {};
  for (const id of ids) {
    ctx.snapshot[id] = fs.readFileSync(epicPath(ctx, id), 'utf8');
  }
}

function assertSnapshotUnchanged(ctx, ids) {
  for (const id of ids) {
    assert.equal(
      fs.readFileSync(epicPath(ctx, id), 'utf8'),
      ctx.snapshot[id],
      `expected ${id}'s backlog YAML to be unmodified`
    );
  }
}

async function moveSelectedUp(ctx) {
  await withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: ctx.selectedId, direction: 'up' }),
    });
    ctx.lastResponse = { status: res.status, body: await res.json().catch(() => null) };
  });
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the epic reorder screen is open on the live Mini App console$/,
    async (ctx) => {
      ctx.root = mkFixture();
      await withBridge(ctx, async (handle) => {
        const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder`);
        assert.equal(res.status, 200);
      });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the epics are listed by priority, lowest value first$/,
    async (ctx) => {
      ctx.selectedId = 'BL-901';
      ctx.aboveId = 'BL-900';
      ctx.bystanderId = 'BL-999';
      writeEpicTicket(ctx, ctx.aboveId, 10);
      writeEpicTicket(ctx, ctx.selectedId, 20);
      writeEpicTicket(ctx, ctx.bystanderId, 500);
      await withBridge(ctx, async (handle) => {
        const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
        assert.equal(res.status, 200);
        const state = await res.json();
        const priorities = state.items.map((item) => item.priority);
        const sorted = [...priorities].sort((a, b) => a - b);
        assert.deepEqual(priorities, sorted, 'expected epics ordered by priority ascending');
      });
    },
    FEATURE
  );

  // ── Scenario 01/02 shared Givens ──────────────────────────────────
  registry.defineScoped(
    /^the selected epic has priority 20$/,
    (ctx) => {
      writeEpicTicket(ctx, ctx.selectedId, 20);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the epic above it has priority 10$/,
    (ctx) => {
      writeEpicTicket(ctx, ctx.aboveId, 10);
      snapshotEpicFiles(ctx, [ctx.bystanderId]);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the epic above it has priority 20$/,
    (ctx) => {
      writeEpicTicket(ctx, ctx.aboveId, 20);
      snapshotEpicFiles(ctx, [ctx.bystanderId]);
    },
    FEATURE
  );

  // ── Scenario 03 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the selected epic is first in the list$/,
    (ctx) => {
      writeEpicTicket(ctx, ctx.selectedId, 1);
      snapshotEpicFiles(ctx, [ctx.selectedId, ctx.aboveId, ctx.bystanderId]);
    },
    FEATURE
  );

  // ── Scenario 04 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^a paused ticket of type "epic" exists$/,
    (ctx) => {
      ctx.epicTicketId = 'BL-950';
      writeEpicTicket(ctx, ctx.epicTicketId, 50);
    },
    FEATURE
  );

  registry.defineScoped(
    /^a paused ticket of type "feature" exists$/,
    (ctx) => {
      ctx.featureTicketId = 'BL-951';
      fs.writeFileSync(
        epicPath(ctx, ctx.featureTicketId),
        `id: ${ctx.featureTicketId}\ntitle: not an epic\ntype: feature\npriority: 1\n`
      );
      execFileSync('git', ['add', '-A'], { cwd: ctx.root });
      execFileSync('git', ['commit', '-q', '-m', 'seed feature ticket'], { cwd: ctx.root });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the epic reorder screen loads$/,
    async (ctx) => {
      await withBridge(ctx, async (handle) => {
        const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
        assert.equal(res.status, 200);
        ctx.state = await res.json();
      });
    },
    FEATURE
  );

  registry.defineScoped(
    /^only the ticket of type "epic" is listed$/,
    (ctx) => {
      const ids = ctx.state.items.map((item) => item.id);
      assert.ok(ids.includes(ctx.epicTicketId), 'expected the epic ticket to be listed');
      assert.ok(!ids.includes(ctx.featureTicketId), 'expected the feature ticket NOT to be listed');
    },
    FEATURE
  );

  // ── Scenario 05 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^a reorder request carrying no valid control token$/,
    (ctx) => {
      snapshotEpicFiles(ctx, [ctx.selectedId]);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the request reaches the bridge$/,
    async (ctx) => {
      await withBridge(ctx, async (handle) => {
        const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: ctx.selectedId, direction: 'up' }),
        });
        ctx.lastResponse = { status: res.status };
      });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the bridge refuses the reorder$/,
    (ctx) => {
      assert.ok(
        ctx.lastResponse.status === 401 || ctx.lastResponse.status === 403,
        `expected 401 or 403, got ${ctx.lastResponse.status}`
      );
    },
    FEATURE
  );

  // ── Shared When/Then across scenarios 01/02/03/06 ────────────────────
  registry.defineScoped(/^the human moves the selected epic up$/, moveSelectedUp, FEATURE);

  registry.defineScoped(
    /^the selected epic is written with priority 10$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.status, 200);
      assert.equal(readPriority(ctx, ctx.selectedId), 10);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the epic above it is written with priority 20$/,
    (ctx) => {
      assert.equal(readPriority(ctx, ctx.aboveId), 20);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no other epic's backlog YAML is modified$/,
    (ctx) => {
      assertSnapshotUnchanged(ctx, [ctx.bystanderId]);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the selected epic ends with a lower priority value than the epic above it$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.status, 200);
      const selected = readPriority(ctx, ctx.selectedId);
      const above = readPriority(ctx, ctx.aboveId);
      assert.ok(selected < above, `expected selected (${selected}) < above (${above})`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no backlog YAML is modified$/,
    (ctx) => {
      assertSnapshotUnchanged(ctx, Object.keys(ctx.snapshot));
    },
    FEATURE
  );

  registry.defineScoped(
    /^both changed backlog YAML files are committed to main$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.status, 200);
      assert.equal(ctx.lastResponse.body && ctx.lastResponse.body.success, true);
      const status = execFileSync('git', ['status', '--porcelain', '--', 'backlog'], {
        cwd: ctx.root,
        encoding: 'utf8',
      });
      assert.equal(status.trim(), '', 'expected backlog/ to be clean - both changed files committed');
      const log = execFileSync(
        'git',
        ['log', '-1', '--format=%s', '--', epicRelPath(ctx.selectedId)],
        { cwd: ctx.root, encoding: 'utf8' }
      );
      assert.match(log, new RegExp(ctx.selectedId));
      assert.match(log, new RegExp(ctx.aboveId));
    },
    FEATURE
  );
}

module.exports = { registerSteps };
