'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assessPilotMkdtempConvention } = require('../out/tools/pilotMkdtempConventionCheck');

// BL-1226 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`.
//
// P1 (invariant 1): the gate scans only paths the parcel TOUCHED - an
//    untouched file, however it is written, is never read, never scanned,
//    and never named in a violation.
// P2 (invariant 2): a fixture root is detected by its ROUTE, not by how its
//    base path is spelled - ANY direct mkdtempSync(...) call in a touched
//    steps-lane file is a violation whatever expression sits inside its
//    parens, and only the one route through the shared helper is clean.
//    Generator reach is deliberately wider than the ticket's own five
//    example spellings, to prove this is route detection and not a
//    five-item enumeration in disguise.

const MKDTEMP = 'mkdtemp' + 'Sync';

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

const RAW_STEPS_SOURCE = `const dir = ${MKDTEMP}('/tmp/x-');\n`;
const CLEAN_STEPS_SOURCE =
  "const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');\n" +
  "const dir = mkSocketFixtureRoot('x-');\n";

// ── P1: invariant 1 ──────────────────────────────────────────────────────

const nameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,15}$/);
const laneArb = fc.constantFrom('test', 'steps');
const contentArb = fc.constantFrom('raw', 'clean');

function relPathFor(lane, name) {
  return lane === 'test' ? `extension/test/${name}.test.js` : `specs/pipeline/steps/${name}Steps.js`;
}

function sourceFor(lane, content) {
  if (content === 'raw') {
    return lane === 'test'
      ? "const fs = require('fs'); const os = require('os'); const path = require('path');\n" +
          `const dir = fs.${MKDTEMP}(path.join(os.tmpdir(), 'x-'));\n`
      : RAW_STEPS_SOURCE;
  }
  return lane === 'test' ? "const { mkTmpDir } = require('./helpers/tmpDir');\nconst dir = mkTmpDir('x-');\n" : CLEAN_STEPS_SOURCE;
}

// Generator reach: at least one untouched-and-raw file (the case invariant 1
// exists for) is guaranteed present by construction on every draw, rather
// than merely likely - one entry forced untouched+raw, the rest random. Every
// draw (lane, name, content, touched) comes from fast-check's own stream via
// fc.tuple, never a nested fc.sample() call, which would disconnect the draw
// from the property's shrinking/seed.
const fileSpecArb = fc.tuple(laneArb, nameArb, contentArb, fc.boolean());
const filesArb = fc
  .uniqueArray(fileSpecArb, { minLength: 2, maxLength: 8, selector: ([lane, name]) => `${lane}:${name}` })
  .map((entries) =>
    entries.map(([lane, name, content, touched], i) => ({
      lane,
      name,
      rel: relPathFor(lane, name),
      content: i === 0 ? 'raw' : content,
      touched: i === 0 ? false : touched,
    }))
  );

test('BL-1226 P1 (invariant 1): an untouched file is never scanned and never named in a violation, whatever it contains', () => {
  fc.assert(
    fc.property(filesArb, (files) => {
      const root = mkTmpDir('bl1226-inv1-');
      for (const f of files) {
        writeFile(root, f.rel, sourceFor(f.lane, f.content));
      }
      const touchedPaths = files.filter((f) => f.touched).map((f) => f.rel);
      const untouchedPaths = files.filter((f) => !f.touched).map((f) => f.rel);
      // Non-vacuous generator reach: every run has at least one untouched
      // file, and that file's own content is 'raw' on at least the forced
      // first entry - the exact shape a broken "touched-scope" check would
      // get wrong.
      assert.ok(untouchedPaths.length >= 1, 'expected at least one untouched file in this draw');

      const outcome = assessPilotMkdtempConvention(root, touchedPaths);

      for (const rel of untouchedPaths) {
        assert.ok(!outcome.scannedPaths.includes(rel), `untouched file ${rel} was scanned: ${JSON.stringify(outcome.scannedPaths)}`);
        assert.ok(
          !outcome.violations.some((v) => v.file === rel),
          `untouched file ${rel} was named in a violation: ${JSON.stringify(outcome.violations)}`
        );
      }
    }),
    { numRuns: 200 }
  );
});

// ── P2: invariant 2 ───────────────────────────────────────────────────────

// Random, WIDER-than-the-ticket's-examples base expressions: arbitrary
// identifier-like tokens composed into something that reads like a base
// path expression, never one of the five canonical spellings verbatim. A
// detector that secretly enumerates known spellings (rather than genuinely
// matching the mkdtempSync( call site regardless of its argument) would
// pass the ticket's own five examples and still fail here.
const identArb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{1,10}$/);
const randomBaseExpressionArb = fc.oneof(
  identArb.map((id) => `${id}.tmpdir()`),
  identArb.map((id) => `require('${id}').tmpdir()`),
  fc.tuple(identArb, identArb).map(([a, b]) => `${a}.${b}`),
  identArb.map((id) => `'/${id}'`),
  identArb.map((id) => `process.env.${id.toUpperCase()}`)
);

test('BL-1226 P2 (invariant 2): any direct mkdtempSync call in a touched steps file is a violation, whatever expression is inside its parens', () => {
  fc.assert(
    fc.property(nameArb, randomBaseExpressionArb, (name, baseExpression) => {
      const root = mkTmpDir('bl1226-inv2-');
      const rel = `specs/pipeline/steps/${name}Steps.js`;
      writeFile(root, rel, `const dir = ${MKDTEMP}(${baseExpression});\n`);
      const outcome = assessPilotMkdtempConvention(root, [rel]);
      assert.equal(
        outcome.violations.length,
        1,
        `expected a violation for base expression ${JSON.stringify(baseExpression)}, got ${JSON.stringify(outcome)}`
      );
      assert.equal(outcome.violations[0].file, rel);
    }),
    { numRuns: 200 }
  );
});

test('BL-1226 P2 (invariant 2), the other direction: the one route through the shared helper is always clean, whatever the file is named', () => {
  fc.assert(
    fc.property(nameArb, (name) => {
      const root = mkTmpDir('bl1226-inv2-clean-');
      const rel = `specs/pipeline/steps/${name}Steps.js`;
      writeFile(root, rel, CLEAN_STEPS_SOURCE);
      const outcome = assessPilotMkdtempConvention(root, [rel]);
      assert.deepEqual(outcome.violations, [], `expected no violations for ${rel}, got ${JSON.stringify(outcome.violations)}`);
      assert.ok(outcome.scannedPaths.includes(rel));
    }),
    { numRuns: 100 }
  );
});
