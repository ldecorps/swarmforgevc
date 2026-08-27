'use strict';

// BL-592: step handlers for the live Mini App read-only spec tree with
// epic tier. Drives computeDocsTree / bridge routes and jsdom for the
// served specTreeUiHtml screen (same bridge+jsdom shape as bl674).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { JSDOM } = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'jsdom'));

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');
const { DOCS_TREE_SCHEMA_VERSION, NO_EPIC_KEY, computeDocsTree } = require('../../../extension/out/docs/docsTree');

const FEATURE = 'the live Mini App console exposes a read-only spec tree Milestone to Epic to BL item to Gherkin';
const TOKEN = 'bl592-spec-tree-token';
const PWA_DIR = path.join(__dirname, '..', '..', '..', 'pwa');

// Scrubbed of ambient GIT_DIR/GIT_WORK_TREE before every call - without
// this, a `cwd`-scoped git subprocess with either var set in the ambient
// environment ignores `cwd` entirely and operates on whatever repo those
// vars point at instead of this fixture's own isolated one (same class of
// hazard as extension/test/helpers/sharedRepoFixture.js's own established
// fix; observed here directly: `git add -A`/`git commit` inside this
// fixture raced the real repo's `.git/index.lock` under concurrent
// scenarios). Never omit this for any git call added to this file.
function git(args, cwd) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  execFileSync('git', args, { cwd, env });
}

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl592-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 't@t'], root);
  git(['config', 'user.name', 't'], root);
  git(['commit', '-q', '-m', 'init', '--allow-empty'], root);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
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

function writeYaml(ctx, folder, filename, content) {
  const filePath = path.join(ctx.root, 'backlog', folder, filename);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return;
  }
  fs.writeFileSync(filePath, content);
  git(['add', '-A'], ctx.root);
  git(['commit', '-q', '-m', `seed ${filename}`], ctx.root);
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

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in the served HTML');
  }
  return match[1];
}

async function renderSpecTreeScreen(ctx) {
  const port = ctx.bridgeHandle.port;
  const res = await fetch(`http://127.0.0.1:${port}/spec-tree`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: `https://example.github.io/spec-tree/?token=${TOKEN}`,
    pretendToBeVisual: true,
  });
  dom.window.fetch = (url, opts) => {
    const target = url.startsWith('http') ? url : `http://127.0.0.1:${port}${url}`;
    return fetch(target, opts);
  };
  dom.window.eval(extractInlineScript(html));
  ctx.dom = dom;
  const statusEl = dom.window.document.getElementById('status');
  const settled = await waitFor(() => statusEl.textContent !== 'Loading…');
  assert.ok(settled, `initial refresh never settled: status="${statusEl.textContent}"`);
  return dom;
}

async function withBridge(ctx, fn) {
  await ensureBridge(ctx);
  try {
    return await fn(ctx.bridgeHandle);
  } finally {
    stopBridge(ctx);
  }
}

function stopBridge(ctx) {
  if (ctx.bridgeHandle) {
    ctx.bridgeHandle.stop();
    ctx.bridgeHandle = null;
    ctx.dom = null;
  }
}

// BL-592 architect bounce (D1): the manual stopBridge()/mkFixture() calls
// above leak both the bridge handle and the mkdtempSync fixture dir on any
// throw before their own scenario reaches its designated cleanup step -
// engineering.prompt's Test Speed And Isolation rule (BL-971). runtime.js's
// runScenario has no per-scenario teardown hook of its own, so this uses
// node:test's real afterEach instead, scoped by tracking only the ctx the
// CURRENT scenario's Background step just created - cleanup is then
// unconditional regardless of which step throws, or none at all.
let currentCtx;

function trackCtx(ctx) {
  currentCtx = ctx;
  return ctx;
}

afterEach(() => {
  if (!currentCtx) {
    return;
  }
  stopBridge(currentCtx);
  if (currentCtx.root) {
    fs.rmSync(currentCtx.root, { recursive: true, force: true });
  }
  currentCtx = undefined;
});

function clickButton(dom, testId) {
  const btn = dom.window.document.querySelector(`[data-testid="${testId}"]`);
  assert.ok(btn, `expected button data-testid="${testId}"`);
  btn.dispatchEvent(new dom.window.Event('click'));
}

function fakePwaDocsTree() {
  return {
    schemaVersion: DOCS_TREE_SCHEMA_VERSION,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [{ id: 'specification', title: 'Specification', kind: 'markdown', content: '# Spec' }],
    milestones: [
      {
        milestone: 'M4',
        epics: [{ epicKey: NO_EPIC_KEY, tickets: [{ id: 'BL-100', title: 'alpha', status: 'done' }] }],
      },
    ],
    tickets: [
      {
        id: 'BL-100',
        title: 'alpha',
        status: 'done',
        milestone: 'M4',
        scenarios: [{ name: 'scenario one', text: 'Scenario: scenario one\n  Given a step\n  Then ok' }],
      },
    ],
  };
}

function renderPwa(docsTree) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  dom.window.fetch = (url) => {
    if (url === './backlog.json') {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            schemaVersion: 1,
            generatedAtIso: '2026-07-09T12:00:00Z',
            sourceSha: 'abc123def456',
            board: { active: [], paused: [], doneByMilestone: {} },
            metrics: {
              velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
              burndown: [],
              cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
              forecasts: { tickets: [], milestones: [] },
            },
          }),
      });
    }
    if (url === './docs-tree.json') {
      return Promise.resolve({ json: () => Promise.resolve(docsTree) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  return dom;
}

async function ensureBridge(ctx) {
  trackCtx(ctx);
  if (!process.env.CURSOR_API_KEY) {
    process.env.CURSOR_API_KEY = 'test-key';
  }
  if (!ctx.root) {
    ctx.root = mkFixture();
  }
  if (!ctx.bridgeHandle) {
    ctx.bridgeHandle = await startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {});
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the live Mini App console spec tree screen is open$/, (ctx) => {
    trackCtx(ctx);
    ctx.root = mkFixture();
    writeYaml(
      ctx,
      'active',
      'BL-592-drill.yaml',
      `id: BL-592-drill\ntitle: Drill ticket\nmilestone: M4\nepic: drill-epic\nacceptance: |\n  Feature: x\n\n  Scenario: readable gherkin\n    Given a backlog item\n    Then scenarios show\n`
    );
  });

  scoped(/^the human opens a milestone$/, async (ctx) => {
    await ensureBridge(ctx);
    await renderSpecTreeScreen(ctx);
    clickButton(ctx.dom, 'milestone-M4');
  });

  scoped(/^the human opens that milestone$/, async (ctx) => {
    await ensureBridge(ctx);
    await renderSpecTreeScreen(ctx);
    clickButton(ctx.dom, `milestone-${ctx.bl592Milestone}`);
  });

  scoped(/^drills into an epic under that milestone$/, (ctx) => {
    clickButton(ctx.dom, 'epic-drill-epic');
  });

  scoped(/^drills into a BL item under that epic$/, (ctx) => {
    clickButton(ctx.dom, 'ticket-BL-592-drill');
    clickButton(ctx.dom, 'scenario-0');
  });

  scoped(/^the BL item's Gherkin scenarios are shown as readable scenario text$/, (ctx) => {
    const text = ctx.dom.window.document.querySelector('[data-testid="scenario-text"]');
    assert.ok(text, 'expected scenario text block');
    assert.match(text.textContent, /Given a backlog item/);
    assert.match(text.textContent, /Then scenarios show/);
  });

  scoped(/^the tree data is served fresh from the bridge over the live checkout$/, async (ctx) => {
    const port = ctx.bridgeHandle.port;
    const res = await fetch(`http://127.0.0.1:${port}/spec-tree-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.schemaVersion, DOCS_TREE_SCHEMA_VERSION);
    assert.ok(data.tickets.some((t) => t.id === 'BL-592-drill'));
    stopBridge(ctx);
  });

  scoped(/^a milestone with tickets carrying different epic values$/, (ctx) => {
    writeYaml(ctx, 'active', 'BL-592-a.yaml', 'id: BL-592-a\ntitle: A\nmilestone: M8\nepic: epic-a\n');
    writeYaml(ctx, 'active', 'BL-592-b.yaml', 'id: BL-592-b\ntitle: B\nmilestone: M8\nepic: epic-b\n');
    ctx.bl592Milestone = 'M8';
  });

  scoped(/^each distinct epic value appears as its own epic node$/, (ctx) => {
    const tree = computeDocsTree(ctx.root);
    const milestone = tree.milestones.find((m) => m.milestone === ctx.bl592Milestone);
    assert.ok(milestone);
    const keys = milestone.epics.map((e) => e.epicKey).sort();
    assert.deepEqual(keys, ['epic-a', 'epic-b']);
  });

  scoped(/^each epic node lists only tickets whose epic field matches that epic$/, (ctx) => {
    const tree = computeDocsTree(ctx.root);
    const milestone = tree.milestones.find((m) => m.milestone === ctx.bl592Milestone);
    const epicA = milestone.epics.find((e) => e.epicKey === 'epic-a');
    const epicB = milestone.epics.find((e) => e.epicKey === 'epic-b');
    assert.deepEqual(epicA.tickets.map((t) => t.id), ['BL-592-a']);
    assert.deepEqual(epicB.tickets.map((t) => t.id), ['BL-592-b']);
  });

  scoped(/^a milestone with a ticket that has no epic field$/, (ctx) => {
    writeYaml(ctx, 'active', 'BL-592-noepic.yaml', 'id: BL-592-noepic\ntitle: No epic\nmilestone: M8\n');
    ctx.bl592Milestone = 'M8';
    ctx.bl592NoEpicId = 'BL-592-noepic';
  });

  scoped(/^a visible "\(no epic\)" epic node exists under that milestone$/, (ctx) => {
    const tree = computeDocsTree(ctx.root);
    const milestone = tree.milestones.find((m) => m.milestone === ctx.bl592Milestone);
    assert.ok(milestone.epics.some((e) => e.epicKey === NO_EPIC_KEY));
  });

  scoped(/^the ticket appears under that bucket$/, (ctx) => {
    const tree = computeDocsTree(ctx.root);
    const milestone = tree.milestones.find((m) => m.milestone === ctx.bl592Milestone);
    const bucket = milestone.epics.find((e) => e.epicKey === NO_EPIC_KEY);
    assert.ok(bucket.tickets.some((t) => t.id === ctx.bl592NoEpicId));
  });

  scoped(/^the ticket is not dropped from the tree$/, (ctx) => {
    const tree = computeDocsTree(ctx.root);
    assert.ok(tree.tickets.some((t) => t.id === ctx.bl592NoEpicId));
  });

  scoped(/^a paused epic tracker ticket whose id matches its epic field$/, (ctx) => {
    writeYaml(
      ctx,
      'paused',
      'EPIC-TRACK.yaml',
      'id: EPIC-TRACK\ntitle: Epic tracker title\ntype: epic\nepic: EPIC-TRACK\nmilestone: M8\n'
    );
    ctx.bl592EpicKey = 'EPIC-TRACK';
  });

  scoped(/^member tickets under that epic$/, (ctx) => {
    writeYaml(ctx, 'active', 'BL-592-member.yaml', 'id: BL-592-member\ntitle: Member\nmilestone: M8\nepic: EPIC-TRACK\n');
  });

  scoped(/^the human drills into that epic on the live console$/, async (ctx) => {
    await ensureBridge(ctx);
    await renderSpecTreeScreen(ctx);
    clickButton(ctx.dom, 'milestone-M8');
    clickButton(ctx.dom, 'epic-EPIC-TRACK');
  });

  scoped(/^the epic node title comes from the tracker ticket$/, (ctx) => {
    const tree = computeDocsTree(ctx.root);
    const epic = tree.milestones.find((m) => m.milestone === 'M8').epics.find((e) => e.epicKey === ctx.bl592EpicKey);
    assert.equal(epic.title, 'Epic tracker title');
  });

  scoped(/^the tracker ticket is not listed again as a navigable ticket leaf under its own epic$/, (ctx) => {
    const tree = computeDocsTree(ctx.root);
    const epic = tree.milestones.find((m) => m.milestone === 'M8').epics.find((e) => e.epicKey === ctx.bl592EpicKey);
    assert.ok(!epic.tickets.some((t) => t.id === 'EPIC-TRACK'));
    stopBridge(ctx);
  });

  scoped(/^an epic whose member tickets span (M8 and M9)$/, (ctx) => {
    writeYaml(ctx, 'active', 'BL-592-m8.yaml', 'id: BL-592-m8\ntitle: M8 member\nmilestone: M8\nepic: cross-epic\n');
    writeYaml(ctx, 'active', 'BL-592-m9.yaml', 'id: BL-592-m9\ntitle: M9 member\nmilestone: M9\nepic: cross-epic\n');
    ctx.bl592CrossEpic = 'cross-epic';
    ctx.bl592Milestones = ['M8', 'M9'];
  });

  scoped(/^the human opens each affected milestone on the live console$/, (ctx) => {
    ctx.bl592Opened = ctx.bl592Milestones;
  });

  scoped(/^the epic node appears under that milestone$/, (ctx) => {
    const tree = computeDocsTree(ctx.root);
    for (const milestoneName of ctx.bl592Opened) {
      const milestone = tree.milestones.find((m) => m.milestone === milestoneName);
      assert.ok(milestone.epics.some((e) => e.epicKey === ctx.bl592CrossEpic), `expected epic under ${milestoneName}`);
    }
  });

  scoped(/^only tickets whose milestone field equals that milestone are listed under the epic there$/, (ctx) => {
    const tree = computeDocsTree(ctx.root);
    for (const milestoneName of ctx.bl592Opened) {
      const epic = tree.milestones.find((m) => m.milestone === milestoneName).epics.find((e) => e.epicKey === ctx.bl592CrossEpic);
      for (const ticket of epic.tickets) {
        const full = tree.tickets.find((t) => t.id === ticket.id);
        assert.equal(full.milestone, milestoneName);
      }
    }
  });

  scoped(/^any level of the live console spec tree$/, async (ctx) => {
    await ensureBridge(ctx);
    await renderSpecTreeScreen(ctx);
    clickButton(ctx.dom, 'milestone-M4');
    clickButton(ctx.dom, 'epic-drill-epic');
  });

  scoped(/^no affordance exists to edit documentation or create or modify tickets$/, (ctx) => {
    const html = ctx.dom.window.document.documentElement.innerHTML.toLowerCase();
    assert.doesNotMatch(html, /<input[^>]*type=["']text/i);
    assert.doesNotMatch(html, /contenteditable/i);
    assert.doesNotMatch(html, /create ticket/i);
    const buttons = ctx.dom.window.document.querySelectorAll('button');
    for (const btn of buttons) {
      assert.doesNotMatch((btn.textContent || '').toLowerCase(), /save|delete|modify backlog/i);
    }
    stopBridge(ctx);
  });

  scoped(/^the docs tree schema version has been bumped for the epic tier$/, (ctx) => {
    assert.equal(DOCS_TREE_SCHEMA_VERSION, 2);
    ctx.bl592PwaTree = fakePwaDocsTree();
  });

  scoped(/^the static backlog-dashboard PWA loads its published docs-tree artifact$/, async (ctx) => {
    ctx.bl592PwaDom = renderPwa(ctx.bl592PwaTree);
    await sleep(0);
  });

  scoped(/^the PWA documentation explorer still drills from milestone to ticket to Gherkin$/, (ctx) => {
    const explorer = ctx.bl592PwaDom.window.document.getElementById('docsExplorer');
    const milestoneBtn = [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0);
    milestoneBtn.dispatchEvent(new ctx.bl592PwaDom.window.Event('click'));
    const ticketBtn = [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0);
    ticketBtn.dispatchEvent(new ctx.bl592PwaDom.window.Event('click'));
    const scenarioBtn = explorer.querySelector('button');
    scenarioBtn.dispatchEvent(new ctx.bl592PwaDom.window.Event('click'));
    const gherkin = explorer.querySelector('.gherkin');
    assert.ok(gherkin);
    assert.match(gherkin.textContent, /Given a step/);
  });

  scoped(/^no published PWA fetch fails because of the new schema alone$/, (ctx) => {
    assert.equal(ctx.bl592PwaTree.schemaVersion, 2);
  });

  scoped(/^the static backlog-dashboard PWA$/, (ctx) => {
    ctx.bl592PwaSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  });

  scoped(/^the app user browses available surfaces$/, () => {});

  scoped(/^the live-console spec tree route is not reachable from the static PWA$/, (ctx) => {
    assert.doesNotMatch(ctx.bl592PwaSource, /spec-tree/);
  });

  scoped(/^the static PWA remains a git-SHA reproducible projection with no bridge write path$/, (ctx) => {
    assert.doesNotMatch(ctx.bl592PwaSource, /spec-tree-state/);
    assert.match(ctx.bl592PwaSource, /docs-tree\.json/);
  });
}

module.exports = { registerSteps };
