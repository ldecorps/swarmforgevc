'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { REQUIRED_SETUP_BASENAMES, findMissingIsolationGuards, configRegistersIsolationGuards } = require('./helpers/isolationSetupFilesGuard');
const { runAsPropertyLaneFixture } = require('./helpers/propertyLaneFixtureRunner');

// BL-868 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).

// ─── Invariant 2: "Every Vitest configuration that executes test files
// registers the shared isolation guards; a lane cannot exist without them." ───
//
// A pure, testable module (isolationSetupFilesGuard.js) does the actual
// check; this property fuzzes varied config-source shapes (quote style,
// path prefix, surrounding noise, which of the two guards is present) so
// the guarantee covers "any vitest config's source text", not just the two
// real files pinned by the BL-868-property-lane-isolation-guards-04
// acceptance scenario. Generator reach: presence of EACH required basename
// is drawn independently, so every one of the four presence/absence
// combinations (both present, either missing alone, both missing) is a
// reachable case, never just the "both present" happy path.
const quoteArb = fc.constantFrom("'", '"');
const pathPrefixArb = fc.constantFrom('./test/helpers/', 'test/helpers/', '../test/helpers/', './helpers/');
const noiseLineArb = fc.constantFrom('// a comment', 'const WORKER_POOL_SIZE = 4;', 'testTimeout: 20000,', '');
const noiseLinesArb = fc.array(noiseLineArb, { minLength: 0, maxLength: 4 });
const presenceArb = fc.tuple(fc.boolean(), fc.boolean());

function buildConfigSource({ presence, quote, pathPrefix, before, after, includeDecoyEntry }) {
  const entries = REQUIRED_SETUP_BASENAMES.filter((_, i) => presence[i]).map((basename) => `${quote}${pathPrefix}${basename}${quote}`);
  if (includeDecoyEntry) {
    entries.push(`${quote}${pathPrefix}someUnrelatedSetup.js${quote}`);
  }
  const setupFilesLine = entries.length > 0 ? `    setupFiles: [${entries.join(', ')}],` : '';
  return [
    "import { defineConfig } from 'vitest/config';",
    ...before,
    'export default defineConfig({',
    '  test: {',
    setupFilesLine,
    "    include: ['test/**/*.property.test.js'],",
    '  },',
    '});',
    ...after,
  ].join('\n');
}

test('property (BL-868 invariant 2): a config registers the guards iff its source names both required basenames, regardless of formatting', () => {
  fc.assert(
    fc.property(presenceArb, quoteArb, pathPrefixArb, noiseLinesArb, noiseLinesArb, fc.boolean(), (presence, quote, pathPrefix, before, after, includeDecoyEntry) => {
      const source = buildConfigSource({ presence, quote, pathPrefix, before, after, includeDecoyEntry });
      const expectedMissing = REQUIRED_SETUP_BASENAMES.filter((_, i) => !presence[i]);

      assert.deepEqual(findMissingIsolationGuards(source).sort(), expectedMissing.sort());
      assert.equal(configRegistersIsolationGuards(source), expectedMissing.length === 0);
    }),
    { numRuns: 60 }
  );
});

// ─── Invariant 1: "A property test leaves the host no state it did not
// find - no temp directory it created and no process.env key it changed
// survives the run." ───
//
// This is a process-level guarantee (the WIRING must actually intervene
// when a property test leaks), not a pure module - it is proven here by
// generating real leaky property-test files and running them through the
// REAL vitest.properties.config.mjs (runAsPropertyLaneFixture), the same
// "temporarily add a property test... remove the probe afterwards"
// procedure BL-868's own qa_e2e_procedure describes for manual
// verification. Generator reach: the leaked env key/value and the leaked
// temp-dir prefix are freshly randomized per run, so a pass can never be
// explained by "the guard happens to know this one hardcoded key/prefix".
const identifierArb = fc.stringMatching(/^[A-Z][A-Z0-9_]{2,16}$/);
const valueArb = fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !/[\n\0]/.test(s));

test(
  'property (BL-868 invariant 1a): a property test that leaves a process.env key changed fails the run and the failure names that key',
  () => {
    fc.assert(
      fc.property(identifierArb, valueArb, (suffix, value) => {
        const key = `BL868_LEAK_PROBE_${suffix}`;
        const source = ["'use strict';", '', `test('leaky-env-${suffix}', () => {`, `  process.env['${key}'] = ${JSON.stringify(value)};`, '});', ''].join('\n');

        const result = runAsPropertyLaneFixture(source);

        assert.notEqual(result.status, 0, `expected the run to fail when ${key} leaks:\n${result.output}`);
        assert.ok(result.output.includes('[env-restore-guard]'), `expected the env-restore guard's own tag in the failure:\n${result.output}`);
        assert.ok(result.output.includes(key), `expected the failure to name the leaked key ${key}:\n${result.output}`);
      }),
      { numRuns: 5 }
    );
  },
  60000
);

test(
  'property (BL-868 invariant 1b): a temp directory a property test creates through the shared helper does not survive the run',
  () => {
    const resultDir = mkTmpDir('bl868-invariant1b-side-channel-');

    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{2,10}-$/), (prefix) => {
        const resultFile = `${resultDir}/${prefix}result.json`;
        const source = [
          "'use strict';",
          "const fs = require('node:fs');",
          "const { mkTmpDir } = require('./helpers/tmpDir');",
          '',
          `test('leaky-dir-${prefix}', () => {`,
          `  const dir = mkTmpDir(${JSON.stringify(prefix)});`,
          `  fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ dir }));`,
          '});',
          '',
        ].join('\n');

        const result = runAsPropertyLaneFixture(source);
        assert.equal(result.status, 0, `expected a property test that only creates a swept temp dir to pass:\n${result.output}`);

        const { dir } = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        assert.ok(!fs.existsSync(dir), `expected ${dir} to have been swept by tmpDirSetup.js's afterEach, but it still exists`);
      }),
      { numRuns: 5 }
    );
  },
  60000
);
