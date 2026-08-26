'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { REQUIRED_SETUP_BASENAMES, findMissingIsolationGuards, configRegistersIsolationGuards } = require('./helpers/isolationSetupFilesGuard');
const { runManyAsPropertyLaneFixtures } = require('./helpers/propertyLaneFixtureRunner');

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
// REAL vitest.properties.config.mjs, the same "temporarily add a property
// test... remove the probe afterwards" procedure BL-868's own
// qa_e2e_procedure describes for manual verification. Generator reach: the
// leaked env key/value and the leaked temp-dir prefix are freshly
// randomized per run, so a pass can never be explained by "the guard
// happens to know this one hardcoded key/prefix".
//
// BL-971: each invariant's 5 generated cases ride ONE child vitest run
// (runManyAsPropertyLaneFixtures) instead of one child boot per case - the
// child boot, not the cases, is the dominant cost, and each case's
// assertion still lands on its own named key/prefix (index-suffixed for
// guaranteed distinctness), so nothing about the property weakens. Budget
// basis (measured 2026-08-20, swarm host): pre-BL-971 a child boot per
// case cost ~6s moderately loaded (whole file 61s, 10 boots) and ~12.6s
// under QA's full 8-agent load (126s total, the BL-971 failure); with one
// batched boot per invariant the whole file measured 22-31s over two
// consecutive live-load runs, ~10-15s per batched boot. 60s per-test
// budget = ~4x headroom over the measured loaded boot; the child spawn's
// own 45s timeout fails inside the test budget with output rather than as
// a silent wall-clock exhaustion.
const identifierArb = fc.stringMatching(/^[A-Z][A-Z0-9_]{2,16}$/);
const valueArb = fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !/[\n\0]/.test(s));
const CASES_PER_CHILD_RUN = 5;

test(
  'property (BL-868 invariant 1a): a property test that leaves a process.env key changed fails the run and the failure names that key',
  () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(identifierArb, valueArb), { minLength: CASES_PER_CHILD_RUN, maxLength: CASES_PER_CHILD_RUN }),
        (pairs) => {
          const cases = pairs.map(([suffix, value], i) => ({
            // Index-suffixed: 5 independent draws stay distinct by
            // construction, so each failure attributes to its own key.
            key: `BL868_LEAK_PROBE_${suffix}_C${i}`,
            value,
            name: `leaky-env-${suffix}-c${i}`,
          }));
          const sources = cases.map(({ key, value, name }) =>
            ["'use strict';", '', `test('${name}', () => {`, `  process.env['${key}'] = ${JSON.stringify(value)};`, '});', ''].join('\n')
          );

          const result = runManyAsPropertyLaneFixtures(sources, { basenamePrefix: 'bl868-fixture-', timeout: 45000 });

          assert.notEqual(result.status, 0, `expected the run to fail when env keys leak:\n${result.output}`);
          assert.ok(result.output.includes('[env-restore-guard]'), `expected the env-restore guard's own tag in the failure:\n${result.output}`);
          for (const { key } of cases) {
            assert.ok(result.output.includes(key), `expected the failure to name the leaked key ${key}:\n${result.output}`);
          }
        }
      ),
      { numRuns: 1 }
    );
  },
  60000
);

test(
  'property (BL-868 invariant 1b): a temp directory a property test creates through the shared helper does not survive the run',
  () => {
    const resultDir = mkTmpDir('bl868-invariant1b-side-channel-');

    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{2,10}-$/), { minLength: CASES_PER_CHILD_RUN, maxLength: CASES_PER_CHILD_RUN }),
        (rawPrefixes) => {
          const cases = rawPrefixes.map((raw, i) => ({
            // Index-suffixed for distinctness, same as invariant 1a.
            prefix: `${raw}c${i}-`,
            resultFile: `${resultDir}/${raw}c${i}-result.json`,
          }));
          const sources = cases.map(({ prefix, resultFile }) =>
            [
              "'use strict';",
              "const fs = require('node:fs');",
              "const { mkTmpDir } = require('./helpers/tmpDir');",
              '',
              `test('leaky-dir-${prefix}', () => {`,
              `  const dir = mkTmpDir(${JSON.stringify(prefix)});`,
              `  fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ dir }));`,
              '});',
              '',
            ].join('\n')
          );

          const result = runManyAsPropertyLaneFixtures(sources, { basenamePrefix: 'bl868-fixture-', timeout: 45000 });
          assert.equal(result.status, 0, `expected property tests that only create swept temp dirs to pass:\n${result.output}`);

          for (const { resultFile } of cases) {
            const { dir } = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
            assert.ok(!fs.existsSync(dir), `expected ${dir} to have been swept by tmpDirSetup.js's afterEach, but it still exists`);
          }
        }
      ),
      { numRuns: 1 }
    );
  },
  60000
);
