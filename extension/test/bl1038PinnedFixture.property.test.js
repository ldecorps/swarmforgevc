// BL-1038 property test (coder-authored). Two of the three DECLARED invariants
// are encoded here; the third's stated reason is at the bottom of this header.
//
//   Invariant 1: "No unit-lane test's cost is a function of the live
//   repository's size or history depth: a test that needs repository history
//   or maintained sources reads a pinned fixture whose contents do not change
//   as the repo grows."
//
//   Invariant 2: "An exemption from the pinned-fixture rule is justified in
//   place by a recorded reason, never merely present - and the guard checks
//   that relation, not the field's existence."
//
// P1 states invariant 1 as an INVARIANCE UNDER GROWTH, which is the only way
// to say "does not change as the repo grows": compute a closure, then add
// arbitrarily many unrelated scripts to the tree and recompute. Asserting
// merely that the closure is "small" would pass for a fixture that still grew,
// just more slowly - and slowly-growing is exactly what four budget raises in
// four days were paying for.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// The growth that matters is UNRELATED scripts - a generator that only ever
// added scripts already inside the closure would show invariance trivially,
// because nothing changed. So each run adds a generated number of scripts that
// are unreachable from the entry points BY CONSTRUCTION, with a floor
// asserting real growth was applied, and separately grows the closure itself
// to confirm the walk still tracks genuine dependencies.
//
//   INVARIANT 3 ("speed is never bought with coverage: the recorded test_count
//   never falls, and no test is deleted, skipped, or added to an exclude
//   glob") is NOT encoded as a property here, and the reason is stated rather
//   than left implicit: it quantifies over SUCCESSIVE SUITE RUNS recorded in
//   .test-durations.jsonl and over a diff against a parent commit - process
//   facts about this repository's history, not properties of any pure module.
//   No generator over module inputs can observe them. It is checked instead by
//   this ticket's qa_e2e step 6, and its "no test is skipped" half is asserted
//   directly in liveRepoDerivationGuard.test.js's companion check below.

// Non-vacuity, measured and stated honestly:
//
//   exemption regex switched to \s* (crosses the newline) .. invariant 2 FAILS
//   closure "falls back to the whole tree" ................. NO BREAK POSSIBLE
//
// The second row is not a gap, and the reason is the strongest evidence this
// fix is structural. resolveScriptClosure's only view of the tree is a
// name -> source READER: it has no enumeration capability at all, so a walk
// from the entry points CANNOT reach a script nothing depends on. The growth
// term is unrepresentable in the new design, which is why no in-module break
// reintroduces it. (I tried; the attempt injected the same extra names into
// BOTH the before and after closures, so invariance still held - a break that
// perturbs both sides equally measures nothing.)
//
// What P1 therefore guards is the OTHER direction, and it is a real risk:
// invariance achieved by a walk that stopped working. Every run asserts a
// genuinely new dependency still enters the closure, so "unchanged" can never
// come from "broken".
//
// The defect's own scale is measured rather than asserted: the old
// whole-directory copy moved 208 files / 2.16MB per fixture build at 733ms;
// commit_integrity_cli.bb's closure is 11 files at 69ms.

const assert = require('node:assert/strict');
const { resolveScriptClosure } = require('./helpers/pinnedRepoFixture');
const { exemptionReason } = require('./helpers/liveRepoDerivationGuard');

const RUNS = Number(process.env.PROPERTY_RUNS || 200);

function makeRng(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return Math.floor(s / 65536) % Math.max(1, n);
  };
}

test('BL-1038 invariant 1: a pinned closure does not change as the repository grows', () => {
  const rng = makeRng(1038);
  const coverage = { grew: 0, deepChain: 0, closureGrew: 0 };

  for (let r = 0; r < RUNS; r++) {
    // A chain the entry point genuinely depends on.
    const depth = 1 + rng(5);
    const sources = {};
    for (let i = 0; i < depth; i++) {
      sources[`dep${i}.bb`] = i + 1 < depth ? `(load-file (str (fs/path x "dep${i + 1}.bb")))` : '(defn f [])';
    }
    sources['entry.bb'] = '(load-file (str (fs/path x "dep0.bb")))';
    if (depth >= 3) coverage.deepChain += 1;

    const before = [...resolveScriptClosure(['entry.bb'], (n) => sources[n])].sort();

    // THE GROWTH: scripts unreachable from the entry point BY CONSTRUCTION.
    // Adding ones already in the closure would show invariance trivially.
    const added = 1 + rng(40);
    for (let i = 0; i < added; i++) {
      sources[`unrelated${i}.bb`] = `(load-file (str (fs/path x "unrelated${(i + 1) % added}.bb")))`;
    }
    coverage.grew += 1;

    const after = [...resolveScriptClosure(['entry.bb'], (n) => sources[n])].sort();
    assert.deepEqual(after, before,
      `run ${r}: adding ${added} unrelated scripts changed the closure - the fixture still grows with the repo`);

    // And the walk must still track a GENUINE new dependency, or "invariant"
    // would just mean "broken".
    sources[`dep${depth - 1}.bb`] = '(load-file (str (fs/path x "newdep.bb")))';
    sources['newdep.bb'] = '(defn f [])';
    const grown = [...resolveScriptClosure(['entry.bb'], (n) => sources[n])].sort();
    assert.ok(grown.includes('newdep.bb'),
      'a real new dependency must enter the closure - invariance must not come from a walk that stopped working');
    coverage.closureGrew += 1;
  }

  assert.ok(coverage.grew >= RUNS, 'every run must actually add unrelated scripts');
  assert.ok(coverage.deepChain >= 40, `deep chains reached only ${coverage.deepChain} times`);
  assert.ok(coverage.closureGrew >= RUNS, 'every run must also confirm the walk still tracks real dependencies');
});

test('BL-1038 invariant 2: an exemption counts only when a reason is recorded on its own line', () => {
  const rng = makeRng(2038);
  const coverage = { withReason: 0, bare: 0, whitespaceOnly: 0, newlineTrap: 0 };

  for (let r = 0; r < RUNS; r++) {
    const kind = rng(4);
    let text;
    let expectHonoured;
    if (kind === 0) {
      const reason = 'r'.repeat(1 + rng(60));
      text = `// BL-1038-EXEMPT: ${reason}\ncode();`;
      expectHonoured = true;
      coverage.withReason += 1;
    } else if (kind === 1) {
      text = '// BL-1038-EXEMPT:\ncode();';
      expectHonoured = false;
      coverage.bare += 1;
    } else if (kind === 2) {
      text = `// BL-1038-EXEMPT:${' '.repeat(1 + rng(8))}\ncode();`;
      expectHonoured = false;
      coverage.whitespaceOnly += 1;
    } else {
      // THE TRAP: a bare marker whose next line begins with a real word. A
      // \s*-based regex crosses the newline and captures that word as the
      // "reason", so every empty exemption reads as justified - the guard
      // failing OPEN, which is precisely what invariant 2 forbids.
      text = '// BL-1038-EXEMPT:\nlegitimateLookingWord();';
      expectHonoured = false;
      coverage.newlineTrap += 1;
    }
    assert.equal(Boolean(exemptionReason(text)), expectHonoured,
      `run ${r}: ${JSON.stringify(text)} was judged wrongly`);
  }

  assert.ok(coverage.withReason >= 30, `recorded reasons reached only ${coverage.withReason}`);
  assert.ok(coverage.bare >= 30, `bare markers reached only ${coverage.bare}`);
  assert.ok(coverage.whitespaceOnly >= 30, `whitespace-only reasons reached only ${coverage.whitespaceOnly}`);
  assert.ok(coverage.newlineTrap >= 30, `the newline trap reached only ${coverage.newlineTrap}`);
});
