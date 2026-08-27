const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { findTempDirTrapViolation, scanForTempDirTrapViolations } = require('../../specs/pipeline/steps/lib/tempDirTrapGuard');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-872 invariants (coder-authored first, per BL-654):
//
//   1. "Every file under swarmforge/scripts that creates a temp root removes
//      it on both a clean and a failing exit — files added after this
//      ticket included, not just the 18 remediated here."
//   3. "A newly added unguarded temp-root creator turns a gate red inside
//      the parcel that introduces it, not a later one."
//
// BL-459's own tempDirTrapGuard.test.js already pins these at hand-picked
// fixed examples (one shell shape, one bb shape). Those examples don't vary
// prefix text, surrounding code, or file position, so they can't tell us the
// guard generalizes past the exact shapes someone thought to write by hand -
// which is exactly the gap invariant 3 closes: a FUTURE file (any file, not
// one of the 18 named in this ticket) must still be caught the moment it is
// introduced. This property fuzzes creator-call shape, prefix text, and
// surrounding noise so the guarantee covers "any file that creates a temp
// root without a cleanup mechanism", not just the four/two hand-written
// fixtures BL-459 shipped.
//
// Invariant 2 ("the rules... exist in exactly one module; no gate, suite, or
// harness re-implements them") does NOT get a generative property here: it
// quantifies over how many source files in the repo define the scan rules,
// not over the behavior of a pure function across varying inputs - there is
// no input domain to fuzz. It is still given an EXECUTABLE encoding below
// (not silently left unencoded, per BL-654) as a structural, non-generative
// assertion: the two rule-deciding functions are defined in exactly one file
// repo-wide.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const shellPrefixArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}-$/);
const bbPrefixArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}-$/);
const noiseLineArb = fc.constantFrom('(defn foo [] 1)', 'echo hi', '# a comment', ';; a comment', 'set -euo pipefail', '');
const noiseLinesArb = fc.array(noiseLineArb, { minLength: 0, maxLength: 4 });

function unguardedShellText(prefix, before, after) {
  return [...before, `d="$(mktemp -d "${prefix}XXXXXX")"`, ...after].join('\n') + '\n';
}

function guardedShellTrapText(prefix, before, after) {
  return [...before, "trap 'rm -rf \"$d\"' EXIT", `d="$(mktemp -d "${prefix}XXXXXX")"`, ...after].join('\n') + '\n';
}

function guardedShellSourceText(prefix, before, after) {
  return [...before, 'source "$(dirname "${BASH_SOURCE[0]}")/lib/tmp_cleanup.sh"', `d="$(mktemp -d "${prefix}XXXXXX")"`, 'register_tmp_dir "$d"', ...after].join('\n') + '\n';
}

function unguardedBbText(prefix, before, after) {
  return [...before, `(def d (str (fs/create-temp-dir {:prefix "${prefix}"})))`, ...after].join('\n') + '\n';
}

function guardedBbShutdownHookText(prefix, before, after) {
  return [
    ...before,
    '(def created-temp-dirs (atom []))',
    '(.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (doseq [d @created-temp-dirs] (fs/delete-tree d)))))',
    `(def d (let [dd (str (fs/create-temp-dir {:prefix "${prefix}"}))] (swap! created-temp-dirs conj dd) dd))`,
    ...after,
  ].join('\n') + '\n';
}

function guardedBbTryFinallyText(prefix, before, after) {
  return [...before, `(let [d (fs/create-temp-dir {:prefix "${prefix}"})]`, '  (try', '    (do-something d)', '    (finally (fs/delete-tree d))))', ...after].join('\n') + '\n';
}

// ── invariant 3: any unguarded creator is flagged, regardless of prefix,
// surrounding noise, or file position - the classifier generalizes past the
// 18 named fixtures ─────────────────────────────────────────────────────

test('a shell file creating a temp root with no trap and no shared source is always flagged, for any prefix or surrounding noise', () => {
  fc.assert(
    fc.property(shellPrefixArb, noiseLinesArb, noiseLinesArb, (prefix, before, after) => {
      const violation = findTempDirTrapViolation('any_test.sh', unguardedShellText(prefix, before, after));
      assert.ok(violation, `expected a violation for prefix=${prefix}`);
    }),
    { numRuns: 40 }
  );
});

test('a babashka file creating a temp root with no shutdown hook and no try/finally is always flagged, for any prefix or surrounding noise', () => {
  fc.assert(
    fc.property(bbPrefixArb, noiseLinesArb, noiseLinesArb, (prefix, before, after) => {
      const violation = findTempDirTrapViolation('any_runner.bb', unguardedBbText(prefix, before, after));
      assert.ok(violation, `expected a violation for prefix=${prefix}`);
    }),
    { numRuns: 40 }
  );
});

// ── invariant 1 (converse): the two remediation shapes actually used across
// the 18 files remediated by this ticket are never flagged, for any prefix
// or surrounding noise - a clean exit AND a failing exit both rely on the
// SAME guarded shape being recognized regardless of what else is nearby ──

test('a shell file guarded by an EXIT trap is never flagged, for any prefix or surrounding noise', () => {
  fc.assert(
    fc.property(shellPrefixArb, noiseLinesArb, noiseLinesArb, (prefix, before, after) => {
      assert.equal(findTempDirTrapViolation('any_test.sh', guardedShellTrapText(prefix, before, after)), null);
    }),
    { numRuns: 40 }
  );
});

test('a shell file guarded by sourcing lib/tmp_cleanup.sh is never flagged, for any prefix or surrounding noise', () => {
  fc.assert(
    fc.property(shellPrefixArb, noiseLinesArb, noiseLinesArb, (prefix, before, after) => {
      assert.equal(findTempDirTrapViolation('any_test.sh', guardedShellSourceText(prefix, before, after)), null);
    }),
    { numRuns: 40 }
  );
});

test('a babashka file guarded by a shutdown hook is never flagged, for any prefix or surrounding noise', () => {
  fc.assert(
    fc.property(bbPrefixArb, noiseLinesArb, noiseLinesArb, (prefix, before, after) => {
      assert.equal(findTempDirTrapViolation('any_runner.bb', guardedBbShutdownHookText(prefix, before, after)), null);
    }),
    { numRuns: 40 }
  );
});

test('a babashka file guarded by try/finally delete-tree is never flagged, for any prefix or surrounding noise', () => {
  fc.assert(
    fc.property(bbPrefixArb, noiseLinesArb, noiseLinesArb, (prefix, before, after) => {
      assert.equal(findTempDirTrapViolation('any_runner.bb', guardedBbTryFinallyText(prefix, before, after)), null);
    }),
    { numRuns: 40 }
  );
});

// ── invariant 3 (real fs, mixed): a single new unguarded file among many
// already-guarded neighbors is still caught - never lost among the noise of
// an arbitrary mix, which is exactly what a real swarmforge/scripts/test/
// directory full of already-clean files looks like ──────────────────────

const shapeArb = fc.constantFrom('unguarded-shell', 'guarded-shell-trap', 'guarded-shell-source', 'unguarded-bb', 'guarded-bb-hook', 'guarded-bb-finally');
const mixedFileArb = fc.array(fc.record({ shape: shapeArb, prefix: shellPrefixArb }), { minLength: 1, maxLength: 8 });

function textForShape(shape, prefix) {
  switch (shape) {
    case 'unguarded-shell':
      return unguardedShellText(prefix, [], []);
    case 'guarded-shell-trap':
      return guardedShellTrapText(prefix, [], []);
    case 'guarded-shell-source':
      return guardedShellSourceText(prefix, [], []);
    case 'unguarded-bb':
      return unguardedBbText(prefix, [], []);
    case 'guarded-bb-hook':
      return guardedBbShutdownHookText(prefix, [], []);
    case 'guarded-bb-finally':
      return guardedBbTryFinallyText(prefix, [], []);
    default:
      throw new Error(`unknown shape: ${shape}`);
  }
}

function extForShape(shape) {
  return shape.includes('bb') ? '.bb' : '.sh';
}

test('the scanner reports exactly the unguarded files in an arbitrary mix of guarded and unguarded fixtures - never a subset, never a superset', () => {
  const root = mkTmpDir('sfvc-tempdir-trap-property-mix-');

  fc.assert(
    fc.property(mixedFileArb, fc.integer({ min: 0, max: 100000 }), (files, seed) => {
      const written = [];
      const expectedViolations = [];
      files.forEach((f, i) => {
        const file = path.join(root, `mix-${seed}-${i}${extForShape(f.shape)}`);
        fs.writeFileSync(file, textForShape(f.shape, f.prefix));
        written.push(file);
        if (f.shape.startsWith('unguarded')) {
          expectedViolations.push(file);
        }
      });

      try {
        const violations = scanForTempDirTrapViolations(root)
          .map((v) => v.file)
          .filter((f) => written.includes(f))
          .sort();
        assert.deepEqual(violations, expectedViolations.sort());
      } finally {
        written.forEach((file) => fs.rmSync(file, { force: true }));
      }
    }),
    { numRuns: 30 }
  );
});

// ── invariant 2 (structural, non-generative): the scan rules are defined in
// exactly one module repo-wide - no gate, suite, or harness re-implements
// them. See the file-level comment above for why this is not a fuzzed
// property. ──────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, '..', '..');
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'out', 'coverage', '.stryker-tmp', 'vendor']);
const GUARD_MODULE_PATH = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'tempDirTrapGuard.js');

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

test('findTempDirTrapViolation is defined in exactly one file repo-wide (the shared guard module, never a reimplementation)', () => {
  assert.deepEqual(findFunctionDefinitionFiles(REPO_ROOT, 'findTempDirTrapViolation'), [GUARD_MODULE_PATH]);
});

test('scanForTempDirTrapViolations is defined in exactly one file repo-wide (the shared guard module, never a reimplementation)', () => {
  assert.deepEqual(findFunctionDefinitionFiles(REPO_ROOT, 'scanForTempDirTrapViolations'), [GUARD_MODULE_PATH]);
});
