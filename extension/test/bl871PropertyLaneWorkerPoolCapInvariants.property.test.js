'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runManyAsPropertyLaneFixtures } = require('./helpers/propertyLaneFixtureRunner');
const { maxConcurrentSpans } = require('./helpers/maxConcurrentSpans');
const { importsSharedBudgetModule, hasHardcodedMaxForks, hasHardcodedHeapSize, readsSharedWorkerBudgetOnly } = require('./helpers/workerPoolConfigGuard');
const { resolveWorkerPoolSize, PER_WORKER_HEAP_MB } = require('../out/tools/vitest-worker-memory-budget');

// BL-871 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).

// ─── Invariant 1: "The property lane's verdict for a given file does not
// depend on how many other property files are running alongside it." ───
//
// This is a process-level guarantee (the pool cap must actually bound what
// a worker can do, not a pure module) - proven here by running real fixture
// files through the REAL vitest.properties.config.mjs
// (runManyAsPropertyLaneFixtures), the same "temporarily add a property
// test... remove the probe afterwards" procedure BL-868's own steps used.
// Two independent, directly-observable signals, both read from each
// worker's own process rather than re-deriving the config's numbers:
//   (a) the per-worker V8 heap ceiling every file sees stays at the
//       resolved cap regardless of how many files run together - this is
//       what actually stops the BL-422 OOM-under-load failure mode, and it
//       is a large, host-independent signal (measured ~1328MB fixed vs
//       ~2096MB with no execArgv cap on this 8192MB/4-CPU host - nowhere
//       near the tolerance band below), unlike raw worker-process counts,
//       which this host's own default pool sizing can coincidentally match
//       even when unbounded.
//   (b) the number of workers alive at any single instant never exceeds
//       the resolved ceiling, measured via a wall-clock sweep line over
//       each file's own recorded start/end (maxConcurrentSpans) - proven
//       to actually discriminate a wrong cap (verified manually against a
//       deliberately mis-set maxForks before this test was written: the
//       same measurement read 6 concurrent workers against a maxForks:6
//       config, vs. 3 here).
// Generator reach: fileCount is drawn well above the resolved worker
// ceiling every run (never at or below it), so the pool is always under
// enough pressure that an unbounded config would both queue-skip (more
// workers than the ceiling) and drift in heap ceiling - a fileCount that
// never exceeds the ceiling could pass vacuously even on a broken config.
const HOST_RAM_MB = os.totalmem() / (1024 * 1024);
const WORKER_POOL_SIZE = resolveWorkerPoolSize(HOST_RAM_MB);
const BUSY_MS = 700;
// V8's own heap accounting adds overhead beyond the requested
// --max-old-space-size (measured ~4% on this host) - 1.15x leaves that
// margin while sitting far below what an uncapped worker reports (~1.6x).
const HEAP_TOLERANCE = 1.15;

function buildLoadFixture(resultFile, index) {
  return [
    "'use strict';",
    "const fs = require('node:fs');",
    "const v8 = require('node:v8');",
    '',
    `test('records-load-${index}', () => {`,
    '  const start = Date.now();',
    `  while (Date.now() - start < ${BUSY_MS}) {}`,
    '  const end = Date.now();',
    '  const heapLimitMB = v8.getHeapStatistics().heap_size_limit / (1024 * 1024);',
    `  fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ start, end, heapLimitMB }));`,
    '});',
    '',
  ].join('\n');
}

test(
  'property (BL-871 invariant 1): a file\'s worker-process ceiling (heap and concurrency) stays fixed no matter how many property files run alongside it',
  () => {
    fc.assert(
      fc.property(fc.integer({ min: WORKER_POOL_SIZE + 3, max: WORKER_POOL_SIZE + 7 }), (fileCount) => {
        const resultsDir = mkTmpDir('bl871-invariant1-');
        const resultFiles = Array.from({ length: fileCount }, (_, i) => path.join(resultsDir, `f-${i}.json`));
        const sources = resultFiles.map((resultFile, i) => buildLoadFixture(resultFile, i));

        const result = runManyAsPropertyLaneFixtures(sources, { timeout: 60000 });
        assert.equal(result.status, 0, `expected all ${fileCount} fixture files to pass:\n${result.output}`);

        const records = resultFiles.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));

        const peakConcurrent = maxConcurrentSpans(records);
        assert.ok(
          peakConcurrent <= WORKER_POOL_SIZE,
          `expected at most ${WORKER_POOL_SIZE} worker processes alive at once across ${fileCount} files, observed ${peakConcurrent}`
        );

        for (const { heapLimitMB } of records) {
          assert.ok(
            heapLimitMB <= PER_WORKER_HEAP_MB * HEAP_TOLERANCE,
            `expected every file's heap ceiling to stay near ${PER_WORKER_HEAP_MB}MB regardless of fileCount=${fileCount}, saw ${heapLimitMB}MB`
          );
        }
      }),
      { numRuns: 3 }
    );
  },
  120000
);

// ─── Invariant 2: "Neither lane carries its own copy of the worker
// ceiling or heap numbers: both read the one shared budget module, so a
// change to the caps cannot apply to one lane and not the other." ───
//
// A pure, testable module (workerPoolConfigGuard.js) does the actual
// check; this property fuzzes varied config-source shapes (quote style,
// surrounding noise, which piece is hardcoded) so the guarantee covers
// "any vitest config's source text", not just the one real file the
// BL-871-property-lane-worker-pool-cap-02 acceptance scenario pins.
// Generator reach: each of the three booleans (imports the module,
// hardcodes maxForks, hardcodes the heap size) is drawn independently, so
// every one of the eight presence/absence combinations is reachable, never
// just the "everything correct" happy path.
const quoteArb = fc.constantFrom("'", '"');
const noiseLineArb = fc.constantFrom('// a comment', 'testTimeout: 20000,', '');
const noiseLinesArb = fc.array(noiseLineArb, { minLength: 0, maxLength: 4 });

function buildConfigSource({ importsModule, hardcodeMaxForks, hardcodeHeap, quote, before, after }) {
  const lines = ["import { defineConfig } from 'vitest/config';"];
  if (importsModule) {
    lines.push(`const { resolveWorkerPoolSize, PER_WORKER_HEAP_MB } = require(${quote}./out/tools/vitest-worker-memory-budget${quote});`);
  }
  lines.push(...before);
  lines.push('export default defineConfig({', '  test: {');
  lines.push(`    maxForks: ${hardcodeMaxForks ? '3' : 'WORKER_POOL_SIZE'},`);
  const heapExpr = hardcodeHeap ? '--max-old-space-size=1280' : '--max-old-space-size=${PER_WORKER_HEAP_MB}';
  lines.push(`    execArgv: [${quote}${heapExpr}${quote}],`);
  lines.push('  },', '});', ...after);
  return lines.join('\n');
}

test('property (BL-871 invariant 2): a config reads the shared budget module iff its source imports both symbols and hardcodes neither number', () => {
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      quoteArb,
      noiseLinesArb,
      noiseLinesArb,
      (importsModule, hardcodeMaxForks, hardcodeHeap, quote, before, after) => {
        const source = buildConfigSource({ importsModule, hardcodeMaxForks, hardcodeHeap, quote, before, after });

        assert.equal(importsSharedBudgetModule(source), importsModule);
        assert.equal(hasHardcodedMaxForks(source), hardcodeMaxForks);
        assert.equal(hasHardcodedHeapSize(source), hardcodeHeap);
        assert.equal(readsSharedWorkerBudgetOnly(source), importsModule && !hardcodeMaxForks && !hardcodeHeap);
      }
    ),
    { numRuns: 100 }
  );
});
