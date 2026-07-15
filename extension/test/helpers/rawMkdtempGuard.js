'use strict';

// BL-420: the load-bearing "the migration is COMPLETE" check (scenario 03) -
// scans extension/test/ for the raw call this ticket bans everywhere except
// the shared helper itself, so a NEW test cannot silently reintroduce an
// un-cleaned /tmp leak.
const fs = require('fs');
const path = require('path');

const RAW_MKDTEMP_PATTERN = /mkdtempSync\(\s*path\.join\(\s*os\.tmpdir\(\)/;

// Pure: given one file's own text, the 1-indexed line numbers containing a
// raw call. Unit-testable directly against a fixture string - no filesystem
// needed for THIS function's own tests.
function findRawMkdtempLines(text) {
  return text
    .split('\n')
    .map((line, i) => (RAW_MKDTEMP_PATTERN.test(line) ? i + 1 : null))
    .filter((n) => n !== null);
}

// Paths (relative to testDir) that legitimately contain the raw pattern's
// literal TEXT and must never be flagged: tmpDir.js's own real call site,
// and this guard's own test file, whose fixture STRINGS deliberately
// contain the pattern as test DATA (not executable code) to prove the
// scanner detects it - a scan that flagged its own fixtures would make the
// migration-complete gate (scenario 03) permanently unsatisfiable.
const SELF_EXEMPT_RELATIVE_PATHS = ['helpers/tmpDir.js', 'tmpDirMigrationGuard.test.js'];

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

module.exports = { findRawMkdtempLines, findRawMkdtempCallSites, RAW_MKDTEMP_PATTERN };
