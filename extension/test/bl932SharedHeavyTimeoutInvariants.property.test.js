'use strict';

// BL-932 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const {
  CONSTANT_NAME,
  declaresLocalConstant,
  importsSharedHeavyTimeout,
  usesSharedHeavyTimeoutOnly,
} = require('./helpers/sharedHeavyTimeoutGuard');

const TEST_DIR = __dirname;
const HELPERS_DIR = path.join(TEST_DIR, 'helpers');
const HELPER_FILE = path.join(HELPERS_DIR, 'subprocessHeavyTimeout.js');
const PROPERTIES_CONFIG_PATH = path.join(TEST_DIR, '..', 'vitest.properties.config.mjs');
const UNIT_CONFIG_PATH = path.join(TEST_DIR, '..', 'vitest.config.mjs');

// The full, current set of files required to use (not re-declare) the
// shared constant - kept explicit rather than glob-derived so a new
// adopter is a deliberate addition to this list, never a silent pass.
const ADOPTER_FILES = [
  'bl760DuplicateChainGuard.property.test.js',
  'bl787NamedTunnelInvariants.property.test.js',
  'bl797MutationGateProbeCrashFallback.property.test.js',
  'onboarderLauncherPidGuard.property.test.js',
].map((f) => path.join(TEST_DIR, f));

function readTestTimeout(configSource) {
  const m = /testTimeout\s*:\s*(\d+)/.exec(configSource);
  return m ? Number(m[1]) : undefined;
}

// ─── Invariant 2 (the extraction): "The shared heavy-subprocess timeout
// value is declared exactly once and imported by every user." ───
//
// Part A: the pure checker, fuzzed. Generator reach: declaresLocal and
// importsShared are drawn independently, so all four presence/absence
// combinations are reachable, never just the "everything correct" happy
// path - this is what makes the checker's discrimination non-vacuous
// (verified by hand before landing: flipping usesSharedHeavyTimeoutOnly's
// `&&` to `||` makes this property fail immediately on the
// declaresLocal=true/importsShared=true case).
const quoteArb = fc.constantFrom("'", '"');
const noiseLineArb = fc.constantFrom('// noise', 'const OTHER = 1;', '');
const noiseLinesArb = fc.array(noiseLineArb, { minLength: 0, maxLength: 4 });

function buildSource({ declaresLocal, importsShared, quote, before, after }) {
  const lines = [...before];
  if (importsShared) {
    lines.push(`const { ${CONSTANT_NAME} } = require(${quote}./helpers/subprocessHeavyTimeout${quote});`);
  }
  if (declaresLocal) {
    lines.push(`const ${CONSTANT_NAME} = 240000;`);
  }
  lines.push(...after);
  return lines.join('\n');
}

test('property: a test file uses the shared timeout only when it imports the shared module and declares no local copy', () => {
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), quoteArb, noiseLinesArb, noiseLinesArb, (declaresLocal, importsShared, quote, before, after) => {
      const source = buildSource({ declaresLocal, importsShared, quote, before, after });
      assert.equal(declaresLocalConstant(source), declaresLocal);
      assert.equal(importsSharedHeavyTimeout(source), importsShared);
      assert.equal(usesSharedHeavyTimeoutOnly(source), importsShared && !declaresLocal);
    }),
    { numRuns: 100 }
  );
});

// Part B: the real files, an exhaustive discrete domain (same shape as
// bl643's own no-role-prompt-agent domain) - every current adopter must
// pass, and exactly one file across the lane may declare the constant.
test('property: every real adopter file imports the shared constant and declares no local copy', () => {
  fc.assert(
    fc.property(fc.constantFrom(...ADOPTER_FILES), (file) => {
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(usesSharedHeavyTimeoutOnly(source), `expected ${file} to import ${CONSTANT_NAME} from the shared helper and declare no local copy`);
    }),
    { numRuns: ADOPTER_FILES.length * 5 }
  );
});

test('property: exactly one file across the property lane declares the shared constant, and it is the shared helper', () => {
  const candidates = [
    ...fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.js')).map((f) => path.join(TEST_DIR, f)),
    ...fs.readdirSync(HELPERS_DIR).filter((f) => f.endsWith('.js')).map((f) => path.join(HELPERS_DIR, f)),
  ];
  const declarers = candidates.filter((f) => declaresLocalConstant(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(declarers, [HELPER_FILE], `expected the shared helper to be the only declaration of ${CONSTANT_NAME}, found: ${JSON.stringify(declarers)}`);
});

// ─── Invariant 1: "The property lane's suite-wide testTimeout in
// vitest.properties.config.mjs is unchanged by this ticket. The fix is
// per-test headroom, never a lane-wide raise." ───
test('property: the property lane config still declares its suite-wide default at 20000ms, and the unit lane carries no trace of this fix', () => {
  const propertiesSource = fs.readFileSync(PROPERTIES_CONFIG_PATH, 'utf8');
  assert.equal(
    readTestTimeout(propertiesSource),
    20000,
    'expected vitest.properties.config.mjs testTimeout to remain 20000ms - BL-932 fixes per-test headroom, never the lane-wide default'
  );
  const unitSource = fs.readFileSync(UNIT_CONFIG_PATH, 'utf8');
  assert.ok(
    !unitSource.includes(CONSTANT_NAME),
    "expected the unit lane config to carry no trace of the heavy-subprocess constant - that lane is not this ticket's scope"
  );
});

test('property: the lane-default reader is non-vacuous - a fabricated lane-wide raise is caught', () => {
  const mutated = "testTimeout: 240000,\n";
  assert.notEqual(readTestTimeout(mutated), 20000, 'sanity: the extractor must distinguish a lane-wide raise from the real 20000ms value');
  const real = fs.readFileSync(PROPERTIES_CONFIG_PATH, 'utf8');
  assert.equal(readTestTimeout(real), 20000, 'the real config unexpectedly failed the check that the mutated one correctly failed');
});
