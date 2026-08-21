const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  runAsPropertyLaneFixture,
  runManyAsPropertyLaneFixtures,
  sweepStaleFixtures,
} = require('./helpers/propertyLaneFixtureRunner');

// BL-984 declared invariants (coder-authored first, BL-654):
//
//   1. "A property-lane fixture run's verdict is decided only by fixtures
//      that run wrote itself - a file left behind by any earlier run never
//      contributes to it."
//   2. "The sweep removes only files carrying the helper's own basename
//      prefix in the helper's own fixture directory, and only those whose
//      originating run is gone."
//
// Generator reach is constructive, not hoped-for. Invariant 2 quantifies
// over directory populations: each population is BUILT from typed entries
// (claimable strand / live-peer fixture / sibling-prefix strand /
// unprefixed human file / prefixed-but-malformed name), so every category
// the invariant discriminates is reached by construction and its count is
// asserted as a floor. Aliveness is part of the constructed truth - a
// pid's liveness is decided by the generator and injected, never sampled
// from the host. That injection scopes these properties to the sweep's
// DISCRIMINATION given an aliveness oracle; the oracle itself (including
// the zombie case - kill(pid, 0) succeeds on a SIGKILLed-but-unreaped
// process) is pinned by real-process unit tests in
// bl984SweepStaleFixtures.test.js, which is where a host-dependent probe
// belongs. Invariant 1 quantifies over runs against pre-strewn
// directories: strand pids are constructed dead-by-range (far beyond any
// real pid table) because the entry points use the REAL aliveness check,
// and the spawn seam records exactly which files the child was pointed
// at - the verdict's entire input - plus the directory as the child saw
// it, so "never contributes" is checked against the run's real target
// list, not inferred from a green exit.

const TEST_DIR = __dirname;
const PREFIXES = ['bl868-fixture-', 'bl871-fixture-'];
// Far beyond any real pid table (macOS pid_max ~99998, Linux ~4M default):
// process.kill(pid, 0) on these raises ESRCH/ERANGE, never EPERM.
const DEAD_PID_BASE = 99000000;

// ── Invariant 2: sweep scope ────────────────────────────────────────────

const arbEntryType = fc.constantFrom('claimable', 'livePeer', 'siblingPrefix', 'unprefixed', 'malformed');

const arbPopulation = fc.record({
  targetPrefix: fc.constantFrom(...PREFIXES),
  entries: fc.array(fc.record({ type: arbEntryType, indexed: fc.boolean() }), { minLength: 0, maxLength: 10 }),
});

function buildPopulation(dir, { targetPrefix, entries }) {
  const siblingPrefix = PREFIXES.find((p) => p !== targetPrefix);
  const alivePids = new Set();
  const built = entries.map((entry, i) => {
    const suffix = entry.indexed ? `-${i}` : '';
    // Even pid offsets are constructed-alive, odd are constructed-dead;
    // liveness truth lives in alivePids, injected below - the sweep's
    // discrimination is tested against the constructed truth, not the host.
    const deadPid = DEAD_PID_BASE + i * 2 + 1;
    const alivePid = DEAD_PID_BASE + i * 2;
    let name;
    let mustSurvive;
    switch (entry.type) {
      case 'claimable':
        name = `${targetPrefix}${deadPid}-s${i}${suffix}.property.test.js`;
        mustSurvive = false;
        break;
      case 'livePeer':
        alivePids.add(alivePid);
        name = `${targetPrefix}${alivePid}-s${i}${suffix}.property.test.js`;
        mustSurvive = true;
        break;
      case 'siblingPrefix':
        name = `${siblingPrefix}${deadPid}-s${i}${suffix}.property.test.js`;
        mustSurvive = true;
        break;
      case 'unprefixed':
        name = `human-authored-${i}.property.test.js`;
        mustSurvive = true;
        break;
      case 'malformed':
        name = `${targetPrefix}notapid-s${i}.property.test.js`;
        mustSurvive = true;
        break;
      default:
        throw new Error(`unknown entry type ${entry.type}`);
    }
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, "test('planted', () => {});\n");
    return { ...entry, filePath, mustSurvive };
  });
  return { built, isPidAlive: (pid) => alivePids.has(pid) };
}

test('property: the sweep removes exactly the claimable strands - never a live peer, sibling prefix, unprefixed, or malformed file', () => {
  const reached = { claimable: 0, livePeer: 0, siblingPrefix: 0, unprefixed: 0, malformed: 0 };
  fc.assert(
    fc.property(arbPopulation, (population) => {
      const dir = mkTmpDir('bl984-prop-');
      const { built, isPidAlive } = buildPopulation(dir, population);
      for (const b of built) {
        reached[b.type]++;
      }
      const removed = sweepStaleFixtures({ basenamePrefix: population.targetPrefix, dir, isPidAlive });
      const expectedRemoved = built.filter((b) => !b.mustSurvive).map((b) => b.filePath);
      assert.deepEqual(removed.sort(), expectedRemoved.sort(), 'removed exactly the claimable strands');
      for (const b of built) {
        assert.equal(fs.existsSync(b.filePath), b.mustSurvive, `${path.basename(b.filePath)} (${b.type})`);
      }
    }),
    { numRuns: 200 }
  );
  for (const [type, count] of Object.entries(reached)) {
    assert.ok(count >= 50, `reachability floor: entry type "${type}" built only ${count} times across 200 runs`);
  }
});

// ── Invariant 1: the verdict's input is exactly the run's own fixtures ──

const arbRunSpec = fc.record({
  entryPoint: fc.constantFrom('single', 'many'),
  sourceCount: fc.integer({ min: 1, max: 3 }),
  strands: fc.array(fc.record({ samePrefix: fc.boolean() }), { minLength: 1, maxLength: 4 }),
});

let strandCounter = 0;

test('property: a run is spawned on exactly the files it wrote - a pre-existing strand never reaches the child, whatever prefix it carries', () => {
  const reached = { samePrefix: 0, otherPrefix: 0, many: 0 };
  fc.assert(
    fc.property(arbRunSpec, (spec) => {
      const runPrefix = spec.entryPoint === 'single' ? 'bl868-fixture-' : 'bl871-fixture-';
      const otherPrefix = PREFIXES.find((p) => p !== runPrefix);
      const planted = spec.strands.map((s, i) => {
        const prefix = s.samePrefix ? runPrefix : otherPrefix;
        reached[s.samePrefix ? 'samePrefix' : 'otherPrefix']++;
        const filePath = path.join(TEST_DIR, `${prefix}${DEAD_PID_BASE + i}-p${strandCounter++}.property.test.js`);
        fs.writeFileSync(filePath, "test('stranded - must never run', () => { throw new Error('a strand reached the lane'); });\n");
        return { ...s, filePath };
      });
      try {
        const record = [];
        const spawnFn = (cmd, args) => {
          record.push({ args, dirListing: fs.readdirSync(TEST_DIR) });
          return { status: 0, stdout: '', stderr: '' };
        };
        const sources = Array.from({ length: spec.sourceCount }, (_, i) => `test('own ${i}', () => {});\n`);
        if (spec.entryPoint === 'single') {
          runAsPropertyLaneFixture(sources[0], { spawnFn });
        } else {
          reached.many++;
          runManyAsPropertyLaneFixtures(sources, { spawnFn });
        }
        assert.equal(record.length, 1);
        const targets = record[0].args.filter((a) => a.endsWith('.property.test.js'));
        const expectedCount = spec.entryPoint === 'single' ? 1 : spec.sourceCount;
        assert.equal(targets.length, expectedCount, 'the child is pointed at exactly the files this run wrote');
        for (const t of targets) {
          assert.ok(t.startsWith(`test/${runPrefix}${process.pid}-`), `target ${t} is a file this run wrote`);
          assert.ok(!planted.some((p) => path.basename(p.filePath) === path.basename(t)), 'a strand never appears in the target list');
        }
        for (const p of planted.filter((s) => s.samePrefix)) {
          assert.ok(!record[0].dirListing.includes(path.basename(p.filePath)), 'a same-prefix strand is swept before the child could see it');
          assert.equal(fs.existsSync(p.filePath), false);
        }
      } finally {
        planted.forEach((p) => fs.rmSync(p.filePath, { force: true }));
      }
    }),
    { numRuns: 100 }
  );
  assert.ok(reached.samePrefix >= 40, `reachability floor: same-prefix strands built only ${reached.samePrefix} times`);
  assert.ok(reached.otherPrefix >= 40, `reachability floor: other-prefix strands built only ${reached.otherPrefix} times`);
  assert.ok(reached.many >= 20, `reachability floor: the multi-fixture entry point ran only ${reached.many} times`);
});
