'use strict';

// BL-1761 declared invariant (property authorship rests with the coder,
// BL-654): "A repo-root-relative test path and its absolute equivalent
// resolve to the same file, in the real checkout and inside a Stryker
// sandbox." Drives the REAL resolveConfirmedFile export
// (extension/scripts/recordTestDuration.js) against REAL on-disk fixtures
// shaped both ways - never a fabricated filesystem.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { resolveConfirmedFile } = require('../scripts/recordTestDuration.js');
const { mkTmpDir } = require('./helpers/tmpDir');

// Generator reach: crosses BOTH topologies confirmPoleAlone must handle -
// 'real' (rootDir's own basename is "extension", so repoRootDir/extension
// happens to equal rootDir) and 'sandbox' (rootDir stands in for the
// extension root under an arbitrary name, per the BL-1066 rule - its
// parent has no "extension" child at all). A property drawn only from
// 'real' cases would pass the pre-fix code too, which is exactly how the
// bug shipped unnoticed until a real Stryker sandbox hit it (BL-1742) -
// 'sandbox' is the shape the invariant is actually about.
const shapeArb = fc.constantFrom('real', 'sandbox');
const nameArb = fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/);

function buildFixture(shape, name) {
  const repoRootDir = mkTmpDir('bl1761-prop-');
  const rootDir = path.join(repoRootDir, shape === 'real' ? 'extension' : 'sandbox-root');
  fs.mkdirSync(path.join(rootDir, 'test'), { recursive: true });
  const fileName = `${name}.test.js`;
  fs.writeFileSync(path.join(rootDir, 'test', fileName), 'test("x", () => {});\n');
  return { repoRootDir, rootDir, fileName };
}

test('property: a repo-relative path and its absolute equivalent resolve to the same real file, in a real checkout and inside a Stryker sandbox', () => {
  const seenShapes = new Set();
  fc.assert(
    fc.property(shapeArb, nameArb, (shape, name) => {
      seenShapes.add(shape);
      const { repoRootDir, rootDir, fileName } = buildFixture(shape, name);
      try {
        const relFile = `extension/test/${fileName}`;
        const absFile = path.join(rootDir, 'test', fileName);
        const viaRel = resolveConfirmedFile(relFile, rootDir, repoRootDir);
        const viaAbs = resolveConfirmedFile(absFile, rootDir, repoRootDir);
        assert.equal(viaRel, absFile, `shape=${shape}: relative form resolved to ${viaRel}, expected the real file ${absFile}`);
        assert.equal(viaAbs, absFile, `shape=${shape}: an absolute path must pass through unchanged`);
        assert.ok(fs.existsSync(viaRel), `shape=${shape}: resolved path ${viaRel} does not exist on disk`);
      } finally {
        fs.rmSync(repoRootDir, { recursive: true, force: true });
      }
    }),
    { numRuns: 20 }
  );
  const undrawn = ['real', 'sandbox'].filter((s) => !seenShapes.has(s));
  assert.deepEqual(undrawn, [], `expected both shapes to be exercised, never omitted: ${JSON.stringify(undrawn)}`);
});

// Non-vacuity: reverting resolveConfirmedFile to always resolve a relative
// path against repoRootDir (the pre-fix behaviour, dropping the
// "extension/"-prefix carve-out) failed immediately on a 'sandbox'-shaped
// case - the relative form resolved to
// "<repoRootDir>/extension/test/<name>.test.js", a path that does not
// exist (the sandbox fixture's parent has no extension/ child) - while
// 'real'-shaped cases kept passing throughout, exactly matching how the
// bug shipped unnoticed until it hit an actual Stryker sandbox.
