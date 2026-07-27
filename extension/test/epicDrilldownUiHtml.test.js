const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { getEpicReorderUiHtml } = require('../out/bridge/epicReorderUiHtml');

// BL-674: the epic reorder screen's drill-down (one epic's live topics,
// per-topic make-top). Same technique as epicReorderUiHtml.test.js beside
// it - loads the REAL emitted inline <script> into a stubbed DOM/fetch.

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
    dom.fetchCalls.push({ url, opts });
    return fetchImpl(url, opts);
  };
  window.eval(extractInlineScript(html));
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stateResponse(items, topics) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ items, total: items.length, topics: topics || [] }) });
}

const EPICS = [
  { id: 'EA', title: 'Epic A', priority: 0 },
  { id: 'EB', title: 'Epic B', priority: 10 },
];

// BL-686: `epicIds` carries the server-resolved epic TICKET ids (never the
// raw slug the webview used to compare against its own tile id) - EA/EB
// here stand for those ids, same as the tiles' own data-id.
const TOPICS = [
  { id: 'A1', title: 'Topic A1', priority: 1, epicIds: ['EA'], hasLiveDependency: false },
  { id: 'A2', title: 'Topic A2', priority: 4, epicIds: ['EA'], hasLiveDependency: false },
  { id: 'A3', title: 'Topic A3', priority: 6, epicIds: ['EA'], hasLiveDependency: true },
  { id: 'B1', title: 'Topic B1', priority: 2, epicIds: ['EB'], hasLiveDependency: false },
];

test('BL-674-01: drilling into an epic lists its live topics in displayed order, header stays present', async () => {
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(EPICS, TOPICS);
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();

  const { document } = dom.window;
  assert.ok(document.querySelector('header h1'), 'expected the pane header to be present before drilling in');
  document.querySelectorAll('.drill')[0].onclick(); // EA tile
  await flush();

  const rowIds = Array.prototype.map.call(document.querySelectorAll('#content .row'), (row) => row.getAttribute('data-id'));
  assert.deepEqual(rowIds, ['A1', 'A2', 'A3']);
  assert.ok(document.querySelector('header h1'), 'expected the pane header to remain present on the drill-down screen');
});

test('BL-674-02: a topic row with a live dependency carries a marker, others do not', async () => {
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(EPICS, TOPICS);
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();
  const { document } = dom.window;
  document.querySelectorAll('.drill')[0].onclick();
  await flush();

  const a3Row = document.querySelector('.row[data-id="A3"]');
  const a2Row = document.querySelector('.row[data-id="A2"]');
  assert.ok(a3Row.querySelector('.dep-marker'), 'expected A3 to show a dependency marker');
  assert.ok(!a2Row.querySelector('.dep-marker'), 'expected A2 to show no dependency marker');
});

test('BL-674-03: tapping make-top on a topic calls the topic route and re-renders with the new order', async () => {
  let currentTopics = TOPICS;
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(EPICS, currentTopics);
    }
    if (url.startsWith('/epic-reorder/topic-make-top')) {
      currentTopics = [
        { id: 'A3', title: 'Topic A3', priority: 0, epicIds: ['EA'], hasLiveDependency: true },
        { id: 'A1', title: 'Topic A1', priority: 1, epicIds: ['EA'], hasLiveDependency: false },
        { id: 'A2', title: 'Topic A2', priority: 4, epicIds: ['EA'], hasLiveDependency: false },
        { id: 'B1', title: 'Topic B1', priority: 2, epicIds: ['EB'], hasLiveDependency: false },
      ];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, changed: true }) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();
  const { document } = dom.window;
  document.querySelectorAll('.drill')[0].onclick();
  await flush();

  document.querySelector('.topic-make-top[data-id="A3"]').onclick();
  await flush();

  const call = dom.fetchCalls.find((c) => c.url.startsWith('/epic-reorder/topic-make-top'));
  assert.ok(call, 'expected the topic-make-top route to be called');
  assert.deepEqual(JSON.parse(call.opts.body), { epicId: 'EA', topicId: 'A3' });

  const rowIds = Array.prototype.map.call(document.querySelectorAll('#content .row'), (row) => row.getAttribute('data-id'));
  assert.deepEqual(rowIds, ['A3', 'A1', 'A2'], 'expected the drill-down to re-render with A3 first');
});

test('BL-674-04: a changed:false response renders its reason verbatim and leaves the order unchanged', async () => {
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(EPICS, TOPICS);
    }
    if (url.startsWith('/epic-reorder/topic-make-top')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, changed: false, reason: 'blocked by B2' }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();
  const { document } = dom.window;
  document.querySelectorAll('.drill')[0].onclick();
  await flush();

  document.querySelector('.topic-make-top[data-id="A3"]').onclick();
  await flush();

  assert.equal(document.getElementById('move-status').textContent, 'blocked by B2');
  const rowIds = Array.prototype.map.call(document.querySelectorAll('#content .row'), (row) => row.getAttribute('data-id'));
  assert.deepEqual(rowIds, ['A1', 'A2', 'A3'], 'expected the listed order to be unchanged');
});

test('BL-674-05: back navigation returns to the epic tiles', async () => {
  const dom = renderScreen((url) => {
    if (url.startsWith('/epic-reorder-state')) {
      return stateResponse(EPICS, TOPICS);
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();
  const { document } = dom.window;
  document.querySelectorAll('.drill')[0].onclick();
  await flush();
  assert.ok(document.getElementById('back-to-tiles'), 'expected to be on the drill-down screen');

  document.getElementById('back-to-tiles').onclick();
  await flush();

  const tileIds = Array.prototype.map.call(document.querySelectorAll('#content .row'), (row) => row.getAttribute('data-id'));
  assert.deepEqual(tileIds, ['EA', 'EB'], 'expected the epic tiles screen to be displayed again');
});
