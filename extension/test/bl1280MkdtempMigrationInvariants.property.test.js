'use strict';

// BL-1280's two declared invariants, coder-authored (BL-654), property lane
// only.
//
// Invariant 1 - "No migrated call site changes its temp root's observable
// lifetime: a root that must outlive its own test uses the per-file or
// per-process helper, never the per-test one."
//
//   tmpDir.js offers three variants with three different sweep moments:
//   mkTmpDir is swept by an afterEach, mkSharedTmpDir by an afterAll,
//   mkProcessTmpDir on process exit. A root allocated with mkTmpDir from a
//   beforeAll - or at module scope - is destroyed after the FIRST test that
//   runs, and every later test in the file sees a root that is gone. That is
//   the one way this migration could break something while the guard it
//   satisfies goes green, so it is what the property quantifies over.
//
//   The domain is every mkTmpDir call site in extension/test: finite and
//   enumerable, so it is checked exhaustively rather than sampled, and the
//   floor asserts the corpus is the size the migration produced rather than
//   silently empty. The generative half is the SENSITIVITY draw: a synthesised
//   file placing the allocation in each too-long-lived position in turn, which
//   the same classifier must flag. Without it the exhaustive half could pass
//   against a classifier that answers "fine" to everything.
//
// Invariant 2 - "The guard's file-level exempt list stays exactly its three
// documented paths; a file carrying the raw pattern as test DATA keeps that
// data intact rather than being exempted from scanning."
//
//   Both halves matter and they pull against each other, which is why they are
//   asserted together: it is trivial to keep the fixture DATA intact by
//   exempting its file (what BL-1209 did), and trivial to shrink the exempt
//   list by rewriting the data (which destroys the test the data belongs to).
//   So for every data-carrying file the property asserts BOTH that the file is
//   scanned and clean, AND that folding its adjacent string literals brings
//   the contiguous raw pattern back - i.e. the bytes it writes to disk are
//   unchanged and still exercise the detector.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { assertReachFloor } = require('./helpers/reachFloors');
const {
  findRawMkdtempCallSites,
  findRawMkdtempLines,
  SELF_EXEMPT_RELATIVE_PATHS,
} = require('./helpers/rawMkdtempGuard');

const TEST_DIR = __dirname;

// ── invariant 1 ────────────────────────────────────────────────────────────

// Where an allocation sits, from the file's own text. Nesting is tracked by
// brace depth from the nearest enclosing construct rather than by parsing JS:
// what the sweep moment turns on is only "which hook, if any, encloses this
// line", and the four constructs below are the only ones tmpDir.js's contract
// distinguishes.
const TOO_LONG_LIVED = ['beforeAll', 'module scope'];

function classifyCallSite(lines, lineIndex) {
  let depth = 0;
  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i];
    if (i !== lineIndex) {
      depth += (line.match(/\}/g) || []).length - (line.match(/\{/g) || []).length;
    }
    if (depth < 0) {
      const opener = line.trim();
      if (/^beforeAll\s*\(/.test(opener)) return 'beforeAll';
      if (/^beforeEach\s*\(/.test(opener)) return 'beforeEach';
      if (/^(it|test)[.(]/.test(opener)) return 'test body';
      return 'function';
    }
  }
  return 'module scope';
}

// A line ALLOCATES when it calls mkTmpDir for real. Two shapes look like a
// call and are not, and both occur in the real tree:
//   - `const mkdir = () => mkTmpDir('x-');` defines a maker whose allocation
//     happens wherever it is invoked, which is what should be classified;
//   - a fixture STRING whose contents happen to spell the call.
// A comment mentioning the call - this very block did - is skipped too.
function isAllocation(line) {
  const at = line.search(/(^|[^.\w])mkTmpDir\(/);
  if (at < 0) return false;
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false;
  if (/require\(/.test(line)) return false;
  if (/=>\s*mkTmpDir\(/.test(line)) return false;
  const before = line.slice(0, at + 1);
  const quotes = (before.match(/(?<!\\)['"`]/g) || []).length;
  return quotes % 2 === 0;
}

function mkTmpDirCallSites(dir) {
  const sites = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'fixtures') sites.push(...mkTmpDirCallSites(full));
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!isAllocation(line)) return;
      sites.push({ file: path.relative(TEST_DIR, full), line: index + 1, where: classifyCallSite(lines, index) });
    });
  }
  return sites;
}

// The migration produced 33 sites; the floor is deliberately below that, so an
// ordinary later edit does not fail it while an empty corpus still does.
const CALL_SITE_FLOOR = 25;

describe('BL-1280 invariant 1: a migrated root never outlives its sweep', () => {
  const sites = mkTmpDirCallSites(TEST_DIR).filter((s) => !s.file.startsWith('helpers' + path.sep));

  it('has a corpus of mkTmpDir call sites to check', () => {
    assertReachFloor({ sites: sites.length }, ['sites'], CALL_SITE_FLOOR, 'mkTmpDir call sites');
  });

  // Exhaustive over the finite corpus, not sampled: a sampled version would
  // pass while one of 33 sites sat in a beforeAll.
  it('places no mkTmpDir allocation where its afterEach sweep is too early', () => {
    const offenders = sites
      .filter((s) => TOO_LONG_LIVED.includes(s.where))
      .map((s) => `${s.file}:${s.line} (${s.where})`);
    assert.deepEqual(
      offenders,
      [],
      'these roots are swept after the first test but referenced by later ones - they need mkSharedTmpDir or mkProcessTmpDir:\n' +
        offenders.join('\n')
    );
  });

  it('flags an allocation placed where the per-test sweep is too early', () => {
    const coverage = {};
    // One run per too-long-lived position: the floor is met by construction.
    for (const where of TOO_LONG_LIVED) {
      fc.assert(
        fc.property(fc.constant(where), (position) => {
          coverage[position] = (coverage[position] || 0) + 1;
          const body =
            position === 'beforeAll'
              ? "beforeAll(() => {\n  const root = mkTmpDir('bl1280-sensitivity-');\n});\n"
              : "const root = mkTmpDir('bl1280-sensitivity-');\n";
          const lines = body.split('\n');
          const index = lines.findIndex(isAllocation);
          assert.notEqual(index, -1, 'the sensitivity fixture no longer reads as an allocation');
          assert.equal(
            classifyCallSite(lines, index),
            position,
            `the classifier does not recognise an allocation ${position} - the exhaustive check above proves nothing`
          );
          return true;
        }),
        { numRuns: 1 }
      );
    }
    assertReachFloor(coverage, TOO_LONG_LIVED, 1, 'too-long-lived position');
  });
});

// ── invariant 2 ────────────────────────────────────────────────────────────

const DOCUMENTED_EXEMPT_PATHS = [
  'helpers/tmpDir.js',
  'tmpDirMigrationGuard.test.js',
  'tmpDirMigrationGuard.property.test.js',
];

// The files whose fixture STRINGS are the raw pattern, kept scannable by
// splitting the literal rather than by exempting the file.
const DATA_CARRIERS = [
  'pilotMkdtempConventionCheck.test.js',
  'pilotMkdtempConventionCheck.property.test.js',
];

// Folds `"a" + "b"` into `"ab"` - the one transformation that tells "the bytes
// this file writes still carry the pattern" apart from "the file's source
// carries the pattern".
function foldAdjacentLiterals(text) {
  let folded = text;
  for (let i = 0; i < 5; i += 1) {
    const next = folded.replace(/"\s*\+\s*"/g, '');
    if (next === folded) break;
    folded = next;
  }
  return folded;
}

describe('BL-1280 invariant 2: the exempt list stays at three, and the fixture data stays intact', () => {
  it('names exactly the three documented paths', () => {
    assert.deepEqual(SELF_EXEMPT_RELATIVE_PATHS, DOCUMENTED_EXEMPT_PATHS);
  });

  it('scans every data carrier, finds nothing, and leaves the data able to trip the detector', () => {
    const coverage = {};
    for (const file of DATA_CARRIERS) {
      fc.assert(
        fc.property(fc.constant(file), (carrier) => {
          coverage[carrier] = (coverage[carrier] || 0) + 1;
          assert.ok(
            !SELF_EXEMPT_RELATIVE_PATHS.includes(carrier),
            `${carrier} is exempted wholesale, so a REAL raw call it gains later would go unseen`
          );
          const source = fs.readFileSync(path.join(TEST_DIR, carrier), 'utf8');

          // Scanned, and clean: no line of the source is a call site.
          assert.deepEqual(findRawMkdtempLines(source), [], `${carrier} has a raw call site of its own`);

          // Intact: the fixture DATA still is the raw pattern once the source's
          // adjacent literals are folded, so it still exercises the detector.
          assert.ok(
            findRawMkdtempLines(foldAdjacentLiterals(source)).length > 0,
            `${carrier}'s fixture data no longer carries the raw pattern - the test it belongs to proves nothing`
          );
          return true;
        }),
        { numRuns: 1 }
      );
    }
    assertReachFloor(coverage, DATA_CARRIERS, 1, 'raw-pattern data carrier');
  });

  it('leaves the real tree with no raw call site under the three-path list', () => {
    assert.deepEqual(findRawMkdtempCallSites(TEST_DIR), []);
  });
});
