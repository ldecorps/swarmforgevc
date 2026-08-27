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

// Hardener 2026-07-17: SRC_TS_PATTERN's own anchors are load-bearing, not
// decorative - each end of the regex has a genuinely distinguishing input,
// but every test above only drove strings that already sit safely inside
// both anchors, so a mutant that dropped either one still passed. Prove
// each anchor with the ONE input that only a correctly-anchored regex
// rejects.

test('mapToOutPath: the trailing $ anchor rejects a .tsx file - a bare .ts suffix match is not enough', () => {
  // Without the trailing $, `(.+)\.ts` is satisfied by the "foo.ts" PREFIX
  // of "foo.tsx" (greedy .+ backtracks to find literal ".ts" anywhere,
  // then stops caring what follows) - silently mis-mapping a TSX file as
  // if it were the .ts module one directory up.
  assert.equal(mapToOutPath('extension/src/quality/foo.tsx'), 'extension/src/quality/foo.tsx');
});

test('mapToOutPath: the leading ^ anchor rejects "src/" appearing mid-string, not at a real path-segment boundary', () => {
  // 'resrc/foo.ts' contains the literal substring "src/" (chars 2-5) but
  // is NOT a real src/-prefixed path - without ^, a scan-anywhere match
  // finds that embedded "src/" and wrongly treats "resrc/foo.ts" as if it
  // were a compilable source file.
  assert.equal(mapToOutPath('resrc/foo.ts'), 'resrc/foo.ts');
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

// Hardener 2026-07-17: the control test above proves the OUTCOME (siteCount
// 0) but not the MECHANISM - the downstream `counts[outPath] ?? 0` fallback
// in this same function coincidentally produces 0 even if the "skip files
// with no readable content" guard were forced to always pass, because the
// fake's own countMutantsPerFile then just returns undefined for the
// never-registered key. Prove the guard directly: a file with no compiled
// content must never even be OFFERED to countMutantsPerFile in the first
// place - the real @stryker-mutator/instrumenter this adapter wraps in
// production expects real string content for every file, not undefined.
test('mutation-site-size-gate-02 guard: a file with no readable out/ content is filtered out before reaching countMutantsPerFile at all', async () => {
  const seenPaths = [];
  const adapters = {
    readOutFile: (outPath) => (outPath === 'extension/out/quality/present.js' ? 'content' : undefined),
    countMutantsPerFile: async (files) => {
      seenPaths.push(...files.map((f) => f.path));
      return { 'extension/out/quality/present.js': 5 };
    },
  };

  await countMutationSites(['extension/src/quality/present.ts', 'extension/src/quality/missing.ts'], adapters);

  assert.deepEqual(seenPaths, ['extension/out/quality/present.js']);
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
