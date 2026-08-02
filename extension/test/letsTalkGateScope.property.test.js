const assert = require('node:assert/strict');
const fc = require('fast-check');
const { liveImportedBaseNames, gateScopeMissingLiveSources } = require('../out/bridge/letsTalkGateScope');

// BL-766 declared invariant 2: "Retiring a surface removes or rewrites its
// route, its acceptance scenarios, and its quality-gate entry together - a
// surface still served by the bridge stays inside the coverage, CRAP and
// mutation scopes that guard it."
//
// The acceptance feature (BL-766 gate-scope-03/04) pins this at exactly two
// named examples (the Mini App page source, the routes source). Those don't
// vary which basenames are actually imported, how many candidates exist, or
// which subset the gate scope currently covers - so they can't tell us the
// checker generalizes past the two shapes someone thought to name in the
// Examples table. This property fuzzes an arbitrary set of candidate
// basenames, an arbitrary "live" subset (imported from bridgeServer-shaped
// source text) and an arbitrary gate-scope list, and proves the checker
// reports exactly the live-but-ungated set - never a subset, never a
// superset - matching the BL-714/BL-771 raw-mkdtemp-guard property shape
// this repo already uses for "does a checker generalize" invariants.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const baseNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,16}$/);
const candidateSetArb = fc.uniqueArray(baseNameArb, { minLength: 1, maxLength: 8 });

function importLine(name) {
  return `import { thing } from './${name}';`;
}

function sourceTextFor(liveNames, noiseNames) {
  const lines = [
    ...liveNames.map(importLine),
    ...noiseNames.map((n) => `// not imported: ${n}`),
    'export function unrelated() { return 1; }',
  ];
  return lines.join('\n');
}

test('reports exactly the live-but-ungated sources - never a subset, never a superset', () => {
  fc.assert(
    fc.property(
      candidateSetArb,
      fc.integer({ min: 0, max: 1000 }),
      (candidates, seed) => {
        // Deterministic-but-varied split of candidates into "live" (imported)
        // vs "not live" (mentioned only in a comment), driven by the seed.
        const live = candidates.filter((_, i) => (seed >> i) % 2 === 1);
        const notLive = candidates.filter((c) => !live.includes(c));
        const source = sourceTextFor(live, notLive);

        assert.deepEqual(
          [...liveImportedBaseNames(source, candidates)].sort(),
          [...live].sort()
        );

        // Gate scope covers a seed-driven subset of the LIVE names only -
        // the rest of `live` is the expected "missing" set.
        const gated = live.filter((_, i) => (seed >> (i + 8)) % 2 === 1);
        const gateScopeRelPaths = gated.map((n) => `src/bridge/${n}.ts`);
        const expectedMissing = live.filter((n) => !gated.includes(n));

        const missing = gateScopeMissingLiveSources(source, gateScopeRelPaths, candidates, 'src/bridge/');
        assert.deepEqual(
          missing.map((p) => p.replace(/^src\/bridge\//, '').replace(/\.ts$/, '')).sort(),
          expectedMissing.sort()
        );
      }
    ),
    { numRuns: 60 }
  );
});

test('a candidate never imported is never reported missing, regardless of gate scope', () => {
  fc.assert(
    fc.property(candidateSetArb, (candidates) => {
      // None of the candidates are imported - source only has noise.
      const source = sourceTextFor([], candidates);
      const missing = gateScopeMissingLiveSources(source, [], candidates, 'src/bridge/');
      assert.deepEqual(missing, []);
    }),
    { numRuns: 40 }
  );
});

test('every live source already in the gate scope is never reported missing', () => {
  fc.assert(
    fc.property(candidateSetArb, (candidates) => {
      const source = sourceTextFor(candidates, []);
      const gateScopeRelPaths = candidates.map((n) => `src/bridge/${n}.ts`);
      const missing = gateScopeMissingLiveSources(source, gateScopeRelPaths, candidates, 'src/bridge/');
      assert.deepEqual(missing, []);
    }),
    { numRuns: 40 }
  );
});
