const assert = require('node:assert/strict');
const { mapToOutPath, countMutationSites, verdictFor } = require('../out/quality/mutationSiteCount');

// BL-485: the count-only mutation-site helper - pure over an INJECTED
// mutant-counting adapter (mutation-site-count.ts's CLI wires the real
// @stryker-mutator/instrumenter). No live Stryker/instrumenter run in
// these tests - the real wiring is separately proven by
// mutationSiteCountCli.test.js's fixture-based subprocess test, per this
// codebase's own established TESTABLE-boundary split (see
// dependencyGate.test.js).

function fakeAdapters(countsByOutPath) {
  return {
    readOutFile: (outPath) => (outPath in countsByOutPath ? `// fixture content for ${outPath}` : undefined),
    countMutantsPerFile: async (files) => {
      const counts = {};
      for (const f of files) counts[f.path] = countsByOutPath[f.path];
      return counts;
    },
  };
}

// ── mapToOutPath ──────────────────────────────────────────────────────

test('mapToOutPath: a src/*.ts path maps to its out/*.js counterpart', () => {
  assert.equal(mapToOutPath('extension/src/quality/foo.ts'), 'extension/out/quality/foo.js');
});

test('mapToOutPath: a bare src/*.ts path (no prefix) still maps correctly', () => {
  assert.equal(mapToOutPath('src/tools/bar.ts'), 'out/tools/bar.js');
});

test('mapToOutPath: an already-compiled out/*.js path passes through unchanged', () => {
  assert.equal(mapToOutPath('extension/out/quality/foo.js'), 'extension/out/quality/foo.js');
});

test('mapToOutPath: a non-src file (e.g. a .bb script) passes through unchanged', () => {
  assert.equal(mapToOutPath('swarmforge/scripts/operator_lib.bb'), 'swarmforge/scripts/operator_lib.bb');
});

// ── countMutationSites (BL-485 mutation-site-size-gate-01) ──────────────

test('mutation-site-size-gate-01: reports a mutation-site count for each changed compiled file', async () => {
  const adapters = fakeAdapters({
    'extension/out/quality/a.js': 12,
    'extension/out/quality/b.js': 45,
  });

  const result = await countMutationSites(['extension/out/quality/a.js', 'extension/out/quality/b.js'], adapters);

  assert.deepEqual(
    result.map((r) => r.siteCount),
    [12, 45]
  );
});

// ── mutation-site-size-gate-02 ────────────────────────────────────────

test('mutation-site-size-gate-02: the count is taken from the compiled out/ file, not the TypeScript source', async () => {
  const adapters = fakeAdapters({ 'extension/out/quality/mapped.js': 30 });

  const result = await countMutationSites(['extension/src/quality/mapped.ts'], adapters);

  assert.equal(result.length, 1);
  assert.equal(result[0].outPath, 'extension/out/quality/mapped.js');
  assert.equal(result[0].siteCount, 30);
});

test('mutation-site-size-gate-02 control: a src path whose out/ file is never registered contributes zero sites, not a crash', async () => {
  const adapters = fakeAdapters({});

  const result = await countMutationSites(['extension/src/quality/missing.ts'], adapters);

  assert.equal(result[0].siteCount, 0);
});

// ── mutation-site-size-gate-03 ────────────────────────────────────────

test('mutation-site-size-gate-03: the helper is count-only - the result carries no test-execution/kill-status field at all', async () => {
  const adapters = fakeAdapters({ 'extension/out/quality/c.js': 20 });

  const result = await countMutationSites(['extension/out/quality/c.js'], adapters);

  assert.deepEqual(Object.keys(result[0]).sort(), ['file', 'outPath', 'siteCount']);
});

// ── verdictFor (mutation-site-size-gate-04) ──────────────────────────────

test('verdictFor: a count over the threshold is "over"', () => {
  assert.equal(verdictFor(150, 100), 'over');
});

test('verdictFor: a count under the threshold is "within"', () => {
  assert.equal(verdictFor(60, 100), 'within');
});

test('verdictFor: a count exactly AT the threshold is "within" (boundary-inclusive)', () => {
  assert.equal(verdictFor(100, 100), 'within');
});

test('verdictFor: a lower threshold flags a count that a higher one would not', () => {
  assert.equal(verdictFor(60, 50), 'over');
});
