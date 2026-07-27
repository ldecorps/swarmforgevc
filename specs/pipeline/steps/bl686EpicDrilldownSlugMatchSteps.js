'use strict';

// BL-686: step handlers for "Epic drill-down resolves epic membership by
// slug". Same real-bridge-plus-jsdom technique as bl674EpicDrilldownUiSteps.js
// beside it, but every fixture here gives an epic ticket a slug DIFFERENT
// from its own id (real backlog shape - verified across all 15 live epic
// tickets at filing time: id and epic never match) rather than the
// id-equals-slug shape that hid this defect through the whole pipeline.
//
// No per-scenario teardown hook (same reasoning as bl674's own file) - each
// scenario's own terminal Then step stops ctx.bridgeHandle itself.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'jsdom'));

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');

const FEATURE = 'Epic drill-down resolves epic membership by slug';
const TOKEN = 'bl686-slug-match-token';

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl686-'));
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

function ticketPath(ctx, id) {
  return path.join(ctx.root, 'backlog', 'paused', `${id}.yaml`);
}

function writeTicket(ctx, id, type, slug, priority) {
  const lines = [`id: ${id}`, `title: ${id} title`, `type: ${type}`, `epic: ${slug}`, `priority: ${priority}`];
  const content = lines.join('\n') + '\n';
  const filePath = ticketPath(ctx, id);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return;
  }
  fs.writeFileSync(filePath, content);
  execFileSync('git', ['add', '-A'], { cwd: ctx.root });
  execFileSync('git', ['commit', '-q', '-m', `seed ${id}`], { cwd: ctx.root });
}

function readPriority(ctx, id) {
  const content = fs.readFileSync(ticketPath(ctx, id), 'utf8');
  const match = content.match(/^priority:\s*(-?\d+)$/m);
  return match ? Number(match[1]) : undefined;
}

// Snapshots every live ticket's priority - used by the "keeps its priority"
// Then steps to prove a topic make-top left an unrelated ticket (an epic
// tracker, or a topic in a different epic) untouched.
function snapshotPriorities(ctx) {
  const dir = path.join(ctx.root, 'backlog', 'paused');
  const snapshot = {};
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.yaml')) {
      continue;
    }
    const id = file.slice(0, -'.yaml'.length);
    snapshot[id] = readPriority(ctx, id);
  }
  return snapshot;
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

function stopBridge(ctx) {
  if (ctx.bridgeHandle) {
    ctx.bridgeHandle.stop();
    ctx.bridgeHandle = null;
  }
}

function registerSteps(registry) {
  // ── Background / scenario 05's extra Given ──────────────────────────
  registry.defineScoped(
    /^epic ticket "([^"]+)" declares epic slug "([^"]+)" with priority (\d+)$/,
    (ctx, id, slug, priority) => {
      if (!ctx.root) {
        ctx.root = mkFixture();
      }
      writeTicket(ctx, id, 'epic', slug, Number(priority));
    },
    FEATURE
  );

  registry.defineScoped(
    /^live topic "([^"]+)" declares epic slug "([^"]+)" with priority (\d+)$/,
    (ctx, id, slug, priority) => {
      if (!ctx.root) {
        ctx.root = mkFixture();
      }
      writeTicket(ctx, id, 'feature', slug, Number(priority));
    },
    FEATURE
  );

  // ── Scenario Outline 01 / Scenario 05 ────────────────────────────────
  registry.defineScoped(
    /^the "([^"]+)" tile is drilled into$/,
    async (ctx, epicId) => {
      await ensureBridge(ctx);
      await renderScreen(ctx);
      await drillIntoEpic(ctx, epicId);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the drill-down lists exactly "([^"]+)"$/,
    (ctx, idsCsv) => {
      assert.deepEqual(rowIds(ctx), idsCsv.split(','));
      stopBridge(ctx);
    },
    FEATURE
  );

  // ── Scenario 02/03/04 ─────────────────────────────────────────────────
  registry.defineScoped(
    /^the make-top button on row "([^"]+)" is tapped in the "([^"]+)" drill-down$/,
    async (ctx, topicId, epicId) => {
      await ensureBridge(ctx);
      ctx.priorityBefore = snapshotPriorities(ctx);
      await tapTopicMakeTop(ctx, epicId, topicId);
    },
    FEATURE
  );

  registry.defineScoped(
    /^epic ticket "([^"]+)" keeps its priority$/,
    (ctx, id) => {
      assert.equal(
        readPriority(ctx, id),
        ctx.priorityBefore[id],
        `expected epic ticket ${id}'s priority to be unchanged`
      );
      stopBridge(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^live topic "([^"]+)" keeps its priority$/,
    (ctx, id) => {
      assert.equal(
        readPriority(ctx, id),
        ctx.priorityBefore[id],
        `expected live topic ${id}'s priority to be unchanged`
      );
      stopBridge(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the topic make-top route answers success$/,
    (ctx) => {
      const call = ctx.fetchCalls.find((c) => c.url.startsWith('/epic-reorder/topic-make-top'));
      assert.ok(call, 'expected the topic-make-top route to have been called');
      const moveStatusEl = ctx.dom.window.document.getElementById('move-status');
      assert.equal(moveStatusEl.textContent, '', 'a success response leaves move-status empty, never a reason');
    },
    FEATURE
  );
}

module.exports = { registerSteps };
