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
