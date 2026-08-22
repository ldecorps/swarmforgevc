// BL-1014 property test (coder-authored, THREE declared invariants).
//
//   Invariant 1 (deterministic): the same repository state produces the same
//   ranking. No clock, no randomness, no fresh judgement call in the rank key.
//   Invariant 2 (evidence-bearing): every ranked item names the concrete
//   artifact its rank came from, so a human can check it without re-running.
//   Invariant 3 (read-only): the scan mutates no source, config or runtime
//   state, and writes nothing but its own report.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// Determinism is only interesting where an implementation could legitimately
// differ, and that is at TIES - two subjects with the same source count, where
// an unstable sort or a Map-insertion-order dependence would show. Drawing
// subjects and sources independently makes exact ties rare, so ties are
// CONSTRUCTED: a generated share of subjects is given an identical source
// profile by construction, and a floor asserts the tie case was reached.
//
// The other reachable-but-rare state is INPUT ORDER. Two runs of the same
// process see the same order, so re-running alone cannot catch an
// order-dependent rank. Every case is therefore ranked twice - once as
// generated and once REVERSED - which is the only way an insertion-order
// dependence surfaces.
//
// Non-vacuity PROVEN at authoring time (2026-08-22), each break applied to the
// real source, compiled and restored:
//
//   sourceCount counts ROWS not distinct sources ..... invariants 1+2 FAIL
//   the scan writes a cache file ..................... invariant 3 FAIL
//   tie-break dropped from the sort .................. invariants 1+2 FAIL
//   a PARSER drops its artifact pointer .............. everything PASSED  <-- hole
//
// That last row was a real vacuity hole in THIS FILE, found by the
// non-vacuity pass rather than by reading it. Invariant 2 was asserted only
// over SYNTHETIC evidence built by generateEvidence, whose artifacts are
// populated by construction - so no parser could ever violate it. Emptying the
// artifact in parseHardeningLedger and parseCrapReport left every property
// green. The fix is P4 below: invariant 2 is now also asserted over the output
// of the REAL scan, which flows through the real parsers, so a parser that
// drops its pointer fails. Verified failing against that same break.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  EVIDENCE_SOURCES,
  mergeBySubject,
  rankInventory,
  renderReport,
  scan,
} = require('../out/tools/boyScoutScan');

const RUNS = Number(process.env.PROPERTY_RUNS || 200);

function makeRng(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return Math.floor(s / 65536) % Math.max(1, n);
  };
}

function generateEvidence(rng) {
  const subjectCount = 1 + rng(6);
  const evidence = [];
  // A fixed profile some subjects share EXACTLY, so ties exist by
  // construction rather than by coincidence.
  const tieProfile = [EVIDENCE_SOURCES[0], EVIDENCE_SOURCES[2]];
  let tied = 0;
  for (let i = 0; i < subjectCount; i++) {
    const subject = `s${i}.ts`;
    if (rng(3) === 0) {
      tied++;
      for (const source of tieProfile) {
        evidence.push({ subject, source, artifact: `art/${source}`, detail: `${subject} via ${source}` });
      }
    } else {
      const n = 1 + rng(EVIDENCE_SOURCES.length);
      for (let k = 0; k < n; k++) {
        const source = EVIDENCE_SOURCES[rng(EVIDENCE_SOURCES.length)];
        evidence.push({ subject, source, artifact: `art/${source}`, detail: `${subject} hit ${k}` });
      }
    }
  }
  return { evidence, tied };
}

test('BL-1014 invariants 1 and 2: ranking is deterministic and every item is evidence-bearing', () => {
  const rng = makeRng(1014);
  const coverage = { ties: 0, multiSource: 0, singleSource: 0, empty: 0 };

  for (let i = 0; i < RUNS; i++) {
    const { evidence, tied } = generateEvidence(rng);
    if (tied >= 2) coverage.ties++;
    if (evidence.length === 0) coverage.empty++;

    const forward = rankInventory(mergeBySubject(evidence));
    // REVERSED input: two runs in one process see the same order, so
    // re-running alone cannot catch an order-dependent rank.
    const reversed = rankInventory(mergeBySubject([...evidence].reverse()));

    // ── Invariant 1 ──
    assert.deepEqual(forward, reversed,
      `the same evidence in a different order must produce the same ranking (run ${i})`);
    assert.deepEqual(forward, rankInventory(mergeBySubject(evidence)),
      `ranking the same input twice must agree (run ${i})`);
    // The report text is what a human diffs between runs.
    assert.equal(renderReport({ ranked: forward, consulted: [] }),
                 renderReport({ ranked: reversed, consulted: [] }));

    // The ordering must actually be by recurrence, descending.
    for (let k = 1; k < forward.length; k++) {
      assert.ok(forward[k - 1].sourceCount >= forward[k].sourceCount,
        `rank must be non-increasing in source count (run ${i})`);
    }

    // ── Invariant 2 ──
    for (const item of forward) {
      assert.ok(item.evidence.length > 0, 'a ranked item with no evidence is a rank nobody can check');
      for (const e of item.evidence) {
        assert.ok(e.artifact && e.artifact.length > 0, 'every attestation must name an artifact');
        assert.ok(e.detail && e.detail.length > 0, 'and enough detail to find it inside that artifact');
      }
      assert.equal(item.sourceCount, new Set(item.evidence.map((e) => e.source)).size,
        'the rank key must equal the distinct sources actually attesting the item');
      if (item.sourceCount > 1) coverage.multiSource++; else coverage.singleSource++;
    }
  }

  assert.ok(coverage.ties >= 40, `constructed ties reached only ${coverage.ties} times`);
  assert.ok(coverage.multiSource >= 100, `multi-source items reached only ${coverage.multiSource} times`);
  assert.ok(coverage.singleSource >= 50, `single-source items reached only ${coverage.singleSource} times`);
});

test('BL-1014 invariant 3: the scan writes nothing, whatever the sources return', () => {
  const rng = makeRng(3014);
  const RUNS_3 = Math.min(RUNS, 40);
  let brokenSources = 0;

  for (let i = 0; i < RUNS_3; i++) {
    const root = mkTmpDir('bl1014-ro-');
    try {
      // A small real tree the scan could plausibly touch.
      fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'a.log'), 'x');
      fs.writeFileSync(path.join(root, 'source.ts'), 'export const a = 1;\n');

      const snapshot = () =>
        fs.readdirSync(root, { recursive: true }).sort().map((rel) => {
          const abs = path.join(root, String(rel));
          const st = fs.statSync(abs);
          return `${rel}:${st.isDirectory() ? 'd' : st.size}`;
        }).join('|');

      const before = snapshot();

      // Some runs make a source THROW - a broken source must not tempt the
      // scan into writing a cache or a placeholder to recover.
      const broken = rng(3) === 0;
      if (broken) brokenSources++;
      const readers = {
        hardeningLedger: () => { if (broken) throw new Error('ledger unreadable'); return []; },
        bounceLines: () => [],
        crapReport: () => (broken ? '' : 'src/a.ts\tfn\tc\tc\tCRAP=9  *** CRAP > 6 ***'),
        duplicationReport: () => '',
        countedPaths: () => [{ path: '.swarmforge/daemon', count: 999, threshold: 1 }],
      };

      const result = scan(root, readers);
      assert.equal(snapshot(), before, 'the scan must not create, delete or resize anything');

      // ── P4 (invariant 2, over the REAL parsers) ──
      // The evidence here came out of parseCrapReport / summarizeRuntimeBloat,
      // not out of a fixture - so a parser that forgets its artifact pointer
      // fails HERE, which the synthetic generator above cannot see.
      for (const item of result.ranked) {
        assert.ok(item.evidence.length > 0, 'a ranked item must carry evidence');
        for (const e of item.evidence) {
          assert.ok(e.artifact && e.artifact.trim().length > 0,
            `every attestation from a real parser must name an artifact; got ${JSON.stringify(e)}`);
          assert.ok(e.detail && e.detail.trim().length > 0,
            `and enough detail to locate it; got ${JSON.stringify(e)}`);
        }
      }
      // And it must still report every source, including the broken one.
      assert.equal(result.consulted.length, EVIDENCE_SOURCES.length,
        'every source is accounted for even when one could not be read');
      if (broken) {
        assert.ok(result.consulted.some((c) => !c.available),
          'a source that threw must be reported unavailable, never silently as clean');
      } else {
        // Without this, a scan that ranked NOTHING would satisfy P4 vacuously -
        // the same shape of hole P4 was added to close.
        assert.ok(result.ranked.length > 0,
          'the fixture must actually produce ranked items for P4 to mean anything');
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  assert.ok(brokenSources >= 5, `a throwing source reached only ${brokenSources} times`);
});
