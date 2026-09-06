const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { getSpecTreeUiHtml } = require('../out/bridge/specTreeUiHtml');

// BL-592 hardening: getSpecTreeUiHtml()'s inline <script> is one opaque
// string to Stryker (mutate: ["out/**/*.js"] never descends into a template
// literal's string content — same class as pausedPager/residentSpy/
// epicDrilldown/epicReorder). This harness is its only mutation-equivalent
// coverage: pull the real script out of the real HTML and drive the
// Milestone -> Epic -> BL item -> Gherkin drill-down directly.

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in getSpecTreeUiHtml() output');
  }
  return match[1];
}

function renderScreen(fetchImpl) {
  const html = getSpecTreeUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/spec-tree/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  dom.fetchCalls = [];
  window.fetch = (url, opts) => {
    dom.fetchCalls.push({ url, opts });
    return fetchImpl(url, opts);
  };
  window.eval(extractInlineScript(html));
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stateResponse(tree) {
  return Promise.resolve({ json: () => Promise.resolve(tree) });
}

const TREE = {
  sourceSha: 'abcdef1234567890',
  milestones: [
    {
      milestone: 'M8',
      epics: [
        {
          epicKey: 'swarmforge-console',
          title: 'Console',
          trackerId: 'BL-341',
          // Two tickets here (vs. one in the sibling epic below) so a count
          // computed by summing PER-EPIC ticket lengths differs from one
          // computed by merely counting epics - discriminates a real mutant
          // that survived when every epic happened to carry exactly 1 ticket.
          tickets: [
            { id: 'BL-592', title: 'spec tree', status: 'todo' },
            { id: 'BL-593', title: 'spec tree part 2', status: 'todo' },
          ],
        },
        {
          epicKey: '(no epic)',
          tickets: [{ id: 'BL-100', title: 'cost telemetry', status: 'done' }],
        },
      ],
    },
    {
      milestone: 'M9',
      epics: [{ epicKey: '(no epic)', tickets: [{ id: 'BL-200', title: 'unrelated', status: 'active' }] }],
    },
  ],
  // findTicket() in the inline script reads full ticket detail (description,
  // scenarios) from this top-level roll-up, never from the lightweight
  // MilestoneTicketSummary entries nested under an epic - mirrors docsTree.ts's
  // own DocsTreeData shape (pwaDocsExplorer.test.js's fakeDocsTree does the same
  // split).
  tickets: [
    {
      id: 'BL-592',
      title: 'spec tree',
      status: 'todo',
      description: 'Full prose for BL-592.',
      scenarios: [{ name: 'a scenario name', text: 'Scenario: a scenario name\n  Given X\n  Then Y' }],
    },
    { id: 'BL-593', title: 'spec tree part 2', status: 'todo' },
    { id: 'BL-100', title: 'cost telemetry', status: 'done' },
    { id: 'BL-200', title: 'unrelated', status: 'active' },
  ],
};

test('BL-592-01: the milestones screen lists every milestone with its ticket count summed across all its epics', async () => {
  const dom = renderScreen((url) => (url.startsWith('/spec-tree-state') ? stateResponse(TREE) : Promise.reject(new Error('unexpected fetch: ' + url))));
  await flush();
  const { document } = dom.window;
  const m8 = document.querySelector('[data-testid="milestone-M8"]');
  const m9 = document.querySelector('[data-testid="milestone-M9"]');
  assert.ok(m8, 'expected an M8 milestone tile');
  assert.equal(m8.textContent, 'M8 (3)', 'count must sum tickets across BOTH of M8\'s epics, not just the first');
  assert.equal(m9.textContent, 'M9 (1)');
});

test('BL-592-02: drilling into a milestone lists its epics, a tracker-backed epic shows its title and the tracker ticket itself is not a leaf', async () => {
  const dom = renderScreen((url) => (url.startsWith('/spec-tree-state') ? stateResponse(TREE) : Promise.reject(new Error('unexpected fetch: ' + url))));
  await flush();
  const { document } = dom.window;
  document.querySelector('[data-testid="milestone-M8"]').click();
  await flush();

  const consoleEpic = document.querySelector('[data-testid="epic-swarmforge-console"]');
  const bareEpic = document.querySelector('[data-testid="epic-(no epic)"]');
  assert.ok(consoleEpic, 'expected the tracker-backed epic tile');
  assert.equal(consoleEpic.textContent, 'Console (2)', 'a tracker epic must show its title, not its raw epicKey');
  assert.equal(bareEpic.textContent, '(no epic) (1)', 'an untitled epic falls back to its epicKey as the label');
});

test('BL-592-03: drilling into an epic lists exactly its own tickets, not a sibling epic\'s', async () => {
  const dom = renderScreen((url) => (url.startsWith('/spec-tree-state') ? stateResponse(TREE) : Promise.reject(new Error('unexpected fetch: ' + url))));
  await flush();
  const { document } = dom.window;
  document.querySelector('[data-testid="milestone-M8"]').click();
  await flush();
  document.querySelector('[data-testid="epic-swarmforge-console"]').click();
  await flush();

  assert.ok(document.querySelector('[data-testid="ticket-BL-592"]'), 'expected BL-592 under its own epic');
  assert.ok(document.querySelector('[data-testid="ticket-BL-593"]'), 'expected BL-593 under its own epic too');
  assert.ok(!document.querySelector('[data-testid="ticket-BL-100"]'), 'BL-100 belongs to the sibling (no epic) bucket and must not leak in');
});

// findEpic(milestoneName, epicKey) selects among 2+ concurrent epics under one
// milestone - the prior test alone drills only the FIRST epic in M8's array,
// which cannot discriminate a real lookup from "always return epics[0]". This
// test drills the SECOND to prove the epicKey is actually the selector.
test('BL-592-03b: drilling into the SECOND epic under a milestone lists only its own tickets, not the first epic\'s', async () => {
  const dom = renderScreen((url) => (url.startsWith('/spec-tree-state') ? stateResponse(TREE) : Promise.reject(new Error('unexpected fetch: ' + url))));
  await flush();
  const { document } = dom.window;
  document.querySelector('[data-testid="milestone-M8"]').click();
  await flush();
  document.querySelector('[data-testid="epic-(no epic)"]').click();
  await flush();

  assert.ok(document.querySelector('[data-testid="ticket-BL-100"]'), 'expected BL-100 under the (no epic) bucket');
  assert.ok(!document.querySelector('[data-testid="ticket-BL-592"]'), 'BL-592 belongs to the console epic and must not leak in when a DIFFERENT epic is selected');
  assert.ok(!document.querySelector('[data-testid="ticket-BL-593"]'), 'BL-593 belongs to the console epic and must not leak in when a DIFFERENT epic is selected');
});

test('BL-592-04: drilling into a ticket shows its description and its scenarios as separate leaves', async () => {
  const dom = renderScreen((url) => (url.startsWith('/spec-tree-state') ? stateResponse(TREE) : Promise.reject(new Error('unexpected fetch: ' + url))));
  await flush();
  const { document } = dom.window;
  document.querySelector('[data-testid="milestone-M8"]').click();
  await flush();
  document.querySelector('[data-testid="epic-swarmforge-console"]').click();
  await flush();
  document.querySelector('[data-testid="ticket-BL-592"]').click();
  await flush();

  assert.match(document.getElementById('content').textContent, /Full prose for BL-592/);
  const scenarioBtn = document.querySelector('[data-testid="scenario-0"]');
  assert.ok(scenarioBtn, 'expected a scenario leaf button');
  assert.equal(scenarioBtn.textContent, 'a scenario name');
});

test('BL-592-05: drilling into a scenario shows its raw Gherkin text', async () => {
  const dom = renderScreen((url) => (url.startsWith('/spec-tree-state') ? stateResponse(TREE) : Promise.reject(new Error('unexpected fetch: ' + url))));
  await flush();
  const { document } = dom.window;
  document.querySelector('[data-testid="milestone-M8"]').click();
  await flush();
  document.querySelector('[data-testid="epic-swarmforge-console"]').click();
  await flush();
  document.querySelector('[data-testid="ticket-BL-592"]').click();
  await flush();
  document.querySelector('[data-testid="scenario-0"]').click();
  await flush();

  const pre = document.querySelector('[data-testid="scenario-text"]');
  assert.ok(pre, 'expected the Gherkin leaf level to render a scenario-text block');
  assert.match(pre.textContent, /Given X/);
  assert.match(pre.textContent, /Then Y/);
});

test('BL-592-06: crumbs let a scenario view jump straight back to the milestones root', async () => {
  const dom = renderScreen((url) => (url.startsWith('/spec-tree-state') ? stateResponse(TREE) : Promise.reject(new Error('unexpected fetch: ' + url))));
  await flush();
  const { document } = dom.window;
  document.querySelector('[data-testid="milestone-M8"]').click();
  await flush();
  document.querySelector('[data-testid="epic-swarmforge-console"]').click();
  await flush();
  document.querySelector('[data-testid="ticket-BL-592"]').click();
  await flush();
  document.querySelector('[data-testid="scenario-0"]').click();
  await flush();

  const crumbButtons = [...document.getElementById('crumbs').querySelectorAll('button')];
  const rootCrumb = crumbButtons.find((b) => b.textContent === 'Milestones');
  assert.ok(rootCrumb, 'expected a "Milestones" crumb while viewing a scenario');
  rootCrumb.click();
  await flush();

  assert.ok(document.querySelector('[data-testid="milestone-M8"]'), 'expected to be back at the milestones root screen');
});

test('BL-592-07: a ticket listed under an epic but missing from the top-level ticket roll-up (generator drift) shows "Ticket not found." rather than throwing', async () => {
  const driftedTree = {
    ...TREE,
    // The epic still lists BL-592, but the top-level roll-up findTicket()
    // actually reads from no longer carries it - a defensive guard against
    // the two sources of truth (per-epic summary vs. top-level detail) drifting.
    tickets: TREE.tickets.filter((t) => t.id !== 'BL-592'),
  };
  const dom = renderScreen((url) => (url.startsWith('/spec-tree-state') ? stateResponse(driftedTree) : Promise.reject(new Error('unexpected fetch: ' + url))));
  await flush();
  const { document } = dom.window;
  document.querySelector('[data-testid="milestone-M8"]').click();
  await flush();
  document.querySelector('[data-testid="epic-swarmforge-console"]').click();
  await flush();
  document.querySelector('[data-testid="ticket-BL-592"]').click();
  await flush();

  assert.match(document.getElementById('content').textContent, /Ticket not found\./);
});

test('BL-592-09: a fetch failure surfaces "Error" in the status line rather than leaving "Loading…" stuck', async () => {
  const dom = renderScreen(() => Promise.reject(new Error('network down')));
  await flush();
  assert.equal(dom.window.document.getElementById('status').textContent, 'Error');
});

test('BL-592-10: the status line shows the short source SHA once the tree loads', async () => {
  const dom = renderScreen((url) => (url.startsWith('/spec-tree-state') ? stateResponse(TREE) : Promise.reject(new Error('unexpected fetch: ' + url))));
  await flush();
  assert.equal(dom.window.document.getElementById('status').textContent, 'abcdef12');
});

// ── BL-1412: the filter box ──────────────────────────────────────────────
// The actual match logic (BL-254 text match + label match) lives entirely
// server-side in filterSpecTree (docsTree.test.js covers it directly) - this
// harness only proves the SCREEN wires typing to a debounced `?q=` refetch,
// re-renders whatever the server returns, and shows a no-results state.
// FILTERED_TREE stands in for "the server already applied the filter" -
// never a re-implementation of the match itself.

const FILTERED_TREE = {
  sourceSha: 'abcdef1234567890',
  milestones: [
    {
      milestone: 'M8',
      epics: [
        {
          epicKey: 'swarmforge-console',
          title: 'Console',
          trackerId: 'BL-341',
          tickets: [
            { id: 'BL-592', title: 'spec tree', status: 'todo' },
            { id: 'BL-593', title: 'spec tree part 2', status: 'todo' },
          ],
        },
      ],
    },
  ],
  tickets: [
    { id: 'BL-592', title: 'spec tree', status: 'todo' },
    { id: 'BL-593', title: 'spec tree part 2', status: 'todo' },
  ],
};

const EMPTY_TREE = { sourceSha: 'abcdef1234567890', milestones: [], tickets: [] };

function fetchByQuery(routes) {
  return (url) => {
    if (!url.startsWith('/spec-tree-state')) {
      return Promise.reject(new Error('unexpected fetch: ' + url));
    }
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('q') || '';
    if (!(q in routes)) {
      throw new Error('unexpected q="' + q + '" - known: ' + Object.keys(routes).join(','));
    }
    return stateResponse(routes[q]);
  };
}

function setFilterInput(dom, value) {
  const input = dom.window.document.querySelector('[data-testid="spec-tree-filter"]');
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input'));
}

test('BL-1412-01: typing a term narrows the milestones view once the debounce settles, requesting q=<term>', async () => {
  vi.useFakeTimers();
  try {
    const dom = renderScreen(fetchByQuery({ '': TREE, fleet: FILTERED_TREE }));
    await vi.advanceTimersByTimeAsync(0);
    const { document } = dom.window;
    assert.ok(document.querySelector('[data-testid="milestone-M8"]'));
    assert.ok(document.querySelector('[data-testid="milestone-M9"]'));

    setFilterInput(dom, 'fleet');
    await vi.advanceTimersByTimeAsync(260);

    assert.ok(document.querySelector('[data-testid="milestone-M8"]'), 'expected M8 to remain - it holds the matching ticket');
    assert.ok(!document.querySelector('[data-testid="milestone-M9"]'), 'expected M9 to be pruned - no match there');
  } finally {
    vi.useRealTimers();
  }
});

test('BL-1412-02: a rapid second keystroke cancels the pending debounced fetch for the first, never firing two', async () => {
  vi.useFakeTimers();
  try {
    const dom = renderScreen(fetchByQuery({ '': TREE, fl: TREE, fleet: FILTERED_TREE }));
    await vi.advanceTimersByTimeAsync(0);
    const initialCalls = dom.fetchCalls.length;

    setFilterInput(dom, 'fl');
    await vi.advanceTimersByTimeAsync(100); // well under the 250ms debounce
    setFilterInput(dom, 'fleet');
    await vi.advanceTimersByTimeAsync(260);

    const afterCalls = dom.fetchCalls.filter((c) => c.url.startsWith('/spec-tree-state')).length - initialCalls;
    assert.equal(afterCalls, 1, 'expected exactly one debounced fetch, not one per keystroke');
    assert.ok(dom.fetchCalls[dom.fetchCalls.length - 1].url.includes('q=fleet'), 'expected the SURVIVING fetch to carry the LATEST term');
  } finally {
    vi.useRealTimers();
  }
});

test('BL-1412-03: clearing the filter box restores the full unfiltered tree', async () => {
  vi.useFakeTimers();
  try {
    const dom = renderScreen(fetchByQuery({ '': TREE, fleet: FILTERED_TREE }));
    await vi.advanceTimersByTimeAsync(0);
    setFilterInput(dom, 'fleet');
    await vi.advanceTimersByTimeAsync(260);
    assert.ok(!dom.window.document.querySelector('[data-testid="milestone-M9"]'), 'sanity: filtered first');

    setFilterInput(dom, '');
    await vi.advanceTimersByTimeAsync(260);

    const { document } = dom.window;
    assert.ok(document.querySelector('[data-testid="milestone-M8"]'));
    assert.ok(document.querySelector('[data-testid="milestone-M9"]'), 'expected the full tree back once the box is cleared');
    assert.equal(document.querySelector('[data-testid="milestone-M8"]').textContent, 'M8 (3)', 'expected the full, unfiltered count too');
  } finally {
    vi.useRealTimers();
  }
});

test('BL-1412-04: a term matching nothing shows a no-results state naming the term, not a blank page', async () => {
  vi.useFakeTimers();
  try {
    const dom = renderScreen(fetchByQuery({ '': TREE, 'zzzz-no-such-term': EMPTY_TREE }));
    await vi.advanceTimersByTimeAsync(0);

    setFilterInput(dom, 'zzzz-no-such-term');
    await vi.advanceTimersByTimeAsync(260);

    const empty = dom.window.document.querySelector('[data-testid="no-results"]');
    assert.ok(empty, 'expected a no-results element');
    assert.match(empty.textContent, /zzzz-no-such-term/);
  } finally {
    vi.useRealTimers();
  }
});
