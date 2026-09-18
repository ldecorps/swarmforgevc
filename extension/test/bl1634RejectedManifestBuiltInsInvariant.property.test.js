const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { getLetsTalkUiBundleManifest } = require('../out/bridge/letsTalkUiBundle');
const {
  operatorDocs,
  bubbleHealth,
  bubbleHostPage,
  bubbleLivePage,
  mergeOperatorDocsIntoUiBundleManifest,
  mergeBubbleHealthIntoUiBundleManifest,
  mergeBubbleHostIntoUiBundleManifest,
  mergeBubbleLiveIntoUiBundleManifest,
} = require('../out/bridge/letsTalkRoutes');

// BL-1634's declared invariant: "A page id from a rejected operator
// manifest never appears among the pages offered to the shell, and the
// bridge's built-in pages are offered regardless of the operator
// manifest's state." BL-1634's own acceptance scenarios pin this at two
// fixed examples (a non-colliding malformed id, and one colliding with a
// built-in's id); this generalizes over an arbitrary malformed page id and
// an arbitrary choice of which required field is missing, driving the REAL
// bridge functions (getLetsTalkUiBundleManifest + the exact merge chain
// bridgeServer.ts applies) rather than reimplementing their logic.
//
// BL-1584/BL-1589: the two cells (colliding / non-colliding) are reached by
// CONSTRUCTION (i % CELLS.length), never sampled and hoped for - a random
// string colliding with one of the 4 real built-in ids by pure luck is
// astronomically unlikely, so leaving it to fc.oneof's random choice would
// make the floor a coin flip rather than a guarantee.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const BUILT_IN_PAGES = [operatorDocs, bubbleHealth, bubbleHostPage, bubbleLivePage];
const BUILT_IN_IDS = BUILT_IN_PAGES.map((p) => p.id);
const MISSING_FIELDS = ['title', 'entryPath', 'order'];
const CELLS = ['colliding', 'nonColliding'];
const DRAWS = 40;
const CELL_FLOOR = runsPerCell(DRAWS, CELLS.length);

const rng = (() => {
  let state = Date.now() % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
})();
const randInt = (n) => Math.floor(rng() * n);
const randWord = () => {
  let w = '';
  for (let i = 0, n = 4 + randInt(6); i < n; i += 1) w += String.fromCharCode(97 + randInt(26));
  return w;
};

function mkOperatorDir() {
  const root = mkTmpDir('sfvc-bl1634-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function manifestPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'lets-talk-ui-bundle.json');
}

// The bridge's own merge chain, exactly as bridgeServer.ts's
// /lets-talk/ui-bundle.json route builds it.
function applyBuiltInMergeChain(manifest) {
  return mergeBubbleLiveIntoUiBundleManifest(
    mergeBubbleHostIntoUiBundleManifest(mergeBubbleHealthIntoUiBundleManifest(mergeOperatorDocsIntoUiBundleManifest(manifest)))
  );
}

// A malformed page entry, missing exactly one of its required fields -
// same "still malformed" shape BL-829's and BL-1634's own fixtures use.
function buildMalformedPage(id, missingField) {
  const page = { id, title: 'x', entryPath: 'x', order: 0 };
  delete page[missingField];
  return page;
}

test('property (BL-1634): a malformed operator page id never leaks into the offered list, and every built-in is offered regardless', () => {
  const cellCoverage = {};
  for (let i = 0; i < DRAWS; i += 1) {
    const cell = CELLS[i % CELLS.length];
    cellCoverage[cell] = (cellCoverage[cell] || 0) + 1;
    const missingField = MISSING_FIELDS[i % MISSING_FIELDS.length];
    const id = cell === 'colliding' ? BUILT_IN_IDS[i % BUILT_IN_IDS.length] : `nonbuiltin-${randWord()}-${i}`;
    assert.ok(cell === 'colliding' ? BUILT_IN_IDS.includes(id) : !BUILT_IN_IDS.includes(id), `generator error: cell "${cell}" drew an id that does not match it: ${id}`);
    const malformedPage = buildMalformedPage(id, missingField);

    const root = mkOperatorDir();
    try {
      fs.writeFileSync(
        manifestPath(root),
        JSON.stringify({
          schemaVersion: 1,
          bundleVersion: 3,
          minShellVersion: 0,
          payload: '<html></html>',
          pages: [malformedPage],
        })
      );
      const resolved = getLetsTalkUiBundleManifest(root, {});
      // Whole-or-nothing rejection: the malformed page never survives the
      // parse at all (extension/test/letsTalkUiBundlePagesWholeOrNothing.property.test.js
      // covers this half directly) - asserted here as the precondition
      // this test's own invariant depends on, not re-proven.
      assert.equal(resolved.pages.length, 0, `expected the malformed manifest's pages rejected to empty, got: ${JSON.stringify(resolved.pages)}`);

      const merged = applyBuiltInMergeChain(resolved);
      const offeredIds = merged.pages.map((p) => p.id);

      // Invariant, first half: the malformed id never appears - UNLESS it
      // happens to collide with a built-in id, in which case the OFFERED
      // entry must be exactly the built-in, never the malformed one (which
      // the whole-or-nothing rejection already discarded, so this is really
      // "the built-in fills the slot", not "the manifest smuggled itself in").
      if (cell === 'colliding') {
        const offered = merged.pages.find((p) => p.id === id);
        const builtin = BUILT_IN_PAGES.find((p) => p.id === id);
        assert.deepEqual(offered, builtin, `expected the colliding id's offered entry to be exactly the built-in, got: ${JSON.stringify(offered)}`);
      } else {
        assert.ok(!offeredIds.includes(id), `expected the non-colliding malformed id absent, got: ${JSON.stringify(offeredIds)}`);
      }

      // Invariant, second half: every built-in is offered regardless.
      for (const builtinId of BUILT_IN_IDS) {
        assert.ok(offeredIds.includes(builtinId), `expected built-in id "${builtinId}" offered, got: ${JSON.stringify(offeredIds)}`);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  assertReachFloor(cellCoverage, CELLS, CELL_FLOOR, 'bl1634 cell');
});
