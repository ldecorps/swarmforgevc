const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { getEpicReorderUiHtml } = require('../out/bridge/epicReorderUiHtml');

// Architect bounce #3: the compiled getEpicReorderUiHtml() shell had no test
// of any kind, and its move() handler discarded the server's failure reason
// on every non-2xx response (only the boundary no-op's 2xx path rendered a
// reason). These tests load the REAL emitted inline <script> into a stubbed
// DOM/fetch - same technique the architect's own (uncommitted) reproduction
// probe used - so the failure-reason path is asserted from committed test
// code, not just a evidence file.

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in getEpicReorderUiHtml() output');
  }
  return match[1];
}

function renderScreen(fetchImpl) {
  const html = getEpicReorderUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/reorder/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  dom.fetchCalls = [];
  window.fetch = (url, opts) => {
    dom.fetchCalls.push(url);
    return fetchImpl(url, opts);
  };
  window.eval(extractInlineScript(html));
  return dom;
}

// jsdom's microtask queue needs a real tick to drain the fetch().then()
// chains move()/refresh() kick off.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stateResponse(items) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ items, total: items.length }) });
}

test('epic reorder screen: a failed move renders the SERVER-supplied reason, not just an HTTP status (architect bounce #3)', async () => {
  const items = [
    { id: 'BL-100', title: 'first', priority: 0 },
    { id: 'BL-200', title: 'second', priority: 10 },
  ];
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(items);
    }
    if (url.startsWith('/epic-reorder/move')) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ success: false, changed: false, reason: 'write succeeded but commit failed' }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();

  const { document } = dom.window;
  const moveUpButtons = document.querySelectorAll('.move-up');
  assert.equal(moveUpButtons.length, 2);
  moveUpButtons[1].onclick();
  await flush();

  assert.equal(
    document.getElementById('move-status').textContent,
    'write succeeded but commit failed',
    'the reason the server sent must reach the screen, not a raw HTTP status'
  );
});

test('epic reorder screen: a failed move with no parseable reason falls back to the HTTP status, never silence', async () => {
  const items = [
    { id: 'BL-100', title: 'first', priority: 0 },
    { id: 'BL-200', title: 'second', priority: 10 },
  ];
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(items);
    }
    if (url.startsWith('/epic-reorder/move')) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not json')) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();

  const { document } = dom.window;
  document.querySelectorAll('.move-up')[1].onclick();
  await flush();

  assert.equal(document.getElementById('move-status').textContent, 'Move failed (HTTP 404)');
});

test('epic reorder screen: a failure whose write already landed on disk (changed:true) refreshes rather than leaving the stale list', async () => {
  const items = [
    { id: 'BL-100', title: 'first', priority: 0 },
    { id: 'BL-200', title: 'second', priority: 10 },
  ];
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(items);
    }
    if (url.startsWith('/epic-reorder/move')) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ success: false, changed: true, reason: 'write succeeded but commit failed' }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();

  const stateCallsBefore = dom.fetchCalls.filter((u) => u.startsWith('/epic-reorder-state')).length;
  dom.window.document.querySelectorAll('.move-up')[1].onclick();
  await flush();

  const stateCallsAfter = dom.fetchCalls.filter((u) => u.startsWith('/epic-reorder-state')).length;
  assert.ok(
    stateCallsAfter > stateCallsBefore,
    'a commit-failed response with changed:true must trigger a refresh so the screen stops showing the pre-move list'
  );
});

// BL-672: the make-top button must not repeat architect bounce #3's own
// defect on its own new endpoint - the shared handleActionResponse() this
// reuses is exactly the fix for that, but the wiring (button -> route ->
// reason rendering) is asserted directly here rather than trusted by
// inspection.
test('BL-672: a tile\'s "Make top" button posts to /epic-reorder/make-top and renders the server reason', async () => {
  const items = [
    { id: 'BL-100', title: 'first', priority: 0 },
    { id: 'BL-200', title: 'second', priority: 10 },
  ];
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(items);
    }
    if (url.startsWith('/epic-reorder/make-top')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, changed: false, reason: 'Already the unique top of the live backlog.' }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();

  const { document } = dom.window;
  const makeTopButtons = document.querySelectorAll('.make-top');
  assert.equal(makeTopButtons.length, 2);
  makeTopButtons[1].onclick();
  await flush();

  assert.ok(
    dom.fetchCalls.some((u) => u.startsWith('/epic-reorder/make-top')),
    'expected the button to call the make-top route'
  );
  assert.equal(document.getElementById('move-status').textContent, 'Already the unique top of the live backlog.');
});

// BL-672 architect bounce #1: disableUp (index === 0 over the epics-only
// list) does not mean "already top of the live backlog" - the make-top
// route's domination set is readLiveBacklogItems (paused+hold, epics AND
// topics). A live topic or hold item can outrank the leading epic, in which
// case make-top would perform a real change while the old disabled-on-index-0
// button blocked the tap. The button must never be disabled by screen
// position; the route's own changed:false + reason is the only refusal
// signal (matching BL-673's topic make-top, which has no disable at all).
test('BL-672 bounce #1: the leading epic\'s "Make top" button is not disabled, even when it may be outranked in the live backlog', async () => {
  const items = [
    { id: 'BL-100', title: 'first', priority: 2 },
    { id: 'BL-200', title: 'second', priority: 3 },
  ];
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(items);
    }
    if (url.startsWith('/epic-reorder/make-top')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          changed: true,
          writes: [{ id: 'T1', priority: 2 }, { id: 'BL-100', priority: 1 }],
        }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();

  const { document } = dom.window;
  const leadingMakeTop = document.querySelectorAll('.make-top')[0];
  assert.equal(
    leadingMakeTop.hasAttribute('disabled'),
    false,
    'the leading epic on screen is not necessarily the live top (a live topic or hold item can outrank it), so its make-top button must stay enabled'
  );

  leadingMakeTop.onclick();
  await flush();

  assert.ok(
    dom.fetchCalls.some((u) => u.startsWith('/epic-reorder/make-top')),
    'the leading epic\'s make-top tap must reach the route rather than being blocked client-side'
  );
});

test('BL-672: a failed make-top renders the SERVER-supplied reason, not just an HTTP status', async () => {
  const items = [
    { id: 'BL-100', title: 'first', priority: 0 },
    { id: 'BL-200', title: 'second', priority: 10 },
  ];
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(items);
    }
    if (url.startsWith('/epic-reorder/make-top')) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ success: false, changed: false, reason: 'write succeeded but commit failed' }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();

  const { document } = dom.window;
  document.querySelectorAll('.make-top')[1].onclick();
  await flush();

  assert.equal(document.getElementById('move-status').textContent, 'write succeeded but commit failed');
});
