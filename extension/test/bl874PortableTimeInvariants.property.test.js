'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { findPortableTimeViolation } = require('../../specs/pipeline/steps/lib/portableTimeGuard');

// BL-874 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).

// ─── Invariant 1: "Any test that backdates a file's mtime does so through
// one shared portable helper; no test re-implements the BSD/GNU split
// inline." ───────────────────────────────────────────────────────────────
//
// extension/test/portableTimeGuard.test.js's own examples pin one hand-
// picked shape each for the inline-violation and the helper-based cases.
// This fuzzes surrounding noise and the exact inline invocation text so
// the guarantee covers "any file that reimplements the split inline", not
// just the 6 hand-fixed sites from this ticket.
const noiseLineArb = fc.constantFrom('set -euo pipefail', '# a comment', 'trap cleanup EXIT', '');
const noiseLinesArb = fc.array(noiseLineArb, { minLength: 0, maxLength: 4 });
const relativeSpecArb = fc.constantFrom('2 hours ago', '-5 minutes', '90 seconds ago', '3 days ago', '-1 weeks');
const relativeCmdArb = fc.constantFrom('date', 'touch');
const quoteArb = fc.constantFrom("'", '"');

function inlineViolationText(before, after, cmd, spec, quote) {
  return [...before, `${cmd} -d ${quote}${spec}${quote} "$1"`, ...after].join('\n') + '\n';
}

function helperBasedText(before, after, amount, unit) {
  return [...before, 'source "$SCRIPT_DIR/portable_time_lib.sh"', `old_mtime() { portable_touch_relative ${amount} ${unit} "$1"; }`, ...after].join('\n') + '\n';
}

test('property (BL-874 invariant 1): any inline GNU-only relative-time invocation is always flagged, for any surrounding noise', () => {
  fc.assert(
    fc.property(noiseLinesArb, noiseLinesArb, relativeCmdArb, relativeSpecArb, quoteArb, (before, after, cmd, spec, quote) => {
      const violation = findPortableTimeViolation('any_test.sh', inlineViolationText(before, after, cmd, spec, quote));
      assert.ok(violation, `expected a violation for ${cmd} -d ${quote}${spec}${quote}`);
    }),
    { numRuns: 60 }
  );
});

test('property (BL-874 invariant 1 converse): the shared-helper shape is never flagged, for any amount/unit or surrounding noise', () => {
  fc.assert(
    fc.property(
      noiseLinesArb,
      noiseLinesArb,
      fc.integer({ min: 1, max: 999 }),
      fc.constantFrom('seconds', 'minutes', 'hours'),
      (before, after, amount, unit) => {
        assert.equal(findPortableTimeViolation('any_test.sh', helperBasedText(before, after, amount, unit)), null);
      }
    ),
    { numRuns: 60 }
  );
});

// ─── Invariant 2: "A newly added GNU-only relative-time invocation under
// swarmforge/scripts turns a gate red inside the parcel that introduces
// it, not a later one." ───────────────────────────────────────────────────
//
// This is a positional/structural guarantee (the check lives in the ONE
// suite every parcel runs, not a suite nothing runs - BL-872's own
// precedent for treating this class of invariant as non-generative), not
// a fuzzable behavior: there is no input domain to vary. Given an
// executable, non-vacuous encoding below rather than left unencoded, per
// BL-654 - mirrors tempDirTrapGuard.property.test.js's invariant-2
// treatment exactly.
const REPO_ROOT = path.join(__dirname, '..', '..');
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'out', 'coverage', '.stryker-tmp', 'vendor']);
const GUARD_MODULE_PATH = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'portableTimeGuard.js');
const STANDING_GUARD_TEST_PATH = path.join(REPO_ROOT, 'extension', 'test', 'portableTimeGuard.test.js');

function findFunctionDefinitionFiles(rootDir, functionName) {
  const pattern = new RegExp(`function\\s+${functionName}\\s*\\(`);
  const found = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIR_NAMES.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }
      if (!entry.name.endsWith('.js')) {
        continue;
      }
      const full = path.join(dir, entry.name);
      const text = fs.readFileSync(full, 'utf8');
      if (pattern.test(text)) {
        found.push(full);
      }
    }
  }

  walk(rootDir);
  return found;
}

test('findPortableTimeViolation is defined in exactly one file repo-wide (the shared guard module, never a reimplementation)', () => {
  assert.deepEqual(findFunctionDefinitionFiles(REPO_ROOT, 'findPortableTimeViolation'), [GUARD_MODULE_PATH]);
});

test('the zero-violation assertion lives in the standing per-parcel suite, not a suite nothing runs', () => {
  const text = fs.readFileSync(STANDING_GUARD_TEST_PATH, 'utf8');
  assert.match(text, /scanForPortableTimeViolations\(scriptsDir\)/);
  assert.match(text, /zero GNU-only relative-time violations/);
});

// ─── Invariant 3: "The same relative input yields the same resulting mtime
// on BSD and on GNU userlands - making macOS green at GNU/Linux's expense
// is a failure, not a trade." ─────────────────────────────────────────────
//
// This host has no GNU coreutils (constraint: don't add the dependency),
// so the GNU branch cannot be executed here to compare directly. What IS
// verifiable on this host is that portable_time_lib.sh's BSD branch (the
// one this host actually takes) computes the mathematically correct
// epoch offset for "amount unit ago" - the GNU branch forwards the exact
// GNU syntax the six broken tests already used verbatim (unchanged), so
// the risk this property actually covers is the BSD `-v` flag arithmetic
// and the unit-letter dispatch, which is the part BL-874 newly adds.
// Generator reach: amount spans two orders of magnitude (1-500) across
// all three units, so seconds/minutes/hours math (including carries
// across minute/hour boundaries) are all exercised, not just one shape.
const LIB_PATH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'portable_time_lib.sh');
const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600 };

function backdateViaSharedLib(file, amount, unit) {
  const script = `source "${LIB_PATH}" && portable_touch_relative ${amount} ${unit} "${file}"`;
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}

test(
  'property (BL-874 invariant 3): the resulting mtime is now minus the requested offset, for any amount/unit',
  () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.constantFrom('seconds', 'minutes', 'hours'), (amount, unit) => {
        const dir = mkTmpDir('bl874-portable-time-');
        const file = path.join(dir, 'f');
        fs.writeFileSync(file, '');

        const before = Date.now();
        const result = backdateViaSharedLib(file, amount, unit);
        const after = Date.now();
        assert.equal(result.status, 0, `expected portable_touch_relative to succeed:\n${result.stderr}`);

        const actualMs = fs.statSync(file).mtimeMs;
        const expectedMs = (before + after) / 2 - amount * UNIT_SECONDS[unit] * 1000;
        // touch -t has 1s resolution; add the subprocess's own wall-clock
        // spread (after - before) so slow hosts don't produce a false
        // failure from execution latency rather than a wrong offset.
        const toleranceMs = 2000 + (after - before);
        assert.ok(
          Math.abs(actualMs - expectedMs) <= toleranceMs,
          `expected mtime within ${toleranceMs}ms of ${expectedMs} for ${amount} ${unit} ago, got ${actualMs} (diff ${Math.abs(actualMs - expectedMs)}ms)`
        );
      }),
      { numRuns: 15 }
    );
  },
  60000
);
