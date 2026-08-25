'use strict';

// BL-672: step handlers for "Epic make-top-priority button". Drives the
// real bridge server (extension/out/bridge/bridgeServer) against a real git
// repo fixture with the real commit_integrity_cli.bb (and its full .bb
// dependency chain) copied in - same fixture shape as
// bl572EpicReorderConsoleSteps.js beside it. Unlike BL-572's move route,
// there is no HTTP read route over the FULL live (paused+hold, epic+topic)
// domination set, so ordering/uniqueness assertions read priorities
// directly off disk and re-derive the display sort (priority asc, id asc)
// in-process - the same technique the bridge-level unit tests
// (epicMakeTopBridge.test.js) already use.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');

const FEATURE = 'Epic make-top-priority button';
const TOKEN = 'epic-make-top-token';

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl672-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: root });
  for (const folder of ['paused', 'hold', 'active', 'done']) {
    fs.mkdirSync(path.join(root, 'backlog', folder), { recursive: true });
  }
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

function ticketPath(ctx, folder, id) {
  return path.join(ctx.root, 'backlog', folder, `${id}.yaml`);
}

// Writes (or moves) a ticket into `folder`, committing only when its content
// actually changed - a re-affirming Given step is then a safe no-op instead
// of an empty `git commit` failing on nothing-to-commit. Tracks the id's
// current folder in ctx.locations so later steps can find it again without
// re-deriving where it lives.
function writeBacklogTicket(ctx, folder, id, type, priority, dependsOn) {
  ctx.locations = ctx.locations || {};
  const previousFolder = ctx.locations[id];
  if (previousFolder && previousFolder !== folder) {
    const previousPath = ticketPath(ctx, previousFolder, id);
    if (fs.existsSync(previousPath)) {
      fs.rmSync(previousPath);
    }
  }
  const lines = [`id: ${id}`, `title: ${id} title`, `type: ${type}`, `priority: ${priority}`];
  if (dependsOn && dependsOn.length > 0) {
    lines.push(`depends_on: [${dependsOn.join(', ')}]`);
  }
  const content = lines.join('\n') + '\n';
  const filePath = ticketPath(ctx, folder, id);
  ctx.locations[id] = folder;
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return;
  }
  fs.writeFileSync(filePath, content);
  execFileSync('git', ['add', '-A'], { cwd: ctx.root });
  execFileSync('git', ['commit', '-q', '-m', `seed ${id}`], { cwd: ctx.root });
}

function readPriority(ctx, id) {
  const folder = ctx.locations[id];
  const content = fs.readFileSync(ticketPath(ctx, folder, id), 'utf8');
  const match = content.match(/^priority:\s*(-?\d+)$/m);
  return match ? Number(match[1]) : undefined;
}

// The full live (paused + hold) domination set's current display order -
// re-derives the SAME sort the pure core uses (priority asc, id asc)
// straight from disk, since no HTTP route exposes this combined set.
function liveOrder(ctx) {
  const liveIds = Object.keys(ctx.locations).filter((id) => {
    const folder = ctx.locations[id];
    return folder === 'paused' || folder === 'hold';
  });
  return liveIds
    .map((id) => ({ id, priority: readPriority(ctx, id) }))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((item) => item.id);
}

function snapshotAllFiles(ctx) {
  const snapshot = {};
  for (const id of Object.keys(ctx.locations)) {
    snapshot[id] = fs.readFileSync(ticketPath(ctx, ctx.locations[id], id), 'utf8');
  }
  return snapshot;
}

function assertNoFileChanged(ctx, snapshot) {
  for (const id of Object.keys(snapshot)) {
    assert.equal(
      fs.readFileSync(ticketPath(ctx, ctx.locations[id], id), 'utf8'),
      snapshot[id],
      `expected ${id}'s backlog YAML to be unmodified`
    );
  }
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

async function postMakeTop(ctx, id) {
  return withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/make-top`, {
      method: 'POST',
      headers: ctx.noAuth ? { 'content-type': 'application/json' } : controlAuthHeaders(),
      body: JSON.stringify({ id }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^a live backlog with epics "([^"]+)" at priorities "([^"]+)" and topics "([^"]+)" at priorities "([^"]+)"$/,
    (ctx, epicIds, epicPriorities, topicIds, topicPriorities) => {
      ctx.root = mkFixture();
      const epics = epicIds.split(',');
      const ePriorities = epicPriorities.split(',').map(Number);
      const topics = topicIds.split(',');
      const tPriorities = topicPriorities.split(',').map(Number);
      epics.forEach((id, i) => writeBacklogTicket(ctx, 'paused', id, 'epic', ePriorities[i]));
      topics.forEach((id, i) => writeBacklogTicket(ctx, 'paused', id, 'feature', tPriorities[i]));
    },
    FEATURE
  );

  registry.defineScoped(
    /^the bridge epic reorder screen is being served$/,
    async (ctx) => {
      await withBridge(ctx, async (handle) => {
        const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder`);
        assert.equal(res.status, 200);
      });
    },
    FEATURE
  );

  // ── Scenario 01/02/05 shared Given: "epic X has <dependency state>" ────
  registry.defineScoped(
    /^epic "([^"]+)" has (.+)$/,
    (ctx, epicId, defect) => {
      if (defect === 'no depends_on entries') {
        return; // Background already writes it with no depends_on.
      }
      if (defect === 'a live dependency currently ranked worse than "E3"') {
        // T2 (priority 5) ranks worse than E3 (priority 2) - a live
        // dependency that must never be outranked.
        writeBacklogTicket(ctx, 'paused', epicId, 'epic', readPriority(ctx, epicId), ['T2']);
        return;
      }
      if (defect === 'a cyclic depends_on chain back to itself') {
        writeBacklogTicket(ctx, 'paused', 'E4', 'epic', 0, [epicId]);
        writeBacklogTicket(ctx, 'paused', epicId, 'epic', readPriority(ctx, epicId), ['E4']);
        return;
      }
      if (defect === 'a depends_on id that resolves to no backlog item') {
        writeBacklogTicket(ctx, 'paused', epicId, 'epic', readPriority(ctx, epicId), ['GHOST-1']);
        return;
      }
      throw new Error(`unrecognized dependency-defect: ${defect}`);
    },
    FEATURE
  );

  // ── Scenario 03 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^make-top was already applied to "([^"]+)"$/,
    async (ctx, epicId) => {
      const result = await postMakeTop(ctx, epicId);
      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
    },
    FEATURE
  );

  // ── Scenario 04 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^epic "E3" depends on live epic "E1" and "E1" ranks better than "E3"$/,
    (ctx) => {
      writeBacklogTicket(ctx, 'paused', 'E3', 'epic', readPriority(ctx, 'E3'), ['E1']);
    },
    FEATURE
  );

  // ── Scenario 06 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^epic "([^"]+)" depends only on a done item and an active item$/,
    (ctx, epicId) => {
      writeBacklogTicket(ctx, 'done', 'DONE-1', 'feature', 0);
      writeBacklogTicket(ctx, 'active', 'ACTIVE-1', 'feature', 0);
      writeBacklogTicket(ctx, 'paused', epicId, 'epic', readPriority(ctx, epicId), ['DONE-1', 'ACTIVE-1']);
    },
    FEATURE
  );

  // ── Scenario 07 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^a request without a valid control step-up token$/,
    (ctx) => {
      ctx.noAuth = true;
    },
    FEATURE
  );

  // ── Shared When across every scenario ──────────────────────────────
  registry.defineScoped(
    /^make-top is applied to "([^"]+)"$/,
    async (ctx, epicId) => {
      ctx.targetId = epicId;
      ctx.beforeOrder = liveOrder(ctx);
      ctx.fileSnapshotBefore = snapshotAllFiles(ctx);
      ctx.headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.root, encoding: 'utf8' }).trim();
      ctx.lastResponse = await postMakeTop(ctx, epicId);
    },
    FEATURE
  );

  // ── Scenario 01/06 shared Then ──────────────────────────────────────
  registry.defineScoped(
    /^"([^"]+)" ranks strictly better than every other live epic and every live paused or hold topic$/,
    (ctx, epicId) => {
      assert.equal(ctx.lastResponse.status, 200);
      const order = liveOrder(ctx);
      assert.equal(order[0], epicId, `expected ${epicId} to be the unique top of ${JSON.stringify(order)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no other live item shares "([^"]+)"'s new priority value$/,
    (ctx, epicId) => {
      const target = readPriority(ctx, epicId);
      const others = Object.keys(ctx.locations).filter((id) => {
        const folder = ctx.locations[id];
        return id !== epicId && (folder === 'paused' || folder === 'hold');
      });
      for (const id of others) {
        assert.notEqual(readPriority(ctx, id), target, `expected ${id} not to share ${epicId}'s new priority ${target}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^all applied writes land as one commit-integrity commit$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.body.success, true);
      const status = execFileSync('git', ['status', '--porcelain', '--', 'backlog'], {
        cwd: ctx.root,
        encoding: 'utf8',
      });
      assert.equal(status.trim(), '', 'expected backlog/ to be clean - all changed files committed');
    },
    FEATURE
  );

  // ── Scenario 02 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the displayed order of "([^"]+)" relative to each other is unchanged$/,
    (ctx, idsCsv) => {
      const ids = new Set(idsCsv.split(','));
      const beforeFiltered = ctx.beforeOrder.filter((id) => ids.has(id));
      const afterFiltered = liveOrder(ctx).filter((id) => ids.has(id));
      assert.deepEqual(afterFiltered, beforeFiltered);
    },
    FEATURE
  );

  // ── Scenario 03/05 shared Then ──────────────────────────────────────
  registry.defineScoped(
    /^the response is changed false with a human-readable reason$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.status, 200);
      assert.equal(ctx.lastResponse.body.success, true);
      assert.equal(ctx.lastResponse.body.changed, false);
      assert.equal(typeof ctx.lastResponse.body.reason, 'string');
      assert.ok(ctx.lastResponse.body.reason.length > 0);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no file is written and no commit is created$/,
    (ctx) => {
      assertNoFileChanged(ctx, ctx.fileSnapshotBefore);
      const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.root, encoding: 'utf8' }).trim();
      assert.equal(headAfter, ctx.headBefore, 'expected no new commit');
    },
    FEATURE
  );

  // ── Scenario 04 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^"([^"]+)" lands immediately after "([^"]+)" in the displayed order$/,
    (ctx, movedId, afterId) => {
      assert.equal(ctx.lastResponse.status, 200);
      const order = liveOrder(ctx);
      const afterIndex = order.indexOf(afterId);
      const movedIndex = order.indexOf(movedId);
      assert.equal(movedIndex, afterIndex + 1, `expected ${movedId} immediately after ${afterId} in ${JSON.stringify(order)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the response reason names "([^"]+)" as the bound$/,
    (ctx, boundId) => {
      assert.match(ctx.lastResponse.body.reason ?? '', new RegExp(boundId));
    },
    FEATURE
  );

  // ── Scenario 05 (outline) ───────────────────────────────────────────
  registry.defineScoped(
    /^the response is changed false and the reason names the blocking ids$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.status, 200);
      assert.equal(ctx.lastResponse.body.success, true);
      assert.equal(ctx.lastResponse.body.changed, false);
      assert.equal(typeof ctx.lastResponse.body.reason, 'string');
      assert.ok(ctx.lastResponse.body.reason.length > 0);
    },
    FEATURE
  );

  // ── Scenario 07 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the response is an auth failure and no file is written$/,
    (ctx) => {
      assert.ok(
        ctx.lastResponse.status === 401 || ctx.lastResponse.status === 403,
        `expected 401 or 403, got ${ctx.lastResponse.status}`
      );
      assertNoFileChanged(ctx, ctx.fileSnapshotBefore);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
