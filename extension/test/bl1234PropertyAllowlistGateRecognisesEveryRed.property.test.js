'use strict';

// BL-1234 declared invariants (coder first authorship - BL-654):
//
// 1. The verdict depends on WHICH files failed, never on how many - an
//    all-allowlisted set of any size is allowed, and any unlisted member
//    refuses.
// 2. Every path the guard reports is one of the paths it parsed from the
//    suite output - never a synthesized or concatenated string.
//
// Drives the REAL swarmforge/scripts/property_suite_standing_allowlist_lib.sh
// (ps_suite_failures_all_allowlisted) - never a JS reimplementation of the
// bash parsing/allowlist logic - over a generated COUNT of failing files
// (the exact axis the bug lived on: 1 worked, 2+ silently broke) and a
// generated position for a single unlisted file among them.
//
// Runs ONLY via `npm run test:properties`.
//
// Non-vacuity: reverting the fix (dropping the newline
// ps_allowlist_normalize_file's caller now adds) makes this property fail
// on essentially every generated count >= 2 - the concatenated single
// "path" matches no TSV row, so an all-allowlisted set is refused instead
// of allowed.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_standing_allowlist_lib.sh');

function buildTsv(root, files) {
  const tsvPath = path.join(root, 'allowlist.tsv');
  const lines = ['file\tdisposition\trationale', ...files.map((f) => `${f}\tallowlist\tfixture`)];
  fs.writeFileSync(tsvPath, lines.join('\n') + '\n');
  return tsvPath;
}

function fakeFailOutput(files) {
  return files.map((f) => ` FAIL  ${f} > some/failure/detail`).join('\n');
}

// Passed via an environment variable, never interpolated into the bash
// script text - a JS template literal loses real newlines to the literal
// "\n" text under any string-embedding scheme, and this ticket's whole
// domain is newline-sensitive multi-file parsing.
function evaluateGuard(tsvPath, failOutput) {
  const script = `
set -euo pipefail
source ${JSON.stringify(LIB)}
set +e
UNLISTED="$(ps_suite_failures_all_allowlisted ${JSON.stringify(tsvPath)} "$FAKE_FAIL_OUTPUT")"
STATUS=$?
set -e
printf '%s\\n' "$STATUS"
printf '%s' "$UNLISTED"
`;
  const res = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, FAKE_FAIL_OUTPUT: failOutput },
  });
  if (res.status !== 0 && res.stderr) {
    throw new Error(`fixture script failed: ${res.stderr}`);
  }
  const lines = res.stdout.split('\n');
  return { status: Number(lines[0]), unlisted: lines.slice(1).join('\n') };
}

function fixtureRoot() {
  return mkTmpDir('bl1234-prop-');
}

test('BL-1234/BL-654 invariant 1: an all-allowlisted set of ANY generated size is allowed', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 30 }), (count) => {
      const root = fixtureRoot();
      try {
        const files = Array.from({ length: count }, (_, i) => `test/bl1234Gen${i}.property.test.js`);
        const tsvPath = buildTsv(root, files);
        const result = evaluateGuard(tsvPath, fakeFailOutput(files));
        assert.equal(result.status, 0, `expected count=${count} (all allowlisted) to be allowed, got status ${result.status}: ${result.unlisted}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 25 }
  );
});

test('BL-1234/BL-654 invariants 1+2: exactly one unlisted file among N allowlisted ones is always refused, and named alone', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 15 }),
      fc.integer({ min: 0, max: 15 }),
      (before, after) => {
        const root = fixtureRoot();
        try {
          const beforeFiles = Array.from({ length: before }, (_, i) => `test/bl1234GenBefore${i}.property.test.js`);
          const afterFiles = Array.from({ length: after }, (_, i) => `test/bl1234GenAfter${i}.property.test.js`);
          const unlisted = 'test/bl1234GenUNLISTED.property.test.js';
          const allowlisted = [...beforeFiles, ...afterFiles];
          const tsvPath = buildTsv(root, allowlisted);
          const allFailing = [...beforeFiles, unlisted, ...afterFiles];
          const result = evaluateGuard(tsvPath, fakeFailOutput(allFailing));

          assert.notEqual(result.status, 0, `expected a genuine unlisted file (before=${before}, after=${after}) to refuse`);
          const reportedLines = result.unlisted.split('\n').filter(Boolean);
          // Invariant 2: every reported path is one of the PARSED paths -
          // here, exactly the one genuinely unlisted path, never a
          // concatenation with any allowlisted neighbour.
          assert.deepEqual(reportedLines, [unlisted], `expected only the unlisted path to be reported, got: ${JSON.stringify(reportedLines)}`);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 20 }
  );
});
