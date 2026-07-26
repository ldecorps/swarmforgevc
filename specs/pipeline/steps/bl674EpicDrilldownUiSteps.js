'use strict';

// BL-674: step handlers for "Epic drill-down topic reprioritize UI". Drives
// the REAL bridge server AND the REAL served getEpicReorderUiHtml() script
// in jsdom, against a real git repo fixture with the real
// commit_integrity_cli.bb dependency chain copied in - same fixture shape
// as bl672/bl673's own step files beside it, extended with jsdom the way
// burndownLineChartSteps.js documents (jsdom lives in extension's own
// node_modules, not this directory's - required by absolute path here since
// jsdom is loaded in-process rather than via a spawned script, which this
// ticket's need to click buttons and re-inspect the DOM across several
// steps in one scenario would make far more awkward to serialize).
//
// This DSL has no per-scenario teardown hook (see burndownLineChartSteps.js
// and frontDeskHeadlessLauncherSteps.js's own comments on the same point) -
// each scenario's own terminal Then step stops ctx.bridgeHandle itself.
//
// "Fresh at render": every When step below (re-)renders the screen from
// scratch immediately before acting, rather than trusting a render left
// over from the Background - a scenario-specific Given step may have
// amended the fixture (e.g. added a depends_on) AFTER the Background ran,
// and epicReorderUiHtml.ts's own drillInto() refetches on every drill-in
// for exactly this reason (approval_context: "fresh at render, like the
// tiles").

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'jsdom'));

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');

const FEATURE = 'Epic drill-down topic reprioritize UI';
const TOKEN = 'bl674-drilldown-token';

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl674-'));
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

function writeTicket(ctx, id, type, epic, priority, dependsOn) {
  ctx.meta = ctx.meta || {};
  const lines = [`id: ${id}`, `title: ${id} title`, `type: ${type}`];
  if (epic) {
    lines.push(`epic: ${epic}`);
  }
  lines.push(`priority: ${priority}`);
  if (dependsOn && dependsOn.length > 0) {
    lines.push(`depends_on: [${dependsOn.join(', ')}]`);
  }
  const content = lines.join('\n') + '\n';
  ctx.meta[id] = { epic, priority };
  const filePath = ticketPath(ctx, id);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return;
  }
  fs.writeFileSync(filePath, content);
  execFileSync('git', ['add', '-A'], { cwd: ctx.root });
  execFileSync('git', ['commit', '-q', '-m', `seed ${id}`], { cwd: ctx.root });
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

// A zero-delay setTimeout only flushes already-queued microtasks - it does
// NOT wait out a REAL network round-trip (window.fetch here relays to a
// live HTTP server, not a synchronously-resolved stub). Every wait in this
// file polls an actual DOM condition instead, matching the same
// "waitFor(predicate, timeoutMs)" convention frontDeskHeadlessLauncherSteps.js
// already uses for its own real-process waits.
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

// Fetches the REAL served screen and evaluates its REAL inline script in a
// fresh jsdom, with window.fetch relaying relative URLs to the SAME live
// bridge (never a stub) - the acceptance layer's whole point is exercising
// the real network round-trip, not a mocked one.
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
    if (ctx.stubbedReason && url.startsWith('/epic-reorder/topic-make-top')) {
      // Scenario 04 drives a specific changed:false reason through the
      // route without needing a real backlog shape that produces it -
      // the reason-rendering contract is what's under test here, not
      // computeMakeTopPriority's own refusal logic (already covered by
      // BL-673's suites).
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, changed: false, reason: ctx.stubbedReason }),
      });
    }
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

async function tapTopicMakeTop(ctx, topicId) {
  const btn = ctx.dom.window.document.querySelector(`.topic-make-top[data-id="${topicId}"]`);
  assert.ok(btn, `expected a make-top button for topic ${topicId} in the drill-down`);
  const moveStatusEl = ctx.dom.window.document.getElementById('move-status');
  const before = ctx.beforeOrder.join(',');
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
  // ── Background ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the epic reorder screen is rendered with epic "([^"]+)" holding live topics "([^"]+)"$/,
    async (ctx, epicId, topicIdsCsv) => {
      ctx.root = mkFixture();
      ctx.epicId = epicId;
      writeTicket(ctx, epicId, 'epic', null, 0);
      topicIdsCsv.split(',').forEach((id, i) => writeTicket(ctx, id, 'feature', epicId, i + 1));
      ctx.bridgeHandle = await startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {});
    },
    FEATURE
  );

  // ── Scenario 02 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^topic "([^"]+)" depends on live topic "([^"]+)"$/,
    (ctx, topicId, depId) => {
      const meta = ctx.meta[topicId];
      writeTicket(ctx, topicId, 'feature', meta.epic, meta.priority, [depId]);
    },
    FEATURE
  );

  // ── Scenario 03 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^topic "([^"]+)" has no depends_on entries$/,
    () => {
      // Background already writes every topic with no depends_on - nothing
      // to do; kept as its own step for scenario readability.
    },
    FEATURE
  );

  // ── Scenario 04 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the topic make-top route answers changed false with reason "([^"]+)"$/,
    (ctx, reason) => {
      ctx.stubbedReason = reason;
    },
    FEATURE
  );

  // ── Scenario 01/02 ──────────────────────────────────────────────────
  registry.defineScoped(
    /^the "([^"]+)" tile is drilled into$/,
    async (ctx, epicId) => {
      await renderScreen(ctx);
      ctx.beforeOrder = rowIds(ctx);
      await drillIntoEpic(ctx, epicId);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the drill-down lists "([^"]+)" in priority ascending id ascending order$/,
    (ctx, idsCsv) => {
      assert.deepEqual(rowIds(ctx), idsCsv.split(','));
    },
    FEATURE
  );

  registry.defineScoped(
    /^the Mini App pane header is present on the drill-down screen$/,
    (ctx) => {
      const header = ctx.dom.window.document.querySelector('header h1');
      assert.ok(header, 'expected the pane header to remain present on the drill-down screen');
      stopBridge(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the "([^"]+)" row shows a dependency marker and the "([^"]+)" row shows none$/,
    (ctx, withMarkerId, withoutMarkerId) => {
      const withRow = ctx.dom.window.document.querySelector(`.row[data-id="${withMarkerId}"]`);
      const withoutRow = ctx.dom.window.document.querySelector(`.row[data-id="${withoutMarkerId}"]`);
      assert.ok(withRow.querySelector('.dep-marker'), `expected ${withMarkerId} to show a dependency marker`);
      assert.ok(!withoutRow.querySelector('.dep-marker'), `expected ${withoutMarkerId} to show no dependency marker`);
      stopBridge(ctx);
    },
    FEATURE
  );

  // ── Scenario 03/04 shared When (self-contained: renders, drills in via
  //    the topic's own tracked epic, and taps its make-top button) ──────
  registry.defineScoped(
    /^the make-top button on row "([^"]+)" is tapped$/,
    async (ctx, topicId) => {
      await renderScreen(ctx);
      await drillIntoEpic(ctx, ctx.meta[topicId].epic);
      ctx.beforeOrder = rowIds(ctx);
      await tapTopicMakeTop(ctx, topicId);
    },
    FEATURE
  );

  // ── Scenario 03 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the topic make-top route is called with epic "([^"]+)" and topic "([^"]+)"$/,
    (ctx, epicId, topicId) => {
      const call = ctx.fetchCalls.find((c) => c.url.startsWith('/epic-reorder/topic-make-top'));
      assert.ok(call, 'expected the topic-make-top route to have been called');
      assert.deepEqual(JSON.parse(call.opts.body), { epicId, topicId });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the list re-renders with "([^"]+)" first$/,
    (ctx, topicId) => {
      assert.equal(rowIds(ctx)[0], topicId);
      stopBridge(ctx);
    },
    FEATURE
  );

  // ── Scenario 04 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the drill-down displays "([^"]+)"$/,
    (ctx, text) => {
      assert.equal(ctx.dom.window.document.getElementById('move-status').textContent, text);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the listed order is unchanged$/,
    (ctx) => {
      assert.deepEqual(rowIds(ctx), ctx.beforeOrder);
      stopBridge(ctx);
    },
    FEATURE
  );

  // ── Scenario 05 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the "([^"]+)" drill-down is open$/,
    async (ctx, epicId) => {
      await renderScreen(ctx);
      await drillIntoEpic(ctx, epicId);
    },
    FEATURE
  );

  registry.defineScoped(
    /^back is tapped$/,
    async (ctx) => {
      const btn = ctx.dom.window.document.getElementById('back-to-tiles');
      assert.ok(btn, 'expected a back button on the drill-down screen');
      btn.onclick();
      const settled = await waitFor(() => !ctx.dom.window.document.getElementById('back-to-tiles'));
      assert.ok(settled, 'back navigation never returned to the tiles screen');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the epic tiles screen is displayed again$/,
    (ctx) => {
      assert.deepEqual(rowIds(ctx), [ctx.epicId]);
      stopBridge(ctx);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
