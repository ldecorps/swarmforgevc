'use strict';

// BL-1623: a property test file whose module-load sweep lists the whole
// shared temp dir (`fs.readdirSync(os.tmpdir())`) and removes every entry
// sharing its prefix, whoever made it, destroys a live peer's fixtures the
// instant two instances of that file are ever alive at once on the host
// (BL-1385/BL-1390's shape) - the seven files this ticket migrates to the
// scoped, pid-aware sweepStaleTmpDirs helper (tmpDir.js) all had exactly
// this shape. This guard reads the real tree so the class stops re-minting
// one file at a time: any *.property.test.js under this directory that
// still lists the temp dir directly is named, not silently re-introduced.
// Discovered by vitest's `extension/test/*.test.js` glob - `npm test` runs
// it with no call site.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkSharedTmpDir } = require('./helpers/tmpDir');
const { findBlindTmpDirSweeps } = require('./helpers/blindTmpDirSweepFinder');

const TEST_DIR = __dirname;

// The census this ticket's own description names - kept here as the
// pin scenario 03 (BL-1445) checks against, not derived, so a file quietly
// dropped from the migration is itself visible as a census-count mismatch.
//
// BL-1677 (2026-09-21) added the four files whose blind sweep aliased
// os.tmpdir() into a local variable before calling readdirSync on it -
// invisible to this guard's original literal-only pattern until the
// finder gained the aliased-form check. bl1239 was not in BL-1677's
// original three-file scope; it shares the identical shape (found by the
// same generalized detection) and is folded in here rather than minting a
// separate ticket for it (spec-gap note to the specifier, 2026-09-21).
const MIGRATED_FILES = [
  'bl1030RefusalCostsNothing.property.test.js',
  'bl1239SuiteManifestAccountsForEveryTestFile.property.test.js',
  'bl1300SingleEnforceableBudget.property.test.js',
  'bl1309LandDecideEntanglementInvariants.property.test.js',
  'bl1343ReplayNeverDropsOwnPathInvariants.property.test.js',
  'bl1354SharedPathLandedSiblingInvariants.property.test.js',
  'bl1356StampOffInvariants.property.test.js',
  'bl1358MutantTimeCeilingInvariants.property.test.js',
  'bl1359MergeChargedInvariants.property.test.js',
  'bl1380ExpediteNeverAnswersUnshownQuestion.property.test.js',
  'bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js',
];

describe('BL-1623 blind temp-dir sweep guard', () => {
  it('names exactly the fixture files that list the temp dir directly (literal or aliased), never the one that uses the helper', () => {
    const dir = mkSharedTmpDir('bl1623-guard-fixture-');
    fs.writeFileSync(
      path.join(dir, 'blindOne.property.test.js'),
      "for (const e of fs.readdirSync(os.tmpdir())) { /* blind */ }\n"
    );
    fs.writeFileSync(
      path.join(dir, 'blindAliased.property.test.js'),
      "const parent = os.tmpdir();\nfor (const e of fs.readdirSync(parent)) { /* blind */ }\n"
    );
    fs.writeFileSync(
      path.join(dir, 'cleanOne.property.test.js'),
      "sweepStaleTmpDirs({ prefix: 'x-' });\n"
    );
    fs.writeFileSync(path.join(dir, 'notAPropertyFile.test.js'), "fs.readdirSync(os.tmpdir())\n");

    assert.deepEqual(findBlindTmpDirSweeps(dir), ['blindAliased.property.test.js', 'blindOne.property.test.js']);
  });

  it('the real tree names none, and the migrated census is exactly eleven files', () => {
    const offenders = findBlindTmpDirSweeps(TEST_DIR);
    assert.deepEqual(offenders, [], `blind temp-dir sweep(s) found: ${offenders.join(', ')}`);

    const present = MIGRATED_FILES.filter((name) => fs.existsSync(path.join(TEST_DIR, name)));
    console.log(`BL-1623 census: ${present.length} migrated file(s), ${offenders.length} still-blind file(s)`);
    assert.equal(
      present.length,
      MIGRATED_FILES.length,
      `expected every migrated file to exist, missing: ${MIGRATED_FILES.filter((n) => !present.includes(n)).join(', ')}`
    );
  });
});
