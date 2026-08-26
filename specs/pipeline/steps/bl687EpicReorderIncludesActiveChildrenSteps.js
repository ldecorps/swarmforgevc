'use strict';

// BL-687: step handlers for "Within-epic reorder covers every live child, in
// flight included". Same real-bridge-plus-jsdom technique as
// bl686EpicDrilldownSlugMatchSteps.js beside it, extended with a folder-aware
// ticket writer (paused/active/hold/done) since this feature's own
// Background spans all four folders in one scenario.
//
// No per-scenario teardown hook (same reasoning as bl686/bl674's own files)
// - each scenario's own terminal Then step stops ctx.bridgeHandle itself.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'jsdom'));

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');

const FEATURE = 'Within-epic reorder covers every live child, in flight included';
const TOKEN = 'bl687-active-children-token';

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl687-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: root });
  for (const folder of ['paused', 'active', 'hold', 'done']) {
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

// Tracks each id's current folder in ctx.locations, same convention as
// bl672EpicMakeTopPrioritySteps.js's own writeBacklogTicket - a later step
// (e.g. the depends_on Given) can re-affirm a ticket without knowing which
// folder the Background already put it in.
function ticketPath(ctx, folder, id) {
  return path.join(ctx.root, 'backlog', folder, `${id}.yaml`);
}

function writeTicket(ctx, folder, id, type, slug, priority, dependsOn) {
  ctx.locations = ctx.locations || {};
  const previousFolder = ctx.locations[id];
  if (previousFolder && previousFolder !== folder) {
    const previousPath = ticketPath(ctx, previousFolder, id);
    if (fs.existsSync(previousPath)) {
      fs.rmSync(previousPath);
    }
  }
  const lines = [`id: ${id}`, `title: ${id} title`, `type: ${type}`];
  if (slug) {
    lines.push(`epic: ${slug}`);
  }
  lines.push(`priority: ${priority}`);
  if (dependsOn && dependsOn.length > 0) {
    lines.push(`depends_on: [${dependsOn.join(', ')}]`);
  }
  const content = lines.join('\n') + '\n';
  ctx.locations[id] = folder;
  const filePath = ticketPath(ctx, folder, id);
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

function readSlug(ctx, id) {
  const folder = ctx.locations[id];
  const content = fs.readFileSync(ticketPath(ctx, folder, id), 'utf8');
  const match = content.match(/^epic:\s*(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in the served HTML');
  }
  return match[1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(10);
  }
  return predicate();
}

async function ensureBridge(ctx) {
  if (!ctx.bridgeHandle) {
    ctx.bridgeHandle = await startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {});
  }
}

async function renderScreen(ctx) {
  const port = ctx.bridgeHandle.port;
  const res = await fetch(`http://127.0.0.1:${port}/epic-reorder`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: `https://example.github.io/reorder/?token=${TOKEN}`,
    pretendToBeVisual: true,
  });
  ctx.fetchCalls = [];
  dom.window.fetch = (url, opts) => {
    ctx.fetchCalls.push({ url, opts });
    const target = url.startsWith('http') ? url : `http://127.0.0.1:${port}${url}`;
    return fetch(target, opts);
  };
  dom.window.eval(extractInlineScript(html));
  ctx.dom = dom;
  const statusEl = dom.window.document.getElementById('status');
  const settled = await waitFor(() => statusEl.textContent !== 'Loading…');
  assert.ok(settled, `initial refresh() never settled: status stuck at "${statusEl.textContent}"`);
  return dom;
}

function rowIds(ctx) {
  return Array.prototype.map.call(ctx.dom.window.document.querySelectorAll('#content .row'), (row) =>
    row.getAttribute('data-id')
  );
}

async function drillIntoEpic(ctx, epicId) {
  const btn = ctx.dom.window.document.querySelector(`.drill[data-id="${epicId}"]`);
  assert.ok(btn, `expected a drill button for epic ${epicId}`);
  btn.onclick();
  const settled = await waitFor(() => Boolean(ctx.dom.window.document.getElementById('back-to-tiles')));
  assert.ok(settled, `drilling into epic ${epicId} never rendered the drill-down (back button never appeared)`);
}

async function tapTopicMakeTop(ctx, epicId, topicId) {
  await renderScreen(ctx);
  await drillIntoEpic(ctx, epicId);
  const btn = ctx.dom.window.document.querySelector(`.topic-make-top[data-id="${topicId}"]`);
  assert.ok(btn, `expected a make-top button for topic ${topicId} in the ${epicId} drill-down`);
  const moveStatusEl = ctx.dom.window.document.getElementById('move-status');
  const before = rowIds(ctx).join(',');
  btn.onclick();
  const settled = await waitFor(() => moveStatusEl.textContent !== '' || rowIds(ctx).join(',') !== before);
  assert.ok(settled, `tapping make-top on ${topicId} never settled`);
}

async function tapEpicTileMakeTop(ctx, epicId) {
  await renderScreen(ctx);
  const btn = ctx.dom.window.document.querySelector(`.make-top[data-id="${epicId}"]`);
  assert.ok(btn, `expected a tile make-top button for epic ${epicId}`);
  const moveStatusEl = ctx.dom.window.document.getElementById('move-status');
  btn.onclick();
  const settled = await waitFor(() => moveStatusEl.textContent !== '' || ctx.fetchCalls.some((c) => c.url.startsWith('/epic-reorder/make-top')));
  assert.ok(settled, `tapping the ${epicId} tile's make-top never settled`);
}

function stopBridge(ctx) {
  if (ctx.bridgeHandle) {
    ctx.bridgeHandle.stop();
    ctx.bridgeHandle = null;
  }
}

// BL-686 hardening precedent: any step that runs while the bridge may be
// live wraps its body with this so a mutated/bad example value throwing
// before a later stopBridge(ctx) still closes the server, rather than
// hanging the whole node --test process on an open listening socket.
function stopBridgeOnError(ctx, fn) {
  try {
    const result = fn();
    if (result && typeof result.catch === 'function') {
      return result.catch((err) => {
        stopBridge(ctx);
        throw err;
      });
    }
    return result;
  } catch (err) {
    stopBridge(ctx);
    throw err;
  }
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^epic ticket "([^"]+)" declares epic slug "([^"]+)" with priority (\d+)$/,
    (ctx, id, slug, priority) => {
      if (!ctx.root) {
        ctx.root = mkFixture();
      }
      writeTicket(ctx, 'paused', id, 'epic', slug, Number(priority));
    },
    FEATURE
  );

  registry.defineScoped(
    /^paused topic "([^"]+)" declares epic slug "([^"]+)" with priority (\d+)$/,
    (ctx, id, slug, priority) => {
      if (!ctx.root) {
        ctx.root = mkFixture();
      }
      writeTicket(ctx, 'paused', id, 'feature', slug, Number(priority));
    },
    FEATURE
  );

  registry.defineScoped(
    /^active topic "([^"]+)" declares epic slug "([^"]+)" with priority (\d+)$/,
    (ctx, id, slug, priority) => {
      if (!ctx.root) {
        ctx.root = mkFixture();
      }
      writeTicket(ctx, 'active', id, 'feature', slug, Number(priority));
    },
    FEATURE
  );

  registry.defineScoped(
    /^hold topic "([^"]+)" declares epic slug "([^"]+)" with priority (\d+)$/,
    (ctx, id, slug, priority) => {
      if (!ctx.root) {
        ctx.root = mkFixture();
      }
      writeTicket(ctx, 'hold', id, 'feature', slug, Number(priority));
    },
    FEATURE
  );

  registry.defineScoped(
    /^done topic "([^"]+)" declares epic slug "([^"]+)" with priority (\d+)$/,
    (ctx, id, slug, priority) => {
      if (!ctx.root) {
        ctx.root = mkFixture();
      }
      writeTicket(ctx, 'done', id, 'feature', slug, Number(priority));
    },
    FEATURE
  );

  // ── Scenario 05's extra Given ────────────────────────────────────────
  registry.defineScoped(
    /^hold topic "([^"]+)" depends on "([^"]+)"$/,
    (ctx, id, depId) => {
      const folder = ctx.locations[id];
      writeTicket(ctx, folder, id, 'feature', readSlug(ctx, id), readPriority(ctx, id), [depId]);
    },
    FEATURE
  );

  // ── Scenario 01/02/06's shared When ─────────────────────────────────
  registry.defineScoped(
    /^the "([^"]+)" tile is drilled into$/,
    async (ctx, epicId) => {
      await ensureBridge(ctx);
      await stopBridgeOnError(ctx, async () => {
        await renderScreen(ctx);
        await drillIntoEpic(ctx, epicId);
      });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the drill-down lists exactly "([^"]+)"$/,
    (ctx, idsCsv) => {
      stopBridgeOnError(ctx, () => assert.deepEqual(rowIds(ctx), idsCsv.split(',')));
      stopBridge(ctx);
    },
    FEATURE
  );

  // ── Scenario 02 (outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^row "([^"]+)" is marked in flight "(yes|no)"$/,
    (ctx, topicId, expected) => {
      stopBridgeOnError(ctx, () => {
        const row = ctx.dom.window.document.querySelector(`.row[data-id="${topicId}"]`);
        assert.ok(row, `expected a drill-down row for ${topicId}`);
        const hasBadge = Boolean(row.querySelector('.in-flight-badge'));
        assert.equal(hasBadge, expected === 'yes', `expected ${topicId}'s in-flight badge presence to be "${expected}"`);
      });
      stopBridge(ctx);
    },
    FEATURE
  );

  // ── Scenario 03/04/05's shared When ─────────────────────────────────
  registry.defineScoped(
    /^the make-top button on row "([^"]+)" is tapped in the "([^"]+)" drill-down$/,
    async (ctx, topicId, epicId) => {
      await ensureBridge(ctx);
      await stopBridgeOnError(ctx, () => tapTopicMakeTop(ctx, epicId, topicId));
    },
    FEATURE
  );

  registry.defineScoped(
    /^the topic make-top route answers success$/,
    (ctx) => {
      stopBridgeOnError(ctx, () => {
        const call = ctx.fetchCalls.find((c) => c.url.startsWith('/epic-reorder/topic-make-top'));
        assert.ok(call, 'expected the topic-make-top route to have been called');
        const moveStatusEl = ctx.dom.window.document.getElementById('move-status');
        assert.equal(moveStatusEl.textContent, '', 'a success response leaves move-status empty, never a reason');
      });
    },
    FEATURE
  );

  // ── Scenario 04 ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the rewritten priority for "([^"]+)" is committed in "backlog\/active\/"$/,
    (ctx, id) => {
      stopBridgeOnError(ctx, () => {
        const filePath = path.join(ctx.root, 'backlog', 'active', `${id}.yaml`);
        assert.ok(fs.existsSync(filePath), `expected ${id} to still be a backlog/active/ file after make-top`);
        const status = execFileSync('git', ['status', '--porcelain', '--', 'backlog'], { cwd: ctx.root, encoding: 'utf8' });
        assert.equal(status.trim(), '', 'expected the rewritten backlog/active/ file to be committed');
      });
      stopBridge(ctx);
    },
    FEATURE
  );

  // ── Scenario 05 ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^row "([^"]+)" shows no live-dependency marker$/,
    (ctx, id) => {
      stopBridgeOnError(ctx, () => {
        const row = ctx.dom.window.document.querySelector(`.row[data-id="${id}"]`);
        assert.ok(row, `expected a drill-down row for ${id}`);
        assert.ok(!row.querySelector('.dep-marker'), `expected ${id} to show no live-dependency marker`);
      });
      stopBridge(ctx);
    },
    FEATURE
  );

  // ── Scenario 06 ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the drill-down shows "([^"]+)"$/,
    (ctx, text) => {
      stopBridgeOnError(ctx, () => {
        const empty = ctx.dom.window.document.querySelector('#content .empty');
        assert.ok(empty, 'expected an empty-state message in the drill-down');
        assert.equal(empty.textContent, text);
      });
      stopBridge(ctx);
    },
    FEATURE
  );

  // ── Scenario 07 ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the make-top button on the "([^"]+)" tile is tapped$/,
    async (ctx, epicId) => {
      await ensureBridge(ctx);
      ctx.priorityBefore = { ...ctx.locations };
      ctx.priorityValuesBefore = {};
      for (const id of Object.keys(ctx.locations)) {
        ctx.priorityValuesBefore[id] = readPriority(ctx, id);
      }
      await stopBridgeOnError(ctx, () => tapEpicTileMakeTop(ctx, epicId));
    },
    FEATURE
  );

  registry.defineScoped(
    /^live topic "([^"]+)" keeps its priority$/,
    (ctx, id) => {
      stopBridgeOnError(ctx, () =>
        assert.equal(
          readPriority(ctx, id),
          ctx.priorityValuesBefore[id],
          `expected ${id}'s priority to be unchanged by the epic-tile make-top verb`
        )
      );
      stopBridge(ctx);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
