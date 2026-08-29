'use strict';

// BL-420: the load-bearing "the migration is COMPLETE" check (scenario 03) -
// scans extension/test/ for the raw call this ticket bans everywhere except
// the shared helper itself, so a NEW test cannot silently reintroduce an
// un-cleaned /tmp leak.
const fs = require('fs');
const path = require('path');

// BL-1209: the pure detector moved to src/tools/rawMkdtempDetector.ts, where
// the tool's own logic lives, because the pilot check used to require THIS
// file out of whatever root it was handed - so it could only ever run against
// this repository. Re-exported here rather than duplicated: two copies of a
// pattern across a boundary no import bridges is precisely the drift trap the
// engineering rules call out, and every existing consumer of this helper keeps
// the same names.
const { RAW_MKDTEMP_PATTERN, findRawMkdtempLines } = require('../../out/tools/rawMkdtempDetector');

// Paths (relative to testDir) that legitimately contain the raw pattern's
// literal TEXT and must never be flagged: tmpDir.js's own real call site,
// and any guard test file whose fixture STRINGS deliberately contain the
// pattern as test DATA (not executable code) to prove a detector actually
// detects it - a scan that flagged its own fixtures would make the
// migration-complete gate (scenario 03) permanently unsatisfiable.
//
// BL-1209: pilotMkdtempConventionCheck.test.js and its property sibling
// carry the same shape - RAW_CALL_FILE/RAW_LINE fixture strings proving
// assessPilotMkdtempConvention flags a raw call - and were omitted here
// when that ticket added them, so the real-tree scan (scenario 03) flagged
// its own sibling guard's fixtures as violations.
const SELF_EXEMPT_RELATIVE_PATHS = [
  'helpers/tmpDir.js',
  'tmpDirMigrationGuard.test.js',
  'tmpDirMigrationGuard.property.test.js',
  'pilotMkdtempConventionCheck.test.js',
  'pilotMkdtempConventionCheck.property.test.js',
];

// Impure: walks every .js file under testDir (recursively), skipping the
// paths above and anything under a directory named "fixtures" - pinned
// task fixtures vitest.config.mjs itself already excludes from collection
// (BL-340), not this suite's own tests.
function findRawMkdtempCallSites(testDir) {
  const violations = [];
  const exemptFiles = new Set(SELF_EXEMPT_RELATIVE_PATHS.map((p) => path.join(testDir, p)));

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'fixtures') {
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js') || exemptFiles.has(full)) {
        continue;
      }
      const text = fs.readFileSync(full, 'utf8');
      for (const line of findRawMkdtempLines(text)) {
        violations.push({ file: full, line });
      }
    }
  }

  walk(testDir);
  return violations;
}

module.exports = { findRawMkdtempLines, findRawMkdtempCallSites, RAW_MKDTEMP_PATTERN, SELF_EXEMPT_RELATIVE_PATHS };
