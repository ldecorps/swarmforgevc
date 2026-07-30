const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { getPausedPagerUiHtml } = require('../out/bridge/pausedPagerUiHtml');

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in getPausedPagerUiHtml() output');
  }
  return match[1];
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function item(id) {
  return {
    id,
    title: id + ' title',
    priority: 4,
    canExpedite: true,
    canApprove: true,
    needsApproval: true,
  };
}

function renderScreen(fetchImpl) {
  const html = getPausedPagerUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/paused/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.confirm = () => true;
  window.fetch = (url, opts) => fetchImpl(url, opts);
  window.eval(extractInlineScript(html));
  return dom;
}

function stateResponse(items) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ items, total: items.length }),
  });
}

test('paused pager: non-OK with reason shows the server reason, not bare HTTP status (BL-662)', async () => {
  const items = [item('BL-404')];
  const dom = renderScreen((url) => {
    if (String(url).startsWith('/paused-pager-state')) {
      return stateResponse(items);
    }
    if (String(url).startsWith('/paused-pager/expedite')) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ success: false, reason: 'ticket not found in active/paused' }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();

  const { document } = dom.window;
  document.getElementById('expedite').onclick();
  await flush();
  await flush();

  const status = document.getElementById('status').textContent;
  assert.equal(status, 'ticket not found in active/paused');
  assert.equal(status.includes('HTTP 404'), false);
});

test('paused pager: non-OK without reason falls back to failText + HTTP status (BL-662)', async () => {
  const items = [item('BL-500')];
  const dom = renderScreen((url) => {
    if (String(url).startsWith('/paused-pager-state')) {
      return stateResponse(items);
    }
    if (String(url).startsWith('/paused-pager/expedite')) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ success: false }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();
  dom.window.document.getElementById('expedite').onclick();
  await flush();
  await flush();
  assert.equal(dom.window.document.getElementById('status').textContent, 'Expedite failed (HTTP 500)');
});

test('paused pager: non-OK unparseable body falls back to failText + HTTP status (BL-662)', async () => {
  const items = [item('BL-502')];
  const dom = renderScreen((url) => {
    if (String(url).startsWith('/paused-pager-state')) {
      return stateResponse(items);
    }
    if (String(url).startsWith('/paused-pager/expedite')) {
      return Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('bad json')),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();
  dom.window.document.getElementById('expedite').onclick();
  await flush();
  await flush();
  assert.equal(dom.window.document.getElementById('status').textContent, 'Expedite failed (HTTP 502)');
});

test('paused pager: approve non-OK with reason shows server reason (BL-662)', async () => {
  const items = [item('BL-403')];
  const dom = renderScreen((url) => {
    if (String(url).startsWith('/paused-pager-state')) {
      return stateResponse(items);
    }
    if (String(url).startsWith('/paused-pager/approve')) {
      return Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ success: false, reason: 'not pending approval' }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
  await flush();
  dom.window.document.getElementById('approve').onclick();
  await flush();
  await flush();
  assert.equal(dom.window.document.getElementById('status').textContent, 'not pending approval');
});
