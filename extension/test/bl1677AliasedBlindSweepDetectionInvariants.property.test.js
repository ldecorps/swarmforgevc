'use strict';

// BL-1677 declared invariant 2 (property authorship rests with the coder,
// first pass - BL-654): "Every blind prefix sweep of os.tmpdir() under
// extension/test, whether it calls os.tmpdir() inline or through a
// variable, is reported by the BL-1623 finder; the live tree reports
// none."
//
// blindTmpDirSweepGuard.test.js and this ticket's own acceptance scenario
// 02 pin the finder against a handful of fixed examples (the literal form,
// one aliased form, the real live tree). Those fixed examples can't tell us
// the new aliased-form pattern generalizes past the one variable name and
// position someone thought to write by hand - exactly the shape BL-1623's
// own literal-only pattern missed for bl1354/bl1389/bl1380 in the first
// place, each binding `os.tmpdir()` to a differently-named local before
// calling `readdirSync` on it. This property fuzzes the alias identifier,
// surrounding noise, and call-site position so the guarantee covers "any
// aliased blind sweep, any variable name, anywhere in the file" - and,
// symmetrically, that binding os.tmpdir() to a name and never reading it
// back (or reading an unrelated variable) is never a false positive.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { findBlindTmpDirSweeps } = require('./helpers/blindTmpDirSweepFinder');

const identArb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/);
// BL-1677 hardening: the binding's own declaration keyword, not just its
// identifier - "through a variable" (invariant 2's own wording) does not
// say "through a const". Found by hand-checking `findBlindTmpDirSweeps`
// against a `let`/`var` fixture: both returned [] before the finder's own
// ALIAS_BINDING_PATTERN was widened from `const` alone to `const|let|var` -
// this generator's own prior form (hardcoded `const` in aliasedSweepLines)
// could never have drawn that case either.
const declKeywordArb = fc.constantFrom('const', 'let', 'var');
const noiseLineArb = fc.constantFrom(
  'const x = 1;',
  'function helper() { return 42; }',
  '// a comment',
  "assert.equal(1, 1);",
  '',
);
const noiseLinesArb = fc.array(noiseLineArb, { minLength: 0, maxLength: 5 });

function aliasedSweepLines(ident, decl) {
  return [`${decl} ${ident} = os.tmpdir();`, `for (const e of fs.readdirSync(${ident})) { /* blind */ }`];
}

// Built from parts, never as one contiguous literal: this file itself is a
// *.property.test.js under the very tree the finder scans, so writing the
// exact blind-sweep call directly in this file's OWN source would make
// this regression-pin test flag itself as an offender (BL-1032's
// EXECUTING vs ASSERTING distinction - this is fixture DATA for a file
// this function writes elsewhere, not code this file executes).
function literalSweepLine() {
  const call = 'readdirSync';
  return `for (const e of fs.${call}(os.tmpdir())) { /* blind */ }`;
}

function scopedSweepLine() {
  return "sweepStaleTmpDirs({ prefix: 'x-' });";
}

function writeFixtureFile(root, seed, lines) {
  const file = path.join(root, `case-${seed}.property.test.js`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

test('BL-1677/BL-654 invariant 2: the aliased form is flagged for any identifier name, any declaration keyword, any surrounding noise, any position', () => {
  const root = mkTmpDir('bl1677-aliased-sweep-property-');
  const reach = { const: 0, let: 0, var: 0 };

  fc.assert(
    fc.property(identArb, declKeywordArb, noiseLinesArb, noiseLinesArb, fc.integer({ min: 0, max: 100000 }), (ident, decl, before, after, seed) => {
      reach[decl] += 1;
      const lines = [...before, ...aliasedSweepLines(ident, decl), ...after];
      const file = writeFixtureFile(root, seed, lines);

      try {
        const offenders = findBlindTmpDirSweeps(root);
        assert.ok(offenders.includes(path.basename(file)), `expected ${path.basename(file)} (ident=${ident}, decl=${decl}) to be flagged, got: ${JSON.stringify(offenders)}`);
      } finally {
        fs.rmSync(file, { force: true });
      }
    }),
    { numRuns: 50 },
  );

  assert.ok(reach.const > 0, `generator never drew a const-declared alias: ${JSON.stringify(reach)}`);
  assert.ok(reach.let > 0, `generator never drew a let-declared alias: ${JSON.stringify(reach)}`);
  assert.ok(reach.var > 0, `generator never drew a var-declared alias: ${JSON.stringify(reach)}`);
});

test('BL-1677/BL-654 invariant 2 regression: the literal form is still flagged, for any surrounding noise or position', () => {
  const root = mkTmpDir('bl1677-literal-sweep-property-');

  fc.assert(
    fc.property(noiseLinesArb, noiseLinesArb, fc.integer({ min: 0, max: 100000 }), (before, after, seed) => {
      const lines = [...before, literalSweepLine(), ...after];
      const file = writeFixtureFile(root, seed, lines);

      try {
        const offenders = findBlindTmpDirSweeps(root);
        assert.ok(offenders.includes(path.basename(file)), `expected ${path.basename(file)} to still be flagged (literal form), got: ${JSON.stringify(offenders)}`);
      } finally {
        fs.rmSync(file, { force: true });
      }
    }),
    { numRuns: 30 },
  );
});

test('BL-1677/BL-654 invariant 2 non-vacuity: binding os.tmpdir() to a name without ever reading it back is never a false positive', () => {
  const root = mkTmpDir('bl1677-unread-alias-property-');
  const reach = { unread: 0, unrelatedReaddir: 0, scopedOnly: 0 };

  fc.assert(
    fc.property(
      identArb,
      noiseLinesArb,
      noiseLinesArb,
      fc.constantFrom('unread', 'unrelated-readdir', 'scoped-only'),
      fc.integer({ min: 0, max: 100000 }),
      (ident, before, after, shape, seed) => {
        // Derived, never independently drawn: guarantees otherIdent !== ident
        // by construction, so the 'unrelated-readdir' shape can never
        // accidentally collapse into the true-positive shape by a random
        // identifier collision.
        const otherIdent = `${ident}Other`;
        let lines;
        if (shape === 'unread') {
          reach.unread += 1;
          lines = [...before, `const ${ident} = os.tmpdir();`, ...after];
        } else if (shape === 'unrelated-readdir') {
          reach.unrelatedReaddir += 1;
          // Binds `ident` to os.tmpdir() but reads a DIFFERENT identifier -
          // the alias must never be conflated with an unrelated readdirSync
          // call elsewhere in the same file.
          lines = [
            ...before,
            `const ${ident} = os.tmpdir();`,
            `const ${otherIdent} = someOtherDir();`,
            `fs.readdirSync(${otherIdent});`,
            ...after,
          ];
        } else {
          reach.scopedOnly += 1;
          lines = [...before, scopedSweepLine(), ...after];
        }
        const file = writeFixtureFile(root, seed, lines);

        try {
          const offenders = findBlindTmpDirSweeps(root);
          assert.ok(!offenders.includes(path.basename(file)), `expected ${path.basename(file)} (shape=${shape}) to NOT be flagged, got: ${JSON.stringify(offenders)}`);
        } finally {
          fs.rmSync(file, { force: true });
        }
      },
    ),
    { numRuns: 60 },
  );

  assert.ok(reach.unread > 0, `generator never reached the unread-alias case: ${JSON.stringify(reach)}`);
  assert.ok(reach.unrelatedReaddir > 0, `generator never reached the unrelated-readdir case: ${JSON.stringify(reach)}`);
  assert.ok(reach.scopedOnly > 0, `generator never reached the scoped-only case: ${JSON.stringify(reach)}`);
});
