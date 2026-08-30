'use strict';

// BL-1209's two declared invariants.
//
// Invariant 1: "A check resolves tool-owned artifacts from the TOOL's own
// location, never from the subject root it was handed." The failure this
// guards is a check that only works against the one root containing the tool,
// so every generated subject root is a FRESH temp directory that provably does
// NOT contain the detector - the property asserts that absence rather than
// assuming it, because a generator that accidentally produced the live repo
// root would pass while proving nothing.
//
// Invariant 2: "A check with nothing in its scope does no work and cannot
// fail." Encoded through the injected loader: on an out-of-scope draw the
// loader must never be called (not merely "nothing threw"), and on an in-scope
// draw it must be called exactly once - the second half is what stops the
// first from being satisfiable by a check that never loads a detector at all.
//
// Generator reach: in-scope and out-of-scope path sets are drawn as an
// explicit boundary with asserted floors on both sides, and the file contents
// mix raw calls with shared-helper calls so a detector that reported nothing
// would fail rather than pass quietly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assessPilotMkdtempConvention } = require('../out/tools/pilotMkdtempConventionCheck');
const { findRawMkdtempLines } = require('../out/tools/rawMkdtempDetector');

const RAW_LINE =
  // BL-1280: the `mkdtempSync(` boundary is split so the real-tree scan does
  // not flag this fixture's DATA as a call site - the file is scanned like
  // any other rather than being exempted wholesale, which would blind the
  // guard to a REAL raw call arriving here later. The value is byte-identical.
  "const dir = fs.mkdtemp" + "Sync(path.join(os.tmpdir(), 'x-'));";
const CLEAN_LINE = "const dir = mkTmpDir('x-');";

const OUT_OF_SCOPE = [
  'src/foo.ts',
  'docs/how-to/x.md',
  'backlog/active/BL-1.yaml',
  'swarmforge/scripts/x.bb',
  'extension/src/tools/y.ts',
  'extension/test/fixtures/task/z.test.js',
];

const nameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);

function writeSubject(root, rel, lines) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join('\n')}\n`, 'utf8');
}

test('property: any subject root works, and none of them needs the tool inside it', () => {
  let sawViolations = 0;
  let sawClean = 0;
  fc.assert(
    fc.property(
      fc.array(fc.record({ name: nameArb, raw: fc.boolean(), depth: fc.nat({ max: 2 }) }), {
        minLength: 1,
        maxLength: 4,
      }),
      (files) => {
        const root = mkTmpDir('bl1209-prop-');
        // The subject root must NOT contain the tool's detector, or this
        // property proves nothing about where the detector is resolved from.
        assert.equal(
          fs.existsSync(path.join(root, 'extension', 'test', 'helpers', 'rawMkdtempGuard.js')),
          false
        );

        const touched = [];
        const expected = [];
        files.forEach((file, index) => {
          const dir = Array.from({ length: file.depth }, (_, d) => `d${d}`).join('/');
          const rel = `extension/test/${dir ? `${dir}/` : ''}${file.name}${index}.test.js`;
          const lines = ['// header', file.raw ? RAW_LINE : CLEAN_LINE];
          writeSubject(root, rel, lines);
          touched.push(rel);
          // Expectation computed independently, through the pure detector.
          for (const line of findRawMkdtempLines(lines.join('\n'))) {
            expected.push({ file: rel, line });
          }
        });

        const outcome = assessPilotMkdtempConvention(root, touched);
        assert.equal(outcome.checked, true);
        assert.equal(outcome.testFilesScanned, touched.length);
        assert.deepEqual(outcome.violations, expected);
        expected.length > 0 ? (sawViolations += 1) : (sawClean += 1);
      }
    ),
    { numRuns: 120 }
  );
  // Reachability floors: both verdicts must actually be produced, or a check
  // that always reported "clean" would pass this property.
  assert.ok(sawViolations > 20, `expected roots with violations, saw ${sawViolations}`);
  assert.ok(sawClean > 10, `expected clean roots, saw ${sawClean}`);
});

test('property: nothing in scope loads no detector; something in scope loads it once', () => {
  let sawOutOfScope = 0;
  let sawInScope = 0;
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.constantFrom(...OUT_OF_SCOPE), { minLength: 1, maxLength: 6 }),
      nameArb,
      fc.boolean(),
      (outOfScopePaths, name, includeInScope) => {
        const root = mkTmpDir('bl1209-prop-');
        const inScopeRel = `extension/test/${name}.test.js`;
        writeSubject(root, inScopeRel, [RAW_LINE]);

        const touched = includeInScope ? [...outOfScopePaths, inScopeRel] : [...outOfScopePaths];
        let loads = 0;
        const outcome = assessPilotMkdtempConvention(root, touched, {
          loadDetector: () => {
            loads += 1;
            return { findRawMkdtempLines };
          },
        });

        if (!includeInScope) {
          sawOutOfScope += 1;
          assert.deepEqual(outcome, { checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] });
          assert.equal(loads, 0, `the detector was loaded for ${JSON.stringify(touched)}`);
          return;
        }
        sawInScope += 1;
        assert.equal(outcome.testFilesScanned, 1);
        assert.equal(outcome.violations.length, 1);
        assert.equal(loads, 1, 'the detector must be loaded exactly once when there is work to do');
      }
    ),
    { numRuns: 160 }
  );
  assert.ok(sawOutOfScope > 40, `expected out-of-scope draws, saw ${sawOutOfScope}`);
  assert.ok(sawInScope > 40, `expected in-scope draws, saw ${sawInScope}`);
});
