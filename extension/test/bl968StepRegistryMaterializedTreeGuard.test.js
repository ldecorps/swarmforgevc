'use strict';

// BL-968: the standing guard for both declared invariants, in the unit
// lane so it runs on every npm test (the hardener's whole-tree guard
// shape). Core logic in helpers/materializedRegistryGuard.js, shared with
// the invariant-2 property lane and the BL-968 acceptance step handlers.
//
// Invariant 1 - "the step registry is loadable from a materialized,
// non-git, non-repo temp tree; no step file may run a subprocess, resolve
// a git root, or touch live repo state at module load" - is encoded
// EXHAUSTIVELY, not generatively: the quantified domain is the finite,
// enumerable CURRENT registry, and materializing all of it through the
// REAL resolve_contract_steps.js (the exact loader the BL-761 gate runs)
// covers 100% of that domain every run - strictly stronger than sampling
// it. That exhaustive-over-the-domain posture is this parcel's stated
// BL-654 encoding for invariant 1. The load runs STRICTER than the live
// gate: the resolver child's PATH is neutered (see the helper), because a
// load-time subprocess that SUCCEEDS is still an invariant-1 violation and
// pure loadability is blind to it - the fifth live offender (below) had
// exactly that shape.
//
// Invariant 2 - "a standing guard proves invariant 1 continuously ... so
// the next load-time-binding step file fails its own parcel's gates" - is
// encoded generatively in bl968MaterializedGuardSensitivity.property.test.js
// (offenders across the three declared classes, constructed to collide by
// construction); the single-shot sensitivity test here keeps the standing
// unit lane itself demonstrably red-capable on the exact shape that
// blinded the gate (a git subprocess at module load), naming the file.
//
// Non-vacuity was proven by live defects before any planted one: at
// authoring time the loadability half caught a FOURTH offender the ticket
// had not found (devHostLauncherSteps' load-time read of swarm_ensure.bb,
// shadowed behind the three resolveMainCheckout call sites - a load
// FAILURE in the tree), and require-time profiling then caught a FIFTH
// (bl936...Steps' two load-time login-shell spawns, load-SUCCEEDING and so
// invisible to loadability alone - the reason the guard neuters PATH).
//
// Cost, measured 2026-08-20: the green-path resolver run is ~10-27s under
// swarm load - almost entirely the registry's own require pass (dominated
// by bl674EpicDrilldownUiSteps' jsdom require, ~8-11s, which is LEGAL
// load-time work under invariant 1: a require). This file therefore
// exceeds the 7s per-file budget by design; the real BL-761 gate pays the
// same require pass on every QA-bound send, and the guard must mirror it.
// Both tests share ONE materialization (the sensitivity test restores what
// it plants) to avoid paying the copy twice.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { materializeCurrentPipeline, registryLoadVerdict, plantOffender } = require('./helpers/materializedRegistryGuard');

let shared;

beforeAll(() => {
  shared = materializeCurrentPipeline();
});

afterAll(() => {
  if (shared) {
    fs.rmSync(shared.root, { recursive: true, force: true });
  }
});

test(
  'BL-968 invariant 1 (exhaustive standing guard): the CURRENT step registry loads from a materialized non-repo tree with a neutered PATH',
  () => {
    const verdict = registryLoadVerdict(shared.pipelineDir, shared.root);
    assert.equal(
      verdict.loadable,
      true,
      `the registry no longer loads from the BL-761 gate's materialized tree - a step file binds environment state at module load: ${verdict.error}\n${verdict.detail || ''}`
    );
  },
  120000
);

test(
  'BL-968 invariant 2 (standing sensitivity shot): a planted load-time-subprocess step file turns the guard red, naming that file',
  () => {
    const offender = plantOffender(shared.pipelineDir, {
      registerRelPath: 'bl968PlantedOffenderSteps',
      files: {
        'bl968PlantedOffenderSteps.js': [
          "'use strict';",
          "const { execFileSync } = require('node:child_process');",
          '// the exact class that blinded the gate: a git subprocess at module load',
          "const MAIN = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: __dirname, encoding: 'utf8' });",
          'function registerSteps() {}',
          'module.exports = { registerSteps, MAIN };',
          '',
        ].join('\n'),
      },
    });
    try {
      const verdict = registryLoadVerdict(shared.pipelineDir, shared.root);
      assert.equal(verdict.loadable, false, `expected the planted offender to make the registry unloadable, got: ${JSON.stringify(verdict)}`);
      assert.ok(
        (verdict.detail || '').includes('bl968PlantedOffenderSteps'),
        `the guard's detail must NAME the offending step file:\n${verdict.detail}`
      );
    } finally {
      offender.restore();
    }
  },
  60000
);
