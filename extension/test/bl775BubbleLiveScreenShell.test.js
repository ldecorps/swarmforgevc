// BL-775: unit coverage for the Bubble Live page's own module (path
// predicate, one-renderer-by-construction) and its UI bundle manifest
// registration, at the level the bridgeServer.test.js HTTP tests don't
// reach (idempotent merge, order sorting).
const assert = require('node:assert/strict');
const { getBubbleLiveUiHtml, isBubbleLivePath } = require('../out/bridge/bubbleLiveUiHtml');
const { getResidentSpyUiHtml, renderLiveScreenBody } = require('../out/bridge/residentSpyUiHtml');
const { bubbleLivePage, mergeBubbleLiveIntoUiBundleManifest } = require('../out/bridge/letsTalkRoutes');

test('isBubbleLivePath matches /live and /live?..., rejects other bundle paths', () => {
  assert.equal(isBubbleLivePath('/live'), true);
  assert.equal(isBubbleLivePath('/live?token=abc'), true);
  assert.equal(isBubbleLivePath('/resident-spy'), false);
  assert.equal(isBubbleLivePath('/host'), false);
  assert.equal(isBubbleLivePath('/health'), false);
  assert.equal(isBubbleLivePath('/live-something-else'), false);
});

// BL-775 invariant 1 / required_wiring: getBubbleLiveUiHtml is a thin call
// onto the SAME shared renderer the Mini App shell uses — never a second
// copy of the markup to drift from it.
test('getBubbleLiveUiHtml is byte-identical to getResidentSpyUiHtml, both backed by renderLiveScreenBody', () => {
  assert.equal(getBubbleLiveUiHtml(), getResidentSpyUiHtml());
  assert.equal(getBubbleLiveUiHtml(), renderLiveScreenBody());
});

test('mergeBubbleLiveIntoUiBundleManifest adds the live page once, sorted by order', () => {
  const empty = { schemaVersion: 1, bundleVersion: 0, minShellVersion: 0, payload: 'x', pages: [] };
  const once = mergeBubbleLiveIntoUiBundleManifest(empty);
  assert.equal(once.pages.length, 1);
  assert.deepEqual(once.pages[0], bubbleLivePage);

  const twice = mergeBubbleLiveIntoUiBundleManifest(once);
  assert.equal(twice.pages.length, 1, 'merging twice must not duplicate the page');
});

test('mergeBubbleLiveIntoUiBundleManifest sorts the live page into an existing page list by order', () => {
  const withOthers = {
    schemaVersion: 1,
    bundleVersion: 0,
    minShellVersion: 0,
    payload: 'x',
    pages: [{ id: 'host', title: 'Host', entryPath: 'host', order: 5 }],
  };
  const merged = mergeBubbleLiveIntoUiBundleManifest(withOthers);
  assert.deepEqual(merged.pages.map((p) => p.id), ['live', 'host']);
});
