'use strict';

// BL-1412: step handlers for "A text filter on the live Spec-tree console
// narrows the milestones view to matching tickets". Drives the REAL
// startBridge() (which serves filterSpecTree's real output over
// /spec-tree-state?q=) and jsdom over the REAL getSpecTreeUiHtml() screen -
// same bridge+jsdom shape as bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js,
// which this feature extends. A single, comprehensive fixture (Background)
// carries one isolated marker term per scenario/example so no two examples'
// assertions can pass off each other's matches.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { JSDOM } = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'jsdom'));

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');

const FEATURE = 'BL-1412 A text filter on the live Spec-tree console narrows the milestones view to matching tickets';
const TOKEN = 'bl1412-spec-tree-token';

const KNOWN_FIELDS = new Set(['title', 'description', 'scenario text', 'title in a different case']);
const KNOWN_LABELS = new Set(["one milestone's name", "one epic tracker's title", "one ticket's id"]);

function git(args, cwd) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  execFileSync('git', args, { cwd, env });
}

function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1412-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 't@t'], root);
  git(['config', 'user.name', 't'], root);
  git(['commit', '-q', '-m', 'init', '--allow-empty'], root);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  return root;
}

function writeTicket(root, id, fields) {
  const lines = [`id: ${id}`, ...Object.entries(fields).map(([k, v]) => (k === 'acceptance' ? `acceptance: |\n${v.split('\n').map((l) => '  ' + l).join('\n')}` : `${k}: ${v}`))];
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${id}.yaml`), lines.join('\n') + '\n');
}

function commit(root, message) {
  git(['add', '-A'], root);
  git(['commit', '-q', '-m', message], root);
}

// ── the one comprehensive fixture, one isolated marker term per need ────
function buildFixture(ctx) {
  const root = mkFixtureRoot();
  ctx.root = root;
  ctx.terms = {};

  // Scenario 01: one unique marker per field, each its own milestone+epic
  // so "only that ticket's milestone" and "only that ticket's epic and only
  // that ticket" are unambiguous.
  writeTicket(root, 'BL-9001', { title: 'widgetalpha console screen', milestone: 'M-title-field', epic: 'e-title' });
  writeTicket(root, 'BL-9002', { title: 'plain leaf', description: 'widgetbeta appears only here', milestone: 'M-desc-field', epic: 'e-desc' });
  writeTicket(root, 'BL-9003', {
    title: 'plain leaf two',
    milestone: 'M-scenario-field',
    epic: 'e-scenario',
    acceptance: 'Feature: x\n\nScenario: y\n  Given widgetgamma appears only in scenario text\n  Then ok\n',
  });
  ctx.terms.title = { term: 'widgetalpha', milestone: 'M-title-field', epic: 'e-title', ticket: 'BL-9001' };
  ctx.terms.description = { term: 'widgetbeta', milestone: 'M-desc-field', epic: 'e-desc', ticket: 'BL-9002' };
  ctx.terms['scenario text'] = { term: 'widgetgamma', milestone: 'M-scenario-field', epic: 'e-scenario', ticket: 'BL-9003' };
  ctx.terms['title in a different case'] = { term: 'WIDGETALPHA', milestone: 'M-title-field', epic: 'e-title', ticket: 'BL-9001' };

  // Scenario 02: a term matching one ticket in EACH of two milestones.
  writeTicket(root, 'BL-9010', { title: 'crossterm marker one', milestone: 'M-cross-a', epic: 'epic-cross-a' });
  writeTicket(root, 'BL-9011', { title: 'crossterm marker two', milestone: 'M-cross-b', epic: 'epic-cross-b' });
  ctx.crossTerm = { term: 'crossterm', milestones: ['M-cross-a', 'M-cross-b'] };

  // Scenario 04: deliberately matches nothing anywhere in the fixture.
  ctx.noMatchTerm = 'zzzz-no-such-term';

  // Scenario 06: a term contained ONLY in a label, never in any ticket's
  // own text - each example's non-matching sibling proves the WHOLE
  // subtree (not just the matching leaf) is kept.
  writeTicket(root, 'BL-9020', { title: 'plain sibling a', milestone: 'M-milestonelabelterm', epic: 'e-label-milestone' });
  writeTicket(root, 'BL-9021', { title: 'plain sibling b', milestone: 'M-milestonelabelterm', epic: 'e-label-milestone' });
  ctx.terms["one milestone's name"] = { term: 'milestonelabelterm', milestone: 'M-milestonelabelterm', epic: 'e-label-milestone', tickets: ['BL-9020', 'BL-9021'] };

  writeTicket(root, 'EPIC-LBL', { type: 'epic', epic: 'EPIC-LBL', title: 'epictitlelabelterm tracker', status: 'paused', milestone: 'M-epiclabel' });
  writeTicket(root, 'BL-9030', { title: 'plain member a', milestone: 'M-epiclabel', epic: 'EPIC-LBL' });
  writeTicket(root, 'BL-9031', { title: 'plain member b', milestone: 'M-epiclabel', epic: 'EPIC-LBL' });
  ctx.terms["one epic tracker's title"] = { term: 'epictitlelabelterm', milestone: 'M-epiclabel', epic: 'EPIC-LBL', tickets: ['BL-9030', 'BL-9031'] };

  writeTicket(root, 'BL-idtermxyz', { title: 'plain, no marker text anywhere', milestone: 'M-idlabel', epic: 'e-label-id' });
  writeTicket(root, 'BL-9040', { title: 'sibling under the same epic', milestone: 'M-idlabel', epic: 'e-label-id' });
  ctx.terms["one ticket's id"] = { term: 'idtermxyz', milestone: 'M-idlabel', epic: 'e-label-id', tickets: ['BL-idtermxyz'] };

  commit(root, 'seed BL-1412 fixture');
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
  trackCtx(ctx);
  if (!ctx.root) {
    buildFixture(ctx);
  }
  if (!ctx.bridgeHandle) {
    ctx.bridgeHandle = await startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {});
  }
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

// Types into the REAL filter input and waits past the REAL 250ms debounce
// (never faked here - this handler drives real HTTP against a real bridge,
// so a faked clock would desync from the actual network round trip).
async function typeFilterTerm(ctx, term) {
  const input = ctx.dom.window.document.querySelector('[data-testid="spec-tree-filter"]');
  input.value = term;
  input.dispatchEvent(new ctx.dom.window.Event('input'));
  await sleep(400);
  await waitFor(() => ctx.dom.window.document.getElementById('status').textContent !== 'Loading…');
}

function clickButton(dom, testId) {
  const btn = dom.window.document.querySelector(`[data-testid="${testId}"]`);
  assert.ok(btn, `expected button data-testid="${testId}"`);
  btn.dispatchEvent(new dom.window.Event('click'));
}

function milestoneCount(dom, milestoneName) {
  const el = dom.window.document.querySelector(`[data-testid="milestone-${milestoneName}"]`);
  return el ? el.textContent : null;
}

let currentCtx;
function trackCtx(ctx) {
  currentCtx = ctx;
  return ctx;
}
function stopBridge(ctx) {
  if (ctx.bridgeHandle) {
    ctx.bridgeHandle.stop();
    ctx.bridgeHandle = null;
    ctx.dom = null;
  }
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

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^the live Mini App console spec tree screen is open over a checkout with tickets in more than one milestone$/,
    async (ctx) => {
      await ensureBridge(ctx);
      await renderSpecTreeScreen(ctx);
    }
  );

  // ── Scenario 01 (outline) ────────────────────────────────────────────
  scoped(/^exactly one ticket matches a term by its (.+)$/, (ctx, field) => {
    assert.ok(KNOWN_FIELDS.has(field), `unknown <field> example value: ${field}`);
    ctx.matched = ctx.terms[field];
  });

  scoped(/^the human types that term into the filter box$/, async (ctx) => {
    await typeFilterTerm(ctx, ctx.matched.term);
  });

  scoped(/^only that ticket's milestone is listed, with a count of 1$/, (ctx) => {
    const { document } = ctx.dom.window;
    const milestoneButtons = [...document.getElementById('content').querySelectorAll('.nav-btn')];
    assert.equal(milestoneButtons.length, 1, `expected exactly one milestone listed, got: ${milestoneButtons.map((b) => b.textContent)}`);
    assert.equal(milestoneCount(ctx.dom, ctx.matched.milestone), `${ctx.matched.milestone} (1)`);
  });

  scoped(/^drilling into it shows only that ticket's epic and only that ticket$/, (ctx) => {
    clickButton(ctx.dom, `milestone-${ctx.matched.milestone}`);
    const { document } = ctx.dom.window;
    const epicButtons = [...document.getElementById('content').querySelectorAll('.nav-btn')];
    assert.equal(epicButtons.length, 1, `expected exactly one epic listed, got: ${epicButtons.map((b) => b.textContent)}`);
    clickButton(ctx.dom, `epic-${ctx.matched.epic}`);
    const ticketButtons = [...document.getElementById('content').querySelectorAll('.nav-btn')];
    assert.equal(ticketButtons.length, 1, `expected exactly one ticket listed, got: ${ticketButtons.map((b) => b.textContent)}`);
    assert.ok(document.querySelector(`[data-testid="ticket-${ctx.matched.ticket}"]`));
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a term that matches tickets in two milestones$/, (ctx) => {
    ctx.cross = ctx.crossTerm;
  });

  scoped(
    /^the human types the term, opens one milestone, drills into an epic, and returns to Milestones through the crumbs$/,
    async (ctx) => {
      await typeFilterTerm(ctx, ctx.cross.term);
      clickButton(ctx.dom, `milestone-${ctx.cross.milestones[0]}`);
      const { document } = ctx.dom.window;
      const epicButtons = [...document.getElementById('content').querySelectorAll('.nav-btn')];
      assert.equal(epicButtons.length, 1, `expected exactly one epic under the opened milestone, got: ${epicButtons.map((b) => b.textContent)}`);
      ctx.epicLevelButtonCount = epicButtons.length;
      epicButtons[0].dispatchEvent(new ctx.dom.window.Event('click'));
      const ticketButtons = [...document.getElementById('content').querySelectorAll('.nav-btn')];
      ctx.ticketLevelButtonCount = ticketButtons.length;
      const rootCrumb = [...document.getElementById('crumbs').querySelectorAll('button')].find((b) => b.textContent === 'Milestones');
      assert.ok(rootCrumb, 'expected a Milestones crumb to return through');
      rootCrumb.dispatchEvent(new ctx.dom.window.Event('click'));
    }
  );

  scoped(/^every level shown along the way listed only matching tickets$/, (ctx) => {
    assert.equal(ctx.epicLevelButtonCount, 1, 'expected only the matching epic at the epic level');
    assert.equal(ctx.ticketLevelButtonCount, 1, 'expected only the matching ticket at the ticket level');
  });

  scoped(/^the Milestones view still lists only those two milestones with their match counts$/, (ctx) => {
    const { document } = ctx.dom.window;
    const milestoneButtons = [...document.getElementById('content').querySelectorAll('.nav-btn')];
    assert.equal(milestoneButtons.length, 2, `expected exactly the two crossterm milestones, got: ${milestoneButtons.map((b) => b.textContent)}`);
    for (const name of ctx.cross.milestones) {
      assert.equal(milestoneCount(ctx.dom, name), `${name} (1)`);
    }
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a term is applied and the milestones view is narrowed$/, async (ctx) => {
    ctx.matched = ctx.terms.title;
    await typeFilterTerm(ctx, ctx.matched.term);
    const before = [...ctx.dom.window.document.getElementById('content').querySelectorAll('.nav-btn')];
    assert.equal(before.length, 1, 'sanity: the view is narrowed before clearing');
  });

  scoped(/^the human clears the filter box$/, async (ctx) => {
    await typeFilterTerm(ctx, '');
  });

  scoped(/^the milestones view lists every milestone with its full count$/, (ctx) => {
    const { document } = ctx.dom.window;
    // The fixture carries every milestone built in the Background - the
    // one this scenario's own matched-ticket milestone holds exactly 1.
    assert.equal(milestoneCount(ctx.dom, ctx.matched.milestone), `${ctx.matched.milestone} (1)`);
    const milestoneButtons = [...document.getElementById('content').querySelectorAll('.nav-btn')];
    assert.ok(milestoneButtons.length > 1, `expected the full, unnarrowed milestone list back, got only: ${milestoneButtons.map((b) => b.textContent)}`);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the human types a term that matches no ticket$/, async (ctx) => {
    await typeFilterTerm(ctx, ctx.noMatchTerm);
  });

  scoped(/^the content shows a no-results state that names the term rather than a blank page or an error$/, (ctx) => {
    const empty = ctx.dom.window.document.querySelector('[data-testid="no-results"]');
    assert.ok(empty, 'expected a no-results element');
    assert.match(empty.textContent, new RegExp(ctx.noMatchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^the spec tree state is requested with a query term$/, async (ctx) => {
    const port = ctx.bridgeHandle.port;
    ctx.filteredRes = await fetch(`http://127.0.0.1:${port}/spec-tree-state?token=${TOKEN}&q=${encodeURIComponent(ctx.terms.title.term)}`);
    ctx.filteredBody = await ctx.filteredRes.json();
    ctx.fullRes = await fetch(`http://127.0.0.1:${port}/spec-tree-state?token=${TOKEN}`);
    ctx.fullBody = await ctx.fullRes.json();
  });

  scoped(
    /^the response keeps the unfiltered schema and carries only matching tickets with their pruned hierarchy$/,
    (ctx) => {
      assert.equal(ctx.filteredRes.status, 200);
      assert.equal(ctx.filteredBody.schemaVersion, ctx.fullBody.schemaVersion);
      assert.deepEqual(ctx.filteredBody.tickets.map((t) => t.id), [ctx.terms.title.ticket]);
      assert.deepEqual(ctx.filteredBody.milestones.map((m) => m.milestone), [ctx.terms.title.milestone]);
    }
  );

  scoped(/^the same request without a query term returns the full tree$/, (ctx) => {
    assert.equal(ctx.fullRes.status, 200);
    assert.ok(ctx.fullBody.tickets.length > ctx.filteredBody.tickets.length, 'expected the unfiltered request to carry more tickets than the filtered one');
    assert.ok(ctx.fullBody.tickets.some((t) => t.id === 'BL-9040'), 'expected an unrelated fixture ticket present only in the full tree');
  });

  // ── Scenario 06 (outline) ────────────────────────────────────────────
  scoped(/^a term contained only in (.+) and in no ticket's text$/, (ctx, label) => {
    assert.ok(KNOWN_LABELS.has(label), `unknown <label> example value: ${label}`);
    ctx.matched = ctx.terms[label];
  });

  scoped(/^that entry is listed with its full count$/, (ctx) => {
    assert.equal(
      milestoneCount(ctx.dom, ctx.matched.milestone),
      `${ctx.matched.milestone} (${ctx.matched.tickets.length})`
    );
  });

  scoped(/^drilling into it shows every ticket beneath it, none hidden$/, (ctx) => {
    clickButton(ctx.dom, `milestone-${ctx.matched.milestone}`);
    clickButton(ctx.dom, `epic-${ctx.matched.epic}`);
    const { document } = ctx.dom.window;
    for (const ticketId of ctx.matched.tickets) {
      assert.ok(document.querySelector(`[data-testid="ticket-${ticketId}"]`), `expected ${ticketId} to be present, none hidden`);
    }
  });
}

module.exports = { registerSteps };
