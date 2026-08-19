'use strict';

// BL-905: step handlers for "Reorder epics lists only epics that have live
// children". This is a CERTIFICATION ticket, not a new-behavior ticket - the
// code (extension/src/bridge/epicTopicSlugMatch.ts's filterEpicsWithTopics,
// bridgeServer.ts's readEpicReorderMembership) is already on main from
// hotfix 0f5394a2d0. These step handlers are the one genuinely new artifact
// this ticket adds: they drive the real bridge server (same
// startBridge/git-fixture shape as bl572EpicReorderConsoleSteps.js and
// bl672EpicMakeTopPrioritySteps.js beside it) to exercise the three locked
// bullets end to end, rather than merely re-reading the unit tests that
// already cover the pure functions.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');

const FEATURE = 'Reorder epics lists only epics that have live children';
const TOKEN = 'bl905-reorder-token';

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough that would lump a mutated token into a
// silent default.
const LIVE_FOLDERS = new Set(['paused', 'hold', 'active', 'done']);

function parseFolder(token) {
  if (!LIVE_FOLDERS.has(token)) {
    throw new Error(`unknown folder token: ${token}`);
  }
  return token;
}

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl905-'));
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

function ticketPath(ctx, folder, id) {
  return path.join(ctx.root, 'backlog', folder, `${id}.yaml`);
}

function commitAll(ctx, message) {
  execFileSync('git', ['add', '-A'], { cwd: ctx.root });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: ctx.root });
}

// Epics live only in backlog/paused (the locked bullets never move a
// tracker's own file) - a distinct `slug` from `id` on purpose, so
// membership genuinely exercises BL-686 slug resolution rather than
// incidentally working because a slug happens to equal a ticket id.
function writeEpic(ctx, id, priority, slug) {
  fs.mkdirSync(path.join(ctx.root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(
    ticketPath(ctx, 'paused', id),
    `id: ${id}\ntitle: ${id} epic\ntype: epic\npriority: ${priority}\nepic: ${slug}\n`
  );
  commitAll(ctx, `seed epic ${id}`);
}

function writeChild(ctx, folder, id, slug) {
  fs.mkdirSync(path.join(ctx.root, 'backlog', folder), { recursive: true });
  fs.writeFileSync(ticketPath(ctx, folder, id), `id: ${id}\ntitle: ${id} child\ntype: feature\npriority: 100\nepic: ${slug}\n`);
  commitAll(ctx, `seed child ${id}`);
}

function readPriority(ctx, id) {
  const content = fs.readFileSync(ticketPath(ctx, 'paused', id), 'utf8');
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

function snapshot(ctx, ids) {
  ctx.snapshot = ctx.snapshot || {};
  for (const id of ids) {
    ctx.snapshot[id] = fs.readFileSync(ticketPath(ctx, 'paused', id), 'utf8');
  }
}

function assertUnchanged(ctx, ids) {
  for (const id of ids) {
    assert.equal(fs.readFileSync(ticketPath(ctx, 'paused', id), 'utf8'), ctx.snapshot[id], `expected ${id}'s backlog YAML to be unmodified`);
  }
}

async function fetchReorderState(ctx) {
  return withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    return res.json();
  });
}

async function moveEpic(ctx, id, direction) {
  return withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/move`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id, direction }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
}

async function makeTop(ctx, id) {
  return withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/make-top`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a backlog containing paused epic trackers$/,
    (ctx) => {
      ctx.root = mkFixture();
    },
    FEATURE
  );

  registry.defineScoped(/^epic membership is resolved by slug$/, () => {}, FEATURE);

  // ── Scenario 01: no children at all ──────────────────────────────────
  registry.defineScoped(
    /^an epic tracker with no children in any folder$/,
    (ctx) => {
      ctx.testEpicId = 'BL-905-EMPTY';
      writeEpic(ctx, ctx.testEpicId, 10, 'empty-slug');
      snapshot(ctx, [ctx.testEpicId]);
    },
    FEATURE
  );

  registry.defineScoped(
    /^that epic's file is unchanged on disk$/,
    (ctx) => {
      assertUnchanged(ctx, [ctx.testEpicId]);
    },
    FEATURE
  );

  // ── Scenario 02 (Outline): exactly one live child, per folder ───────────
  registry.defineScoped(
    /^an epic tracker whose only child is in (.+)$/,
    (ctx, token) => {
      const folder = parseFolder(token);
      ctx.testEpicId = `BL-905-${folder.toUpperCase()}-CHILD`;
      const slug = `${folder}-slug`;
      writeEpic(ctx, ctx.testEpicId, 10, slug);
      writeChild(ctx, folder, `${ctx.testEpicId}-T`, slug);
    },
    FEATURE
  );

  // ── Shared When across scenarios 01/02/03/05 ─────────────────────────
  registry.defineScoped(
    /^the reorder state is requested$/,
    async (ctx) => {
      ctx.state = await fetchReorderState(ctx);
      ctx.listedIds = ctx.state.items.map((item) => item.id);
    },
    FEATURE
  );

  // ── Shared Then across scenarios 01/02/03 ────────────────────────────
  registry.defineScoped(
    /^that epic is (listed|not listed)$/,
    (ctx, token) => {
      const expectedListed = token === 'listed';
      assert.equal(
        ctx.listedIds.includes(ctx.testEpicId),
        expectedListed,
        `expected ${ctx.testEpicId} listed=${expectedListed}, got items ${JSON.stringify(ctx.listedIds)}`
      );
    },
    FEATURE
  );

  // ── Scenario 03: an epic is not a child of itself ────────────────────
  registry.defineScoped(
    /^an epic tracker whose only slug match is another epic tracker$/,
    (ctx) => {
      ctx.testEpicId = 'BL-905-SELF-A';
      writeEpic(ctx, ctx.testEpicId, 10, 'shared-epic-slug');
      writeEpic(ctx, 'BL-905-SELF-B', 20, 'shared-epic-slug');
    },
    FEATURE
  );

  // ── Scenario 04: a hidden epic cannot swallow a move ─────────────────
  registry.defineScoped(
    /^a childless epic tracker positioned between two epics with children$/,
    (ctx) => {
      ctx.upperId = 'BL-905-UPPER';
      ctx.childlessId = 'BL-905-MIDDLE-EMPTY';
      ctx.lowerId = 'BL-905-LOWER';
      writeEpic(ctx, ctx.upperId, 10, 'upper-slug');
      writeChild(ctx, 'paused', `${ctx.upperId}-T`, 'upper-slug');
      writeEpic(ctx, ctx.childlessId, 20, 'middle-empty-slug');
      writeEpic(ctx, ctx.lowerId, 30, 'lower-slug');
      writeChild(ctx, 'paused', `${ctx.lowerId}-T`, 'lower-slug');
      snapshot(ctx, [ctx.childlessId]);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the lower epic with children is moved up$/,
    async (ctx) => {
      ctx.lastResponse = await moveEpic(ctx, ctx.lowerId, 'up');
    },
    FEATURE
  );

  registry.defineScoped(
    /^it exchanges places with the upper epic with children$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.status, 200);
      assert.equal(ctx.lastResponse.body && ctx.lastResponse.body.success, true);
      assert.equal(ctx.lastResponse.body.changed, true);
      assert.equal(readPriority(ctx, ctx.lowerId), 10, 'expected the moved epic to take the upper epic\'s old priority');
      assert.equal(readPriority(ctx, ctx.upperId), 30, 'expected the displaced epic to take the moved epic\'s old priority');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the childless epic tracker keeps its position on disk$/,
    (ctx) => {
      assertUnchanged(ctx, [ctx.childlessId]);
      assert.equal(readPriority(ctx, ctx.childlessId), 20);
    },
    FEATURE
  );

  // ── Scenario 05: the listing and the move neighbours never disagree ─────
  registry.defineScoped(
    /^a backlog mixing epics with and without live children$/,
    (ctx) => {
      ctx.hiddenIds = ['BL-905-MIX-HIDDEN-A', 'BL-905-MIX-HIDDEN-C'];
      writeEpic(ctx, ctx.hiddenIds[0], 5, 'mix-hidden-a-slug');
      writeEpic(ctx, 'BL-905-MIX-B', 10, 'mix-b-slug');
      writeChild(ctx, 'paused', 'BL-905-MIX-B-T', 'mix-b-slug');
      writeEpic(ctx, ctx.hiddenIds[1], 15, 'mix-hidden-c-slug');
      writeEpic(ctx, 'BL-905-MIX-D', 20, 'mix-d-slug');
      writeChild(ctx, 'paused', 'BL-905-MIX-D-T', 'mix-d-slug');
      writeEpic(ctx, 'BL-905-MIX-E', 25, 'mix-e-slug');
      writeChild(ctx, 'paused', 'BL-905-MIX-E-T', 'mix-e-slug');
      ctx.selectedId = 'BL-905-MIX-D';
      ctx.neighbourId = 'BL-905-MIX-B';
      snapshot(ctx, [...ctx.hiddenIds, 'BL-905-MIX-E']);
    },
    FEATURE
  );

  registry.defineScoped(
    /^an epic is moved$/,
    async (ctx) => {
      ctx.lastResponse = await moveEpic(ctx, ctx.selectedId, 'up');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the move resolves against exactly the epics that were listed$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.status, 200);
      assert.equal(ctx.lastResponse.body && ctx.lastResponse.body.success, true);
      assert.equal(ctx.lastResponse.body.changed, true);
      // The moved epic's real on-screen neighbour is the nearest LISTED
      // epic above it (BL-905-MIX-B), not the raw-priority nearest tracker
      // (the hidden BL-905-MIX-HIDDEN-C, which sits between them by
      // priority but was never in ctx.listedIds) - if the move route ever
      // fell back to the unfiltered epic list this assertion swaps.
      assert.equal(readPriority(ctx, ctx.selectedId), 10, "expected the moved epic to take its LISTED neighbour's old priority");
      assert.equal(readPriority(ctx, ctx.neighbourId), 20, "expected the listed neighbour to take the moved epic's old priority");
      // Every epic outside the resolved pair - hidden or listed - is
      // untouched, so the move's write set never exceeds the listed set.
      assertUnchanged(ctx, [...ctx.hiddenIds, 'BL-905-MIX-E']);
    },
    FEATURE
  );

  // ── Scenario 06: make-top still dominates hidden epics ───────────────
  registry.defineScoped(
    /^a childless epic tracker and an epic with children$/,
    (ctx) => {
      ctx.childlessId = 'BL-905-TOP-HIDDEN';
      ctx.withChildrenId = 'BL-905-TOP-LIVE';
      writeEpic(ctx, ctx.childlessId, 5, 'top-hidden-slug');
      writeEpic(ctx, ctx.withChildrenId, 15, 'top-live-slug');
      writeChild(ctx, 'paused', `${ctx.withChildrenId}-T`, 'top-live-slug');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the epic with children is made top$/,
    async (ctx) => {
      ctx.lastResponse = await makeTop(ctx, ctx.withChildrenId);
    },
    FEATURE
  );

  registry.defineScoped(
    /^its priority dominates the childless epic tracker$/,
    (ctx) => {
      assert.equal(ctx.lastResponse.status, 200);
      assert.equal(ctx.lastResponse.body && ctx.lastResponse.body.success, true);
      assert.equal(ctx.lastResponse.body.changed, true);
      const withChildren = readPriority(ctx, ctx.withChildrenId);
      const childless = readPriority(ctx, ctx.childlessId);
      assert.ok(
        withChildren < childless,
        `expected the made-top epic (${withChildren}) to dominate the hidden childless tracker (${childless})`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
