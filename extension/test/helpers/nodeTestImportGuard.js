'use strict';

// BL-1220: the unit lane runs under Vitest and nothing in this repository
// runs `node --test`. A file that declares its tests by importing `test` from
// `node:test` therefore declares them to a runner that never executes them:
// Vitest collects nothing from it and reports "No test suite found in file",
// while every role reading the tree counts the file as coverage. Twenty-three
// main-lane files were in that state; this guard stops a new one joining them.
//
// Deliberately lane-scoped (unit lane only). The property lane carries the
// same defect in its own files and is BL-1206's, landing independently.
const fs = require('fs');
const path = require('path');

// Anchored on the IMPORT FORM at the start of a line, never on the bare
// string "node:test". A guard that greps for its own needle flags the file
// that describes it - and this file, its own test, and
// benchmarkNodeTestEvaluator.test.js all carry the literal string as DATA
// inside quoted fixtures, which is not an import and must never be a
// violation.
const NODE_TEST_IMPORT_PATTERNS = [
  /^\s*(?:const|let|var)\s+(?:\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]node:test['"]\s*\)/,
  /^\s*import\s[\s\S]*?\sfrom\s*['"]node:test['"]/,
  /^\s*import\s*['"]node:test['"]/,
];

/**
 * Pure: given one file's own text, the 1-indexed line numbers that import
 * from node:test. Unit-testable against fixture strings, no filesystem.
 */
function findNodeTestImportLines(text) {
  return text
    .split('\n')
    .map((line, i) => (NODE_TEST_IMPORT_PATTERNS.some((re) => re.test(line)) ? i + 1 : null))
    .filter((n) => n !== null);
}

/**
 * Is this path one the unit lane actually collects? Mirrors
 * vitest.config.mjs: *.test.js, excluding *.property.test.js (the property
 * lane's own config) and test/fixtures/** (pinned task fixtures the harness
 * runs through a real `node --test` child process - those SHOULD import
 * node:test, and flagging them would be a false positive on correct code).
 */
function isUnitLaneTestFile(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (!normalized.endsWith('.test.js') || normalized.endsWith('.property.test.js')) {
    return false;
  }
  return !normalized.split('/').includes('fixtures');
}

/**
 * Impure: every unit-lane violation under testDir. There is deliberately no
 * allowlist parameter and no skip path - an allowlist with a "pending fix"
 * rationale is exactly how the property lane's copy of this defect became
 * invisible, and this ticket must not ship that mechanism.
 */
function findUnitLaneNodeTestImports(testDir) {
  const violations = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!isUnitLaneTestFile(path.relative(testDir, full))) {
        continue;
      }
      for (const line of findNodeTestImportLines(fs.readFileSync(full, 'utf8'))) {
        violations.push({ file: full, line });
      }
    }
  };
  walk(testDir);
  return violations;
}

module.exports = { findNodeTestImportLines, isUnitLaneTestFile, findUnitLaneNodeTestImports };
