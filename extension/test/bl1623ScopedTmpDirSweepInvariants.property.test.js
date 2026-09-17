'use strict';

// BL-1623 declared invariants (property authorship rests with the coder,
// first pass - BL-654), over the REAL sweepStaleTmpDirs helper
// (extension/test/helpers/tmpDir.js) against real mkdtemp roots - never a
// reimplementation of its removal decision.
//
//   Invariant 1: "A fixture sweep never removes a temp root a live run
//   owns: a root under the shared temp dir is removed only when its
//   recorded owner pid is not alive (or is this process's own pid, before
//   this run has written any root)."
//
//   Invariant 2: "A run that died without trapping anything still has its
//   roots cleared by the next run's sweep, however it died - scoping never
//   turns into leaking." Encoded as an AGGREGATE claim distinct from
//   invariant 1's per-root decision: however many dead-owner roots have
//   piled up (many past crashed runs, never swept between them), ONE
//   sweep call by the current live process clears ALL of them in a single
//   pass - a leak never needs N sweep calls to clear N generations of it.
//
// isPidAlive is injected (the helper's own signature) rather than spawning
// real processes per draw: a fake pid never collides with a real one this
// host might reuse mid-run, and the property is about the helper's own
// removal decision given a liveness answer, not about the OS's pid table.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { sweepStaleTmpDirs, mkTmpDir, mkSharedTmpDir } = require('./helpers/tmpDir');

const PREFIX = 'bl1623-inv-fixture-';

// 'own': this process's own pid (removed unconditionally, even if a caller's
//   isPidAlive would call it alive - the helper's own OR-first rule).
// 'alive': a fake pid the injected isPidAlive reports alive - must survive.
// 'dead': a fake pid the injected isPidAlive reports gone - must be removed.
// 'nopid': the pre-BL-1623 name shape, no pid segment at all - must survive
//   untouched (the helper never guesses at an unscoped name).
const pidKindArb = fc.constantFrom('own', 'alive', 'dead', 'nopid');
const rootArb = fc.record({ pidKind: pidKindArb, suffix: fc.stringMatching(/^[a-z0-9]{1,8}$/) });
const populationArb = fc.array(rootArb, { minLength: 0, maxLength: 12 });

// Builds one root name per entry under `dir`, pid derived from the entry's
// OWN index so two entries can never coincidentally share a fake pid (which
// would make an 'alive' and a 'dead' draw disagree about the same pid).
function materialize(dir, population) {
  const aliveSet = new Set();
  const entries = population.map((entry, i) => {
    let name;
    let expectRemoved;
    if (entry.pidKind === 'own') {
      // BL-1623 hardening: isPidAlive must explicitly say ALIVE for
      // process.pid here - without this, a fake isPidAlive that merely
      // never mentions process.pid (as an unset `aliveSet.has(...)` would)
      // reports it as not-alive anyway, and the 'own' case stops
      // distinguishing "removed because own-pid short-circuits before
      // consulting isPidAlive" from "removed because isPidAlive happened
      // to say dead" - the exact vacuity that let a mutant dropping the
      // `ownerPid === process.pid ||` clause survive undetected (hand-
      // confirmed: reverting to `if (!isPidAlive(ownerPid))` alone passed
      // this file before this fix, since aliveSet never contained
      // process.pid either way).
      aliveSet.add(process.pid);
      name = `${PREFIX}${process.pid}-${entry.suffix}-${i}`;
      expectRemoved = true;
    } else if (entry.pidKind === 'alive') {
      const fakePid = 500000 + i;
      aliveSet.add(fakePid);
      name = `${PREFIX}${fakePid}-${entry.suffix}-${i}`;
      expectRemoved = false;
    } else if (entry.pidKind === 'dead') {
      const fakePid = 500000 + i;
      name = `${PREFIX}${fakePid}-${entry.suffix}-${i}`;
      expectRemoved = true;
    } else {
      name = `${PREFIX}legacy-${entry.suffix}-${i}`;
      expectRemoved = false;
    }
    fs.mkdirSync(path.join(dir, name));
    return { name, expectRemoved };
  });
  return { entries, isPidAlive: (pid) => aliveSet.has(pid) };
}

describe('BL-1623 scoped temp-root sweep invariants (property)', () => {
  it('invariant 1: a root is removed iff its recorded pid is this process\'s own or not alive', () => {
    const coverage = {};
    fc.assert(
      fc.property(populationArb, (population) => {
        for (const entry of population) {
          coverage[entry.pidKind] = (coverage[entry.pidKind] || 0) + 1;
        }
        const dir = mkTmpDir('bl1623-inv1-');
        try {
          const { entries, isPidAlive } = materialize(dir, population);
          sweepStaleTmpDirs({ prefix: PREFIX, dir, isPidAlive });
          for (const { name, expectRemoved } of entries) {
            const exists = fs.existsSync(path.join(dir, name));
            assert.equal(
              exists,
              !expectRemoved,
              `${name}: expected removed=${expectRemoved}, got exists=${exists}`
            );
          }
          return true;
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
    // BL-654 generator-reach: every pid-kind row scenario 01 names is
    // demonstrably drawn, not merely hoped for.
    for (const kind of ['own', 'alive', 'dead', 'nopid']) {
      assert.ok((coverage[kind] || 0) > 0, `generator never drew a '${kind}' root`);
    }
  });

  it('invariant 2: however many dead-owner roots have piled up, one sweep clears all of them in a single pass', () => {
    const coverage = { generations: [] };
    // BL-654 generator-reach: zero and a substantial pile-up are each
    // forced to appear at meaningful weight rather than hoped for from an
    // unweighted range - a floor assertion must not depend on RNG luck.
    const generationCountArb = fc.oneof(
      { weight: 2, arbitrary: fc.constant(0) },
      { weight: 2, arbitrary: fc.integer({ min: 5, max: 10 }) },
      { weight: 6, arbitrary: fc.integer({ min: 0, max: 10 }) }
    );
    fc.assert(
      fc.property(generationCountArb, (deadGenerationCount) => {
        coverage.generations.push(deadGenerationCount);
        const dir = mkTmpDir('bl1623-inv2-');
        try {
          // Every entry here is a DEAD owner - simulating that many past
          // crashed runs' leftovers, none of them ever swept because
          // nothing has run since. isPidAlive reports every one of them
          // gone, and this process has not written its own root yet.
          const names = [];
          for (let i = 0; i < deadGenerationCount; i += 1) {
            const fakePid = 600000 + i;
            const name = `${PREFIX}${fakePid}-gen-${i}`;
            fs.mkdirSync(path.join(dir, name));
            names.push(name);
          }
          const removed = sweepStaleTmpDirs({ prefix: PREFIX, dir, isPidAlive: () => false });
          assert.equal(
            removed.length,
            deadGenerationCount,
            `expected all ${deadGenerationCount} accumulated dead-owner root(s) cleared in one pass, cleared ${removed.length}`
          );
          for (const name of names) {
            assert.equal(fs.existsSync(path.join(dir, name)), false, `${name}: expected cleared, still present`);
          }
          return true;
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
    assert.ok(coverage.generations.some((n) => n === 0), 'generator never drew zero accumulated leaks');
    assert.ok(coverage.generations.some((n) => n >= 5), 'generator never drew a substantial pile-up (>=5)');
  });

  // ── non-vacuousness: a broken "always trust the caller" sweep must fail ─
  it('non-vacuousness: a sweep that never checks liveness would wrongly remove a live peer\'s root', () => {
    const dir = mkSharedTmpDir('bl1623-nonvac-');
    const liveName = `${PREFIX}999999-live`;
    fs.mkdirSync(path.join(dir, liveName));

    function brokenAlwaysRemove(prefix, sweepDir) {
      const removed = [];
      for (const entry of fs.readdirSync(sweepDir)) {
        if (entry.startsWith(prefix)) {
          fs.rmSync(path.join(sweepDir, entry), { recursive: true, force: true });
          removed.push(entry);
        }
      }
      return removed;
    }

    // The exact bug class this ticket exists to fix: a blind prefix sweep
    // wrongly removes a live peer's root regardless of pid.
    const brokenRemoved = brokenAlwaysRemove(PREFIX, dir);
    assert.ok(brokenRemoved.includes(liveName), 'expected the broken blind sweep to wrongly remove the live root');

    // Rebuild it and prove the REAL helper leaves it alone.
    fs.mkdirSync(path.join(dir, liveName));
    sweepStaleTmpDirs({ prefix: PREFIX, dir, isPidAlive: () => true });
    assert.equal(fs.existsSync(path.join(dir, liveName)), true, 'the real helper must never remove a live peer\'s root');
  });
});
