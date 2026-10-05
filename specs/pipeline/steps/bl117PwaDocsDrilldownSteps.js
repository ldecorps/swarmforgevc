'use strict';

// BL-1942 (BL-117 stamp-off): step handlers for "documentation is explorable
// from vision level down to scenarios". Drives the REAL pwa/index.html +
// pwa/app.js + pwa/locales.js in jsdom by dispatching real click events
// (mirroring extension/test/pwaDocsExplorer.test.js's own established
// pattern), and the REAL compiled docsTree.js's computeDocsTree against a
// fresh mkdtemp git-less fixture directory for the acceptance-form
// resolution scenario - never a restatement of the drill-down or
// form-resolution logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const PWA_DIR = path.join(REPO_ROOT, 'pwa');
const JSDOM_MODULE = path.join(EXT_DIR, 'node_modules', 'jsdom');

function JSDOMClass() {
  return require(JSDOM_MODULE).JSDOM;
}

let _docsTreeModule = null;
function docsTreeModule() {
  if (!_docsTreeModule) _docsTreeModule = require(path.join(EXT_DIR, 'out', 'docs', 'docsTree.js'));
  return _docsTreeModule;
}

function fakeBacklog() {
  return {
    schemaVersion: 2,
    generatedAtIso: '2026-09-09T12:00:00Z',
    sourceSha: 'abc123def456',
    board: { active: [], paused: [], doneByMilestone: {} },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
  };
}

function fakeDocsTree(overrides = {}) {
  return {
    schemaVersion: 2,
    generatedAtIso: '2026-09-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [
      { id: 'specification', title: 'Specification', kind: 'markdown', content: '# The Spec\n\nSome vision text.' },
      { id: 'architectureDiagram', title: 'Architecture', kind: 'mermaid', content: 'graph TD; A-->B;' },
    ],
    milestones: [
      { milestone: 'M4', epics: [{ epicKey: '(no epic)', tickets: [{ id: 'BL-100', title: 'cost telemetry', status: 'done', priority: 1 }] }] },
    ],
    tickets: [
      {
        id: 'BL-100',
        title: 'cost telemetry',
        status: 'done',
        priority: 1,
        milestone: 'M4',
        description: 'Full prose description of BL-100.',
        scenarios: [
          { name: 'per-agent daily tokens match the transcripts', text: 'Scenario: per-agent daily tokens match the transcripts\n  Given a transcript\n  Then totals match' },
        ],
      },
    ],
    ...overrides,
  };
}

function renderDashboard(docsTree) {
  const JSDOM = JSDOMClass();
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  dom.window.fetch = (url) => {
    if (url === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
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

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function click(dom, element) {
  element.dispatchEvent(new dom.window.Event('click'));
}

function explorer(dom) {
  return dom.window.document.getElementById('docsExplorer');
}

function findButton(dom, prefix) {
  return [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf(prefix) === 0);
}

const FEATURE = 'documentation is explorable from vision level down to scenarios';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── docs-drilldown-01: full drill path from vision to a Gherkin scenario ──
  scoped(/^the published documentation artifact for the current main$/, (ctx) => {
    ctx.docsTree = fakeDocsTree();
  });

  scoped(/^the app user opens the documentation explorer$/, async (ctx) => {
    ctx.dom = renderDashboard(ctx.docsTree);
    await flush();
  });

  scoped(/^the vision level lists the product docs and both diagrams$/, (ctx) => {
    const text = explorer(ctx.dom).textContent;
    assert.match(text, /Specification/);
    assert.match(text, /Architecture/);
  });

  scoped(/^drilling into a milestone lists that milestone's tickets with folder-authoritative status$/, (ctx) => {
    click(ctx.dom, findButton(ctx.dom, 'M4'));
    assert.match(explorer(ctx.dom).textContent, /BL-100.*cost telemetry.*\[done\]/);
  });

  scoped(/^drilling into a ticket shows its prose description$/, (ctx) => {
    click(ctx.dom, findButton(ctx.dom, 'BL-100'));
    assert.match(explorer(ctx.dom).textContent, /Full prose description of BL-100/);
  });

  scoped(/^drilling into the ticket's acceptance shows its Gherkin scenarios as readable scenario text$/, (ctx) => {
    click(ctx.dom, explorer(ctx.dom).querySelector('button'));
    const gherkin = explorer(ctx.dom).querySelector('.gherkin');
    assert.ok(gherkin, 'the Gherkin leaf level must render a .gherkin block');
    assert.match(gherkin.textContent, /Given a transcript/);
    assert.match(gherkin.textContent, /Then totals match/);
  });

  // ── docs-drilldown-03: both acceptance forms render ───────────────────
  scoped(/^a ticket whose acceptance is (an inline YAML acceptance block|a reference to a specs\/features\/ file)$/, (ctx, form) => {
    const { computeDocsTree } = docsTreeModule();
    const target = trackedTmpRoot('sfvc-bl117-');
    fs.mkdirSync(path.join(target, 'backlog', 'active'), { recursive: true });
    if (form === 'a reference to a specs/features/ file') {
      fs.mkdirSync(path.join(target, 'specs', 'features'), { recursive: true });
      fs.writeFileSync(
        path.join(target, 'backlog', 'active', 'BL-200.yaml'),
        'id: BL-200\ntitle: t\nstatus: active\nacceptance: specs/features/BL-200-thing.feature\n'
      );
      fs.writeFileSync(
        path.join(target, 'specs', 'features', 'BL-200-thing.feature'),
        'Feature: x\n\nScenario: file-backed\n  Given a\n  Then b\n'
      );
    } else {
      fs.writeFileSync(
        path.join(target, 'backlog', 'active', 'BL-201.yaml'),
        'id: BL-201\ntitle: t\nstatus: active\nacceptance: |\n  Feature: x\n\n  Scenario: inline-backed\n    Given a\n'
      );
    }
    ctx.formTarget = target;
    ctx.formTicketId = form === 'a reference to a specs/features/ file' ? 'BL-200' : 'BL-201';
    ctx.formExpectedScenarioName = form === 'a reference to a specs/features/ file' ? 'file-backed' : 'inline-backed';
  });

  scoped(/^the user drills to its Gherkin level$/, (ctx) => {
    const { computeDocsTree } = docsTreeModule();
    const tree = computeDocsTree(ctx.formTarget);
    ctx.formTicket = tree.tickets.find((t) => t.id === ctx.formTicketId);
  });

  scoped(/^the scenarios are shown as readable scenario text$/, (ctx) => {
    assert.equal(ctx.formTicket.scenarios.length, 1);
    assert.equal(ctx.formTicket.scenarios[0].name, ctx.formExpectedScenarioName);
  });

  // ── docs-drilldown-04: offline exploration of the cached snapshot ─────
  scoped(/^the app previously fetched the documentation artifact$/, async (ctx) => {
    ctx.docsTree = fakeDocsTree();
    ctx.dom = renderDashboard(ctx.docsTree);
    await flush();
  });

  scoped(/^the device is offline$/, (ctx) => {
    // The explorer navigates entirely over the already-fetched, in-memory
    // docsTree (app.js's module-level `docsTree` var) - no further fetch is
    // ever issued by a drill-down click, so simulating offline is simply:
    // any LATER fetch would fail. Proven by making one, never consulted by
    // navigation below.
    ctx.dom.window.fetch = () => Promise.reject(new Error('offline'));
  });

  scoped(/^the explorer remains browsable at every level$/, (ctx) => {
    click(ctx.dom, findButton(ctx.dom, 'M4'));
    click(ctx.dom, findButton(ctx.dom, 'BL-100'));
    assert.match(explorer(ctx.dom).textContent, /Full prose description of BL-100/);
    click(ctx.dom, explorer(ctx.dom).querySelector('button'));
    assert.ok(explorer(ctx.dom).querySelector('.gherkin'), 'the Gherkin level must still render while offline');
  });

  scoped(/^the view is labeled with the commit\/timestamp it was rendered from$/, (ctx) => {
    const asOf = ctx.dom.window.document.getElementById('docsAsOf').textContent;
    assert.match(asOf, /As of/);
    assert.match(asOf, /abc123def4/);
  });

  // ── docs-drilldown-05: exploration is read-only ────────────────────────
  scoped(/^any level of the documentation explorer$/, async (ctx) => {
    ctx.docsTree = fakeDocsTree();
    ctx.dom = renderDashboard(ctx.docsTree);
    await flush();
    click(ctx.dom, findButton(ctx.dom, 'M4'));
    click(ctx.dom, findButton(ctx.dom, 'BL-100'));
  });

  scoped(/^no affordance exists to edit documentation or create\/modify tickets$/, (ctx) => {
    const editableElements = explorer(ctx.dom).querySelectorAll('input, textarea, [contenteditable="true"], form');
    assert.equal(editableElements.length, 0);
  });
}

module.exports = { registerSteps };
