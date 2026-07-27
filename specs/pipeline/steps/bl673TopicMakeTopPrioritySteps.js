'use strict';

// BL-673: step handlers for "Topic make-top-priority within an epic".
// Drives the real bridge server against a real git repo fixture with the
// real commit_integrity_cli.bb dependency chain copied in - same fixture
// shape as bl672EpicMakeTopPrioritySteps.js beside it. No HTTP route exposes
// the full live domination set, so ordering/uniqueness assertions read
// priorities directly off disk, same technique as BL-672's own steps.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');

const FEATURE = 'Topic make-top-priority within an epic';
const TOKEN = 'topic-make-top-token';

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl673-'));
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

function writeBacklogTicket(ctx, folder, id, type, epic, priority, dependsOn) {
  ctx.locations = ctx.locations || {};
  ctx.epics = ctx.epics || {};
  ctx.types = ctx.types || {};
  const previousFolder = ctx.locations[id];
  if (previousFolder && previousFolder !== folder) {
    const previousPath = ticketPath(ctx, previousFolder, id);
    if (fs.existsSync(previousPath)) {
      fs.rmSync(previousPath);
    }
  }
  const lines = [`id: ${id}`, `title: ${id} title`, `type: ${type}`];
  if (epic) {
    lines.push(`epic: ${epic}`);
  }
  lines.push(`priority: ${priority}`);
  if (dependsOn && dependsOn.length > 0) {
    lines.push(`depends_on: [${dependsOn.join(', ')}]`);
  }
  const content = lines.join('\n') + '\n';
  const filePath = ticketPath(ctx, folder, id);
  ctx.locations[id] = folder;
  ctx.types[id] = type;
  if (epic) {
    ctx.epics[id] = epic;
  }
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

// BL-686 invariant 3: an epic tracker is never itself one of "epic X's live
// topics" - mirrors the production route's own `type !== 'epic'` exclusion
// so this file's local bookkeeping can't disagree with what the real route
// actually does.
function liveOrder(ctx, epicFilter) {
  const liveIds = Object.keys(ctx.locations).filter((id) => {
    const folder = ctx.locations[id];
    const isLive = (folder === 'paused' || folder === 'hold') && ctx.types[id] !== 'epic';
    return isLive && (!epicFilter || ctx.epics[id] === epicFilter);
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

async function postTopicMakeTop(ctx, epicId, topicId) {
  return withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/topic-make-top`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ epicId, topicId }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^a live backlog where epic "([^"]+)" has topics "([^"]+)" at priorities "([^"]+)" and epic "([^"]+)" has topics "([^"]+)" at priorities "([^"]+)"$/,
    (ctx, epicA, topicIdsA, prioritiesA, epicB, topicIdsB, prioritiesB) => {
      ctx.root = mkFixture();
      // BL-686: a real epic ticket's own `epic:` slug is never its `id:` -
      // "EA"/"EB" stay the epic tickets' ids (the wire identity every
      // postTopicMakeTop call below still sends), but their topics declare
      // a DIFFERENT slug, and a real `type: epic` ticket is written for
      // each so the route can resolve id -> slug the same way production
      // data requires.
      ctx.epicSlugs = { [epicA]: `${epicA}-slug`, [epicB]: `${epicB}-slug` };
      writeBacklogTicket(ctx, 'paused', epicA, 'epic', ctx.epicSlugs[epicA], 0);
      writeBacklogTicket(ctx, 'paused', epicB, 'epic', ctx.epicSlugs[epicB], 0);
      const idsA = topicIdsA.split(',');
      const pA = prioritiesA.split(',').map(Number);
      const idsB = topicIdsB.split(',');
      const pB = prioritiesB.split(',').map(Number);
      idsA.forEach((id, i) => writeBacklogTicket(ctx, 'paused', id, 'feature', ctx.epicSlugs[epicA], pA[i]));
      idsB.forEach((id, i) => writeBacklogTicket(ctx, 'paused', id, 'feature', ctx.epicSlugs[epicB], pB[i]));
    },
    FEATURE
  );

  registry.defineScoped(
    /^the bridge is serving the topic make-top route$/,
    async (ctx) => {
      await withBridge(ctx, async (handle) => {
        const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder`);
        assert.equal(res.status, 200);
      });
    },
    FEATURE
  );

  // ── Scenario 01/02/05 shared Given ──────────────────────────────────
  registry.defineScoped(
    /^topic "([^"]+)" has (.+)$/,
    (ctx, topicId, defect) => {
      if (defect === 'no depends_on entries') {
        return;
      }
      if (defect === 'a cyclic depends_on chain back to itself') {
        writeBacklogTicket(ctx, 'paused', 'A4', 'feature', ctx.epics[topicId], 0, [topicId]);
        writeBacklogTicket(ctx, 'paused', topicId, 'feature', ctx.epics[topicId], readPriority(ctx, topicId), ['A4']);
        return;
      }
      if (defect === 'a depends_on id that resolves to no backlog item') {
        writeBacklogTicket(ctx, 'paused', topicId, 'feature', ctx.epics[topicId], readPriority(ctx, topicId), ['GHOST-1']);
        return;
      }
      throw new Error(`unrecognized dependency-defect: ${defect}`);
    },
    FEATURE
  );

  // ── Scenario 03 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^topic "A3" depends on live topic "A1" and "A1" ranks better than "A3"$/,
    (ctx) => {
      writeBacklogTicket(ctx, 'paused', 'A3', 'feature', ctx.epics.A3, readPriority(ctx, 'A3'), ['A1']);
    },
    FEATURE
  );

  // ── Scenario 04 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^topic "A3" depends on live topic "B2" and "B2" ranks worse than "A3"$/,
    (ctx) => {
      writeBacklogTicket(ctx, 'paused', 'A3', 'feature', ctx.epics.A3, readPriority(ctx, 'A3'), ['B2']);
    },
    FEATURE
  );

  // ── Scenario 06 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^topic "([^"]+)" depends only on a done item and an active item$/,
    (ctx, topicId) => {
      writeBacklogTicket(ctx, 'done', 'DONE-1', 'feature', null, 0);
      writeBacklogTicket(ctx, 'active', 'ACTIVE-1', 'feature', null, 0);
      writeBacklogTicket(ctx, 'paused', topicId, 'feature', ctx.epics[topicId], readPriority(ctx, topicId), [
        'DONE-1',
        'ACTIVE-1',
      ]);
    },
    FEATURE
  );

  // ── Scenario 07 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^topic "([^"]+)" carries epic "([^"]+)"$/,
    (ctx, topicId, epicId) => {
      assert.equal(
        ctx.epics[topicId],
        ctx.epicSlugs[epicId],
        `expected ${topicId} to already carry epic ${epicId}'s slug from the Background`
      );
    },
    FEATURE
  );

  // ── Scenario 08 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^topic make-top was already applied to "([^"]+)" in epic "([^"]+)"$/,
    async (ctx, topicId, epicId) => {
      const result = await postTopicMakeTop(ctx, epicId, topicId);
      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
    },
    FEATURE
  );

  // ── Shared When ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^topic make-top is applied to "([^"]+)" in epic "([^"]+)"$/,
    async (ctx, topicId, epicId) => {
      ctx.targetId = topicId;
      ctx.beforeOrder = liveOrder(ctx);
      ctx.fileSnapshotBefore = snapshotAllFiles(ctx);
      ctx.headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.root, encoding: 'utf8' }).trim();
      ctx.lastResponse = await postTopicMakeTop(ctx, epicId, topicId);
    },
    FEATURE
  );

  // ── Scenario 01/06 shared Then ──────────────────────────────────────
  registry.defineScoped(
    /^"([^"]+)" ranks strictly better than every other live topic of epic "([^"]+)"$/,
    (ctx, topicId, epicId) => {
      assert.equal(ctx.lastResponse.status, 200);
      const order = liveOrder(ctx, ctx.epicSlugs[epicId]);
      assert.equal(order[0], topicId, `expected ${topicId} to be the top of epic ${epicId}'s topics: ${JSON.stringify(order)}`);
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

  // ── Scenario 03 ─────────────────────────────────────────────────────
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

  // ── Scenario 04 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the response is changed false and the reason names "([^"]+)"$/,
    (ctx, blockingId) => {
      assert.equal(ctx.lastResponse.status, 200);
      assert.equal(ctx.lastResponse.body.changed, false);
      assert.match(ctx.lastResponse.body.reason ?? '', new RegExp(blockingId));
    },
    FEATURE
  );

  // ── Scenario 03/04/05/08 shared Then ─────────────────────────────────
  registry.defineScoped(
    /^no file is written and no commit is created$/,
    (ctx) => {
      assertNoFileChanged(ctx, ctx.fileSnapshotBefore);
      const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.root, encoding: 'utf8' }).trim();
      assert.equal(headAfter, ctx.headBefore, 'expected no new commit');
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
    /^the response is a not-found refusal and no file is written$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.status, 404);
      assertNoFileChanged(ctx, ctx.fileSnapshotBefore);
    },
    FEATURE
  );

  // ── Scenario 08 ─────────────────────────────────────────────────────
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
}

module.exports = { registerSteps };
