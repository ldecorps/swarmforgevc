'use strict';

// BL-1634: step handlers for "BL-1634 A rejected manifest offers no page
// from it while the built-in pages are still offered"
// (specs/features/BL-1634-a-rejected-manifest-offers-no-page-from-it-built-ins-still-offered.feature).
//
// Drives the REAL bridge server exactly as bl829BubbleRemotePagePagerSteps.js
// does (its own scoped Background text - "...for BL-1634" - so this file
// registers its own copy rather than colliding with the shared, unscoped
// "a running swarm and the bridge started via its opt-in command" text;
// BL-1277's collision guard forbids an unscoped duplicate of THAT text, and
// this feature's own Background line is deliberately different from it).
//
// Built-in page ids/shapes are read from letsTalkRoutes.ts's own exported
// registry at run time - never a hand-typed list of id strings - so this
// feature and its fixture cannot silently drift from whatever the bridge
// actually merges in (BL-775 added `live` to that exact registry).

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { operatorDocs, bubbleHealth, bubbleHostPage, bubbleLivePage } = require(
  path.join(EXT_DIR, 'out', 'bridge', 'letsTalkRoutes')
);
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE_NAME = 'BL-1634 A rejected manifest offers no page from it while the built-in pages are still offered';
const TOKEN = 'aps-bl1634-manifest-token';

// The bridge's own built-in registry (bridgeServer.ts's merge chain) - read
// here, not hand-copied, so a fifth built-in added later is picked up by
// this feature automatically.
const BUILT_IN_PAGES = [operatorDocs, bubbleHealth, bubbleHostPage, bubbleLivePage];
const BUILT_IN_IDS = BUILT_IN_PAGES.map((p) => p.id);

function operatorDir(targetPath) {
  return path.join(targetPath, '.swarmforge', 'operator');
}

function writeManifest(targetPath, manifest) {
  const dir = operatorDir(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lets-talk-ui-bundle.json'), JSON.stringify(manifest));
}

async function fetchManifest(ctx) {
  ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, {});
  const response = await fetch(`http://127.0.0.1:${ctx.bridge.port}/lets-talk/ui-bundle.json`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  ctx.manifestResponse = response;
  ctx.manifestBody = await response.json();
  ctx.bridge.stop();
}

function writeMalformedManifest(targetPath, id) {
  // Missing `title` and `order` on the one page entry - still malformed,
  // same shape BL-829's own fixture uses.
  writeManifest(targetPath, {
    schemaVersion: 1,
    bundleVersion: 3,
    minShellVersion: 0,
    payload: '<html></html>',
    pages: [{ id, entryPath: id }],
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^a running swarm and the bridge started via its opt-in command for BL-1634$/, (ctx) => {
    ctx.targetPath = mkSocketFixtureRoot('bl1634-acceptance-');
  });

  scoped(/^the served manifest carries a malformed page list whose entry id is not a built-in page$/, (ctx) => {
    const id = 'malformed-operator-page';
    assert.ok(!BUILT_IN_IDS.includes(id), `fixture id "${id}" must not collide with a built-in id: ${JSON.stringify(BUILT_IN_IDS)}`);
    writeMalformedManifest(ctx.targetPath, id);
    ctx.malformedManifestPageIds = [id];
  });

  scoped(/^the served manifest carries a malformed page list whose entry id equals a built-in page's id$/, (ctx) => {
    const collidingPage = BUILT_IN_PAGES[0];
    writeMalformedManifest(ctx.targetPath, collidingPage.id);
    ctx.malformedManifestPageIds = [collidingPage.id];
    ctx.collidingBuiltinPage = collidingPage;
  });

  scoped(/^the manifest is validated$/, async (ctx) => {
    await fetchManifest(ctx);
  });

  scoped(/^it is rejected whole$/, (ctx) => {
    assert.equal(ctx.manifestBody.payload, '', `expected the whole manifest rejected (default payload), got: ${JSON.stringify(ctx.manifestBody)}`);
  });

  scoped(/^no offered page carries the malformed entry's id$/, (ctx) => {
    const offeredIds = ctx.manifestBody.pages.map((p) => p.id);
    for (const id of ctx.malformedManifestPageIds) {
      assert.ok(!offeredIds.includes(id), `expected id "${id}" absent from offered pages, got: ${JSON.stringify(offeredIds)}`);
    }
  });

  scoped(/^every built-in page is still offered$/, (ctx) => {
    const offeredIds = ctx.manifestBody.pages.map((p) => p.id);
    for (const id of BUILT_IN_IDS) {
      assert.ok(offeredIds.includes(id), `expected built-in id "${id}" among offered pages, got: ${JSON.stringify(offeredIds)}`);
    }
  });

  scoped(/^the offered page with that id is the bridge's built-in entry, not the manifest's$/, (ctx) => {
    const offered = ctx.manifestBody.pages.find((p) => p.id === ctx.collidingBuiltinPage.id);
    assert.ok(offered, `expected an offered page with id "${ctx.collidingBuiltinPage.id}", got: ${JSON.stringify(ctx.manifestBody.pages)}`);
    assert.deepEqual(
      offered,
      ctx.collidingBuiltinPage,
      `expected the offered entry to be exactly the bridge's built-in (${JSON.stringify(ctx.collidingBuiltinPage)}), got: ${JSON.stringify(offered)}`
    );
  });
}

module.exports = { registerSteps };
