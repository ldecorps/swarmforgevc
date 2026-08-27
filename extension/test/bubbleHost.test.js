'use strict';

const assert = require('node:assert/strict');
const {
  deriveHostPageViewState,
  formatHostUnreachableMessage,
  renderHostActivityLines,
  simulateHostPageRender,
} = require('../out/bridge/bubbleHostCore');
const { bubbleHostPage, mergeBubbleHostIntoUiBundleManifest } = require('../out/bridge/letsTalkRoutes');
const { getBubbleHostUiHtml, isBubbleHostPath } = require('../out/bridge/bubbleHostUiHtml');

test('bubbleHostPage is registered with Host title and entry path', () => {
  assert.equal(bubbleHostPage.id, 'host');
  assert.equal(bubbleHostPage.title, 'Host');
  assert.equal(bubbleHostPage.entryPath, 'host');
});

test('mergeBubbleHostIntoUiBundleManifest adds the Host page once', () => {
  const manifest = {
    schemaVersion: 1,
    bundleVersion: 1,
    minShellVersion: 0,
    payload: 'x',
    pages: [{ id: 'live', title: 'Live', entryPath: 'live', order: 1 }],
  };
  const merged = mergeBubbleHostIntoUiBundleManifest(manifest);
  assert.equal(merged.pages.filter((page) => page.id === 'host').length, 1);
  assert.deepEqual(mergeBubbleHostIntoUiBundleManifest(merged), merged);
});

test('simulateHostPageRender maps feed states to honest view states', () => {
  assert.deepEqual(simulateHostPageRender({ status: 'quiet' }), {
    viewState: 'quiet',
    lines: [],
    statusMessage: 'Host is quiet — no host agent session is running.',
  });
  assert.equal(
    simulateHostPageRender({ status: 'active', sessionId: 's', lines: ['a'] }).viewState,
    'working'
  );
  assert.match(
    simulateHostPageRender({ status: 'quiet' }, 'offline').unreachableReason,
    /could not read the host activity feed/i
  );
});

test('deriveHostPageViewState prefers unreachable over quiet', () => {
  assert.equal(deriveHostPageViewState({ status: 'quiet' }, 'offline'), 'unreachable');
});

test('renderHostActivityLines escapes markup and tags feed lines', () => {
  const html = renderHostActivityLines(['<tool>&']);
  assert.match(html, /data-feed-line="1"/);
  assert.match(html, /&lt;tool&gt;&amp;/);
});

test('isBubbleHostPath matches /host only', () => {
  assert.equal(isBubbleHostPath('/host'), true);
  assert.equal(isBubbleHostPath('/host?bearer=x'), true);
  assert.equal(isBubbleHostPath('/host-activity'), false);
});

test('getBubbleHostUiHtml serves Host agent heading and live push hook', () => {
  const html = getBubbleHostUiHtml();
  assert.match(html, /Host agent/);
  assert.match(html, /attachHostActivityStream/);
  assert.match(html, /\/host-activity/);
});

test('formatHostUnreachableMessage expands bare HTTP codes', () => {
  const message = formatHostUnreachableMessage('HTTP 401');
  assert.match(message, /bridge returned HTTP 401/i);
  assert.match(message, /reachability/i);
});
