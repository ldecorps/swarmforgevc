'use strict';

// BL-1634: step handlers for "BL-1634 A rejected manifest offers no page
// from it while the built-in pages are still offered". Drives the REAL
// bridge server (out/bridge/bridgeServer.js) against the served UI bundle
// manifest route, same shape bl829BubbleRemotePagePagerSteps.js's own
// scenarios 1-2 use for this exact route - a scoped copy per BL-1277's
// unscoped-collision guard, never an unscoped duplicate.

const fs = require('node:fs');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const {
  operatorDocs,
  bubbleHealth,
  bubblePipelinePage,
  bubbleHostPage,
  bubbleLivePage,
} = require(path.join(EXT_DIR, 'out', 'bridge', 'letsTalkRoutes'));

const FEATURE_NAME = 'BL-1634 A rejected manifest offers no page from it while the built-in pages are still offered';
const TOKEN = 'aps-bl1634-token';

// BL-1634: read the built-in registry from the real module (never a hand
// list) - every page bridgeServer.ts's manifest route merges in regardless
// of the operator manifest's state.
const BUILT_IN_PAGES = [operatorDocs, bubbleHealth, bubblePipelinePage, bubbleHostPage, bubbleLivePage];

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
  ctx.manifestBody = await response.json();
  ctx.bridge.stop();
}

// required_wiring anchor: registerSteps
function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^a running swarm and the bridge started via its opt-in command for BL-1634$/, (ctx) => {
    // targetPath is set by the shared Given step elsewhere in this suite
    // for the plain "a running swarm..." wording; this feature's own
    // Background carries a distinct sentence (BL-1277 scoping), so it
    // must establish targetPath itself.
    if (!ctx.targetPath) {
      const os = require('node:os');
      ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1634-'));
      ctx.cleanupBl1634Root = () => fs.rmSync(ctx.targetPath, { recursive: true, force: true });
    }
  });

  scoped(/^the served manifest carries a malformed page list whose entry id is not a built-in page$/, (ctx) => {
    ctx.malformedId = 'non-built-in-malformed-page';
    writeManifest(ctx.targetPath, {
      schemaVersion: 1,
      bundleVersion: 3,
      minShellVersion: 0,
      payload: '<html></html>',
      // missing `title` and `order` on the one page entry.
      pages: [{ id: ctx.malformedId, entryPath: ctx.malformedId }],
    });
  });

  scoped(/^the served manifest carries a malformed page list whose entry id equals a built-in page's id$/, (ctx) => {
    ctx.malformedId = bubbleLivePage.id;
    writeManifest(ctx.targetPath, {
      schemaVersion: 1,
      bundleVersion: 3,
      minShellVersion: 0,
      payload: '<html></html>',
      // missing `title` and `order`, and a `entryPath` that is NOT the
      // built-in's own - proves a resolved page with this id is the
      // built-in's entry, not smuggled from the malformed manifest.
      pages: [{ id: ctx.malformedId, entryPath: 'smuggled-entry-path' }],
    });
  });

  scoped(/^the manifest is validated$/, async (ctx) => {
    await fetchManifest(ctx);
  });

  scoped(/^it is rejected whole$/, (ctx) => {
    if (ctx.manifestBody.payload !== '') {
      throw new Error(`expected the whole manifest rejected (default payload), got: ${JSON.stringify(ctx.manifestBody)}`);
    }
  });

  scoped(/^no offered page carries the malformed entry's id$/, (ctx) => {
    // Scenario 01 only: the malformed entry's id is not a built-in id, so
    // (unlike scenario 02's id-collision case) it must not appear among
    // the offered pages at all.
    const offeredIds = Array.isArray(ctx.manifestBody.pages) ? ctx.manifestBody.pages.map((page) => page.id) : [];
    if (offeredIds.includes(ctx.malformedId)) {
      throw new Error(`expected no page carrying the malformed entry's id ${ctx.malformedId}, got: ${JSON.stringify(ctx.manifestBody.pages)}`);
    }
  });

  scoped(/^every built-in page is still offered$/, (ctx) => {
    try {
      const offeredIds = new Set((ctx.manifestBody.pages || []).map((page) => page.id));
      for (const builtIn of BUILT_IN_PAGES) {
        if (!offeredIds.has(builtIn.id)) {
          throw new Error(`expected built-in page ${builtIn.id} to be offered, got: ${JSON.stringify(ctx.manifestBody.pages)}`);
        }
      }
    } finally {
      if (ctx.cleanupBl1634Root) {
        ctx.cleanupBl1634Root();
        ctx.cleanupBl1634Root = undefined;
      }
    }
  });

  scoped(/^the offered page with that id is the bridge's built-in entry, not the manifest's$/, (ctx) => {
    try {
      const builtIn = BUILT_IN_PAGES.find((page) => page.id === ctx.malformedId);
      if (!builtIn) {
        throw new Error(`test setup error: ${ctx.malformedId} is not a known built-in id`);
      }
      const offered = (ctx.manifestBody.pages || []).find((page) => page.id === ctx.malformedId);
      if (!offered) {
        throw new Error(`expected a page with id ${ctx.malformedId} to be offered, got: ${JSON.stringify(ctx.manifestBody.pages)}`);
      }
      if (offered.entryPath !== builtIn.entryPath || offered.title !== builtIn.title) {
        throw new Error(`expected the built-in entry for ${ctx.malformedId} (${JSON.stringify(builtIn)}), got: ${JSON.stringify(offered)}`);
      }
    } finally {
      if (ctx.cleanupBl1634Root) {
        ctx.cleanupBl1634Root();
        ctx.cleanupBl1634Root = undefined;
      }
    }
  });
}

module.exports = { registerSteps };
