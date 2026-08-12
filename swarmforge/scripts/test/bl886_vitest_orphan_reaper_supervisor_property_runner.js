#!/usr/bin/env node
'use strict';

// BL-886 coder pass (BL-654 Invariants): PROPERTY test over the landed
// supervisor-side crash-orphan job reaper fix (commit 602c7d014),
// covering:
//   invariant 1: "The supervisor's crash-orphan reaper never touches a
//     property-lane group whose parent is alive - orphanhood, not
//     duration, is its only trigger."
//   invariant 2 (supervisor half): "Neither subsystem's scoping ever
//     widens beyond the host root and registered worktrees: a vitest
//     process whose cmdline and cwd are both outside those paths is never
//     a candidate." (the janitor half of invariant 2 is covered by
//     bl886_vitest_orphan_reaper_janitor_property_runner.bb instead.)
//
// handoffd_supervisor.bb self-executes (-main) on load and has no adapter
// seam (unlike orphan_janitor_sweep_lib.bb's sweep!), so the only way to
// exercise its real reap decision is the actual `bb handoffd_supervisor.bb
// <root> --check-once` CLI against a REAL spawned process - Babashka has
// no raw fork() primitive of its own to reparent a process to PPID 1, so
// this runs as a Node script (reusing
// specs/pipeline/steps/lib/bl886SupervisorFixture.js, the same helper the
// acceptance step handlers use) rather than a .bb generator. Per
// swarmforge/constitution's engineering article ("Babashka/Clojure (swarm
// scripts)" - BL-472), this lane has no wired mutation/CRAP/DRY tool
// either way; this file is itself the enforced gate.
//
// EXHAUSTIVE (not sampled), per bl879_parent_orphaned_front_desk_property_
// runner.bb's own P0 precedent: the input space is small and fully
// enumerable (3 covered cmdline shapes x {orphan, alive} x {in-scope,
// out-of-scope} = 12 real fixture combinations), so full enumeration is
// strictly stronger than random sampling here and every one of invariant
// 1's and invariant 2's combinations is reachable by construction, never
// diluted by a generator that might under-weight the orphan+out-of-scope
// corner. Generator-reach note: because orphaned-job-groups never consults
// duration/age anywhere, "running longer than every stale threshold" adds
// no new state to enumerate over - the alive-parent cases already prove
// duration is irrelevant structurally (no age input exists to vary).
//
// Non-vacuity proven by hand at authoring time: this exact matrix caught a
// deliberately-reordered `orphaned-job-groups` filter (parent-orphaned?
// check swapped to run AFTER job-in-scope?, so a still-live but in-scope
// group's own cwd lookup ran needlessly, and separately a commented-out
// parent-orphaned? clause) - both correctly failed T1 (orphan+in-scope no
// longer reaped) / T2 (alive+in-scope incorrectly reaped) before being
// restored. See docs/how-to or this ticket's own coder review evidence for
// the full authoring-time log.

const path = require('node:path');
const supervisorFixture = require(path.join(__dirname, '..', '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'bl886SupervisorFixture.js'));

const CMDLINE_SHAPES = [
  'npm exec vitest run --config vitest.properties.config.mjs',
  'npx vitest run --config vitest.properties.config.mjs',
  'node (vitest 3) worker',
];

async function runOne({ cmdline, orphan, inScope }) {
  const fixture = supervisorFixture.makeFixtureRoot();
  const cwd = inScope ? path.join(fixture.coderWt, 'extension') : supervisorFixture.mkTmp('bl886-prop-out-of-scope-');
  const proc = orphan
    ? await supervisorFixture.spawnOrphanFixture({ cwd, cmdline })
    : supervisorFixture.spawnOwnedFixture({ cwd, cmdline });
  supervisorFixture.checkOnce(fixture.root, fixture.binDir);
  const alive = supervisorFixture.pidAlive(proc.pid);
  supervisorFixture.killFixture(proc.pid);
  supervisorFixture.cleanupFixtureRoot(fixture);
  return { reaped: !alive };
}

// BL-887 addition: a vitest forked WORKER's cmdline embeds its absolute
// node_modules/vitest/... path MID-STRING (never as a cmdline prefix - the
// cmdline always starts with the executable name), matching the shared
// predicate's cmdline leg (str/includes?) regardless of cwd. Run as its OWN
// loop, not folded into the CMDLINE_SHAPES matrix above: that matrix's
// expectedReaped formula is `orphan && inScope`, driven entirely by which
// cwd is chosen, but this shape is in scope via cmdline alone - folding it
// in would wrongly expect `inScope=false` (an out-of-scope cwd) to survive
// when it must still be reaped. Cross-checked against the janitor's own
// P3/deterministic-regression coverage of the identical shape
// (bl886_vitest_orphan_reaper_janitor_property_runner.bb) for BL-654
// invariant 1 ("supervisor and janitor never disagree"): both subsystems
// are proven, independently and empirically, to classify this exact
// previously-disagreeing shape as in scope.
async function runWorkerMidStringCase({ orphan, cwdKind }) {
  const fixture = supervisorFixture.makeFixtureRoot();
  const cmdline = `node ${fixture.coderWt}/node_modules/vitest/dist/worker.js (vitest 1)`;
  const cwd = cwdKind === 'unresolvable' ? supervisorFixture.mkTmp('bl887-prop-unresolvable-') : fixture.coderWt;
  const proc = orphan
    ? await supervisorFixture.spawnOrphanFixture({ cwd, cmdline })
    : supervisorFixture.spawnOwnedFixture({ cwd, cmdline });
  supervisorFixture.checkOnce(fixture.root, fixture.binDir);
  const alive = supervisorFixture.pidAlive(proc.pid);
  supervisorFixture.killFixture(proc.pid);
  supervisorFixture.cleanupFixtureRoot(fixture);
  return { reaped: !alive };
}

async function main() {
  const failures = [];
  let total = 0;
  for (const cmdline of CMDLINE_SHAPES) {
    for (const orphan of [true, false]) {
      for (const inScope of [true, false]) {
        total += 1;
        const expectedReaped = orphan && inScope; // invariant 1 + 2: reaped iff orphaned AND in-scope
        const { reaped } = await runOne({ cmdline, orphan, inScope });
        if (reaped !== expectedReaped) {
          failures.push(
            `FAIL cmdline=${JSON.stringify(cmdline)} orphan=${orphan} inScope=${inScope}: expected reaped=${expectedReaped}, got reaped=${reaped}`
          );
        }
      }
    }
  }
  console.log(`bl886 supervisor orphanhood+scope properties: ${total}/12 exhaustive real-process combinations`);

  let workerTotal = 0;
  for (const orphan of [true, false]) {
    for (const cwdKind of ['unresolvable', 'in-scope']) {
      workerTotal += 1;
      const expectedReaped = orphan; // cmdline alone puts it in scope regardless of cwd
      const { reaped } = await runWorkerMidStringCase({ orphan, cwdKind });
      if (reaped !== expectedReaped) {
        failures.push(
          `FAIL BL-887 worker-mid-string cmdline orphan=${orphan} cwdKind=${cwdKind}: expected reaped=${expectedReaped}, got reaped=${reaped}`
        );
      }
    }
  }
  console.log(`bl887 supervisor worker-mid-string-cmdline properties: ${workerTotal}/4 exhaustive real-process combinations`);

  if (failures.length > 0) {
    console.log(`${failures.length} PROPERTY FAILURE(S):`);
    for (const f of failures) console.log(f);
    process.exit(1);
  }
  console.log('ALL PROPERTIES HOLD');
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
