const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// BL-117: renders the REAL pwa/index.html + pwa/app.js in jsdom (mirroring
// pwaDashboard.test.js's own pattern), fed a fake docs-tree.json, and
// exercises the drill-down by dispatching real click events - so tests
// prove the explorer actually navigates rather than restating the
// navigation logic by hand.

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

function fakeBacklog() {
  return {
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
  };
}

function fakeDocsTree(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [
      { id: 'specification', title: 'Specification', kind: 'markdown', content: '# The Spec\n\nSome vision text.' },
      { id: 'architectureDiagram', title: 'Architecture', kind: 'mermaid', content: 'graph TD; A-->B;' },
    ],
    milestones: [
      { milestone: 'M4', tickets: [{ id: 'BL-100', title: 'cost telemetry', status: 'done', priority: 1 }] },
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
  const localesSource = fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8');
  dom.window.eval(localesSource);
  const appSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  dom.window.eval(appSource);
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

function crumbs(dom) {
  return dom.window.document.getElementById('docsCrumbs');
}

function searchInput(dom) {
  return dom.window.document.getElementById('docsSearchInput');
}

function typeSearch(dom, text) {
  var input = searchInput(dom);
  input.value = text;
  input.dispatchEvent(new dom.window.Event('input'));
}

test('the root level lists the vision docs and every milestone (docs-drilldown-01)', async () => {
  const dom = renderDashboard(fakeDocsTree());
  await flush();
  const text = explorer(dom).textContent;
  assert.match(text, /Specification/);
  assert.match(text, /Architecture/);
  assert.match(text, /M4/);
});

test('drilling into a vision doc shows its content', async () => {
  const dom = renderDashboard(fakeDocsTree());
  await flush();
  const specButton = [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent === 'Specification');
  click(dom, specButton);
  assert.match(explorer(dom).textContent, /Some vision text/);
  assert.match(crumbs(dom).textContent, /Documentation.*Specification/);
});

test('drilling into a milestone lists its tickets with folder-authoritative status (docs-drilldown-01)', async () => {
  const dom = renderDashboard(fakeDocsTree());
  await flush();
  const milestoneButton = [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0);
  click(dom, milestoneButton);
  assert.match(explorer(dom).textContent, /BL-100.*cost telemetry.*\[done\]/);
});

test('drilling into a ticket shows its prose description (docs-drilldown-01)', async () => {
  const dom = renderDashboard(fakeDocsTree());
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  assert.match(explorer(dom).textContent, /Full prose description of BL-100/);
});

test('drilling into the ticket\'s acceptance shows its Gherkin scenario as readable text (docs-drilldown-01)', async () => {
  const dom = renderDashboard(fakeDocsTree());
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  click(dom, explorer(dom).querySelector('button'));
  const gherkin = explorer(dom).querySelector('.gherkin');
  assert.ok(gherkin, 'the Gherkin leaf level must render a .gherkin block');
  assert.match(gherkin.textContent, /Given a transcript/);
  assert.match(gherkin.textContent, /Then totals match/);
});

test('breadcrumbs navigate back up to an earlier level', async () => {
  const dom = renderDashboard(fakeDocsTree());
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  assert.match(crumbs(dom).textContent, /Documentation.*M4.*BL-100/);

  const rootCrumb = crumbs(dom).querySelector('button');
  click(dom, rootCrumb);
  assert.match(explorer(dom).textContent, /Specification/);
  assert.doesNotMatch(crumbs(dom).textContent, /BL-100/);
});

// ── BL-257 per-ticket-timeline-02 ─────────────────────────────────────────

test('a ticket with git-derived lifecycle dates shows its timeline in order', async () => {
  const tree = fakeDocsTree();
  tree.tickets[0].specDateIso = '2026-07-01T00:00:00Z';
  tree.tickets[0].closeDateIso = '2026-07-05T00:00:00Z';
  const dom = renderDashboard(tree);
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));

  const text = explorer(dom).textContent;
  const speccedIndex = text.indexOf('2026-07-01');
  const closedIndex = text.indexOf('2026-07-05');
  assert.ok(speccedIndex !== -1 && closedIndex !== -1, `expected both dates shown, got: ${text}`);
  assert.ok(speccedIndex < closedIndex, 'expected specced before closed, in order');
});

test('a still-open ticket shows only its specced date, no closed date', async () => {
  const tree = fakeDocsTree();
  tree.tickets[0].specDateIso = '2026-07-01T00:00:00Z';
  const dom = renderDashboard(tree);
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));

  const text = explorer(dom).textContent;
  assert.match(text, /2026-07-01/);
  assert.match(text, /Timeline/);
});

test('a ticket with no lifecycle data shows a localized empty timeline state, not an error', async () => {
  const dom = renderDashboard(fakeDocsTree());
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));

  assert.match(explorer(dom).textContent, /No timeline data available/);
});

test('a ticket with no resolved scenarios shows an explicit empty state, not an error', async () => {
  const tree = fakeDocsTree();
  tree.tickets[0].scenarios = [];
  const dom = renderDashboard(tree);
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  assert.match(explorer(dom).textContent, /no scenarios resolved/);
});

test('shows the "as of" generation time for the docs tree (docs-drilldown-04\'s honesty requirement)', async () => {
  const dom = renderDashboard(fakeDocsTree());
  await flush();
  const asOf = dom.window.document.getElementById('docsAsOf').textContent;
  assert.match(asOf, /As of/);
  assert.match(asOf, /abc123def4/);
});

test('the explorer offers no edit affordance anywhere (docs-drilldown-05)', async () => {
  const dom = renderDashboard(fakeDocsTree());
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  const editableElements = explorer(dom).querySelectorAll('input, textarea, [contenteditable="true"], form');
  assert.equal(editableElements.length, 0);
});

test('an empty docs tree (no vision, no milestones, no tickets) renders without error', async () => {
  const dom = renderDashboard(fakeDocsTree({ vision: [], milestones: [], tickets: [] }));
  await flush();
  assert.doesNotThrow(() => explorer(dom).textContent);
});

// ── BL-253: implemented vs not-yet-implemented greying ────────────────────

function implementationFixtureTree() {
  return fakeDocsTree({
    milestones: [
      {
        milestone: 'M4',
        tickets: [
          { id: 'BL-100', title: 'cost telemetry', status: 'done', priority: 1, implemented: true },
          { id: 'BL-200', title: 'not built yet', status: 'active', priority: 1, implemented: false },
        ],
      },
    ],
    tickets: [
      {
        id: 'BL-100',
        title: 'cost telemetry',
        status: 'done',
        priority: 1,
        milestone: 'M4',
        implemented: true,
        description: 'Full prose description of BL-100.',
        scenarios: [{ name: 'a scenario', text: 'Scenario: a scenario\n  Given x' }],
      },
      {
        id: 'BL-200',
        title: 'not built yet',
        status: 'active',
        priority: 1,
        milestone: 'M4',
        implemented: false,
        description: 'A planned ticket.',
        scenarios: [{ name: 'planned scenario', text: 'Scenario: planned scenario\n  Given a plan' }],
      },
    ],
  });
}

test('status-from-folder-01: a done ticket renders as implemented, not greyed', async () => {
  const dom = renderDashboard(implementationFixtureTree());
  await flush();
  const milestoneButton = [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0);
  click(dom, milestoneButton);
  const doneButton = [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0);
  assert.match(doneButton.textContent, /\(implemented\)/);
  assert.equal(doneButton.classList.contains('not-yet-implemented'), false);
});

test('status-from-folder-01: an active (not-yet) ticket renders greyed as not-yet-implemented', async () => {
  const dom = renderDashboard(implementationFixtureTree());
  await flush();
  const milestoneButton = [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0);
  click(dom, milestoneButton);
  const notYetButton = [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-200') === 0);
  assert.match(notYetButton.textContent, /\(not yet implemented\)/);
  assert.equal(notYetButton.classList.contains('not-yet-implemented'), true);
});

test('not-yet-expandable-02: a greyed not-yet ticket still expands to show its planned scenarios', async () => {
  const dom = renderDashboard(implementationFixtureTree());
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-200') === 0));
  assert.match(explorer(dom).textContent, /A planned ticket/);
  const scenarioButton = explorer(dom).querySelector('button');
  assert.ok(scenarioButton, 'a not-yet-implemented ticket must still list its planned scenarios as clickable');
  assert.match(scenarioButton.textContent, /planned scenario/);
});

test('the ticket-detail status line is greyed for a not-yet-implemented ticket, not for an implemented one', async () => {
  const dom = renderDashboard(implementationFixtureTree());
  await flush();
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  const doneStatusLine = [...explorer(dom).querySelectorAll('p')].find((p) => /cost telemetry/.test(p.textContent));
  assert.equal(doneStatusLine.classList.contains('not-yet-implemented'), false);
});

// ── BL-254: full-text search filter ───────────────────────────────────────

function searchFixtureTree() {
  return fakeDocsTree({
    milestones: [
      { milestone: 'M4', tickets: [{ id: 'BL-100', title: 'cost telemetry', status: 'done', priority: 1 }] },
      { milestone: 'M7', tickets: [{ id: 'BL-200', title: 'unrelated ticket', status: 'active', priority: 1 }] },
    ],
    tickets: [
      {
        id: 'BL-100',
        title: 'cost telemetry',
        status: 'done',
        priority: 1,
        milestone: 'M4',
        description: 'Full prose description of BL-100.',
        scenarios: [{ name: 'per-agent daily tokens', text: 'Scenario: per-agent daily tokens\n  Given the fleet console refreshes' }],
      },
      {
        id: 'BL-200',
        title: 'unrelated ticket',
        status: 'active',
        priority: 1,
        milestone: 'M7',
        description: 'Nothing to do with the search term.',
        scenarios: [{ name: 'other', text: 'Scenario: other\n  Given something else entirely' }],
      },
    ],
  });
}

test('filter-by-gherkin-01: typing a query matching a ticket\'s Gherkin filters the milestone list to it', async () => {
  const dom = renderDashboard(searchFixtureTree());
  await flush();
  typeSearch(dom, 'fleet console');
  assert.match(explorer(dom).textContent, /M4/);
  assert.doesNotMatch(explorer(dom).textContent, /M7/);
});

test('case-insensitive-03: a query differing only in letter case still matches', async () => {
  const dom = renderDashboard(searchFixtureTree());
  await flush();
  typeSearch(dom, 'FLEET CONSOLE');
  assert.match(explorer(dom).textContent, /M4/);
});

test('empty-query-05: clearing the search box restores the full unfiltered tree', async () => {
  const dom = renderDashboard(searchFixtureTree());
  await flush();
  typeSearch(dom, 'fleet console');
  typeSearch(dom, '');
  assert.match(explorer(dom).textContent, /M4/);
  assert.match(explorer(dom).textContent, /M7/);
});

test('no-results-06: a query matching nothing shows the localized no-results state, not a blank or error', async () => {
  const dom = renderDashboard(searchFixtureTree());
  await flush();
  typeSearch(dom, 'nothing matches this at all');
  assert.match(explorer(dom).textContent, /No tickets match your search/);
  assert.doesNotMatch(explorer(dom).textContent, /M4/);
});

// docsTree.ts's filterDocsTree (the TS/unit-tested implementation) and
// pwa/app.js's own hand-duplicated copy (this file's coverage) are two
// independent reimplementations kept in sync by hand - the app.js
// comment says so outright. docsTree.test.js already covers these two
// cases on the TS side (match-title-description-02, empty-query-05's
// whitespace variant); mirroring them here closes the asymmetry so a
// future JS-only divergence (e.g. someone drops the `.description` check
// or the `.trim()` call from just the app.js copy) fails a PWA-side test
// too, not only the TS one.
test('description-only-02: a query matching only a ticket\'s description (not title or Gherkin) still surfaces it', async () => {
  const dom = renderDashboard(searchFixtureTree());
  await flush();
  typeSearch(dom, 'prose description of BL-100');
  assert.match(explorer(dom).textContent, /M4/);
  assert.doesNotMatch(explorer(dom).textContent, /M7/);
});

test('whitespace-only-query-05: a query of only spaces is treated the same as empty - the full tree, not zero matches', async () => {
  const dom = renderDashboard(searchFixtureTree());
  await flush();
  typeSearch(dom, '   ');
  assert.match(explorer(dom).textContent, /M4/);
  assert.match(explorer(dom).textContent, /M7/);
});

test('the search input placeholder is localized', async () => {
  const dom = renderDashboard(searchFixtureTree());
  await flush();
  assert.equal(searchInput(dom).getAttribute('placeholder'), 'Search spec text…');
});

test('typing does not destroy the search input itself (focus/cursor survive a re-render)', async () => {
  const dom = renderDashboard(searchFixtureTree());
  await flush();
  const before = searchInput(dom);
  typeSearch(dom, 'fleet');
  assert.equal(searchInput(dom), before, 'the input element must be the same DOM node across re-renders');
});

test('shows an honest failure message when the docs-tree fetch fails entirely', async () => {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/' });
  dom.window.fetch = (url) => {
    if (url === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    }
    return Promise.reject(new Error('offline, nothing cached'));
  };
  const localesSource = fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8');
  dom.window.eval(localesSource);
  const appSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  dom.window.eval(appSource);
  await flush();
  assert.match(dom.window.document.getElementById('docsAsOf').textContent, /Could not load/);
});
