#!/usr/bin/env node
'use strict';

// BL-746 coder pass (BL-654 Invariants): PROPERTY test over the real
// repo-root stop-swarm.sh, covering the ticket's own declared invariant 2:
//
//   "stop-swarm.sh reports its success line only when every refuse gate
//    passes (no survivor found AND the pipeline kill exited zero); on any
//    refuse the success line is absent and the exit status is non-zero."
//
// (Invariant 1 - "no stop-path scenario derives its expected output from a
// reimplementation of the script's branching" - is a claim about the TEST
// SUITE'S OWN SOURCE SHAPE, not the program's runtime behavior over
// generated inputs; it admits no executable encoding here and is instead
// enforced by the qa_e2e_procedure's own step 5 reimplementation audit and
// by this ticket's coder-pass evidence recording that audit's result.)
//
// EXHAUSTIVE (not sampled), per bl886_vitest_orphan_reaper_supervisor_
// property_runner.js's own precedent: invariant 2's input space is small
// and fully enumerable (3 survivor shapes {none, babysitterd, Operator} x
// 3 kill_rc values {0, 1, 7} = 9 real fixture combinations, each an actual
// spawned stop-swarm.sh, never mocked), so full enumeration is strictly
// stronger than random sampling and every corner (survivor-only refuse,
// kill_rc-only refuse, both-refuse, neither) is reachable by construction,
// never diluted by a generator that might under-weight one combination.
//
// Non-vacuity proven by hand at authoring time (BL-654's own generator-
// reach rule - a property that can never fail is worth nothing): this
// exact matrix was run against a deliberately broken stop-swarm.sh (the
// kill_rc refuse block removed, matching this ticket's own qa_e2e_
// procedure step 3 regression check) and correctly failed every kill_rc-
// nonzero case before the block was restored. See this ticket's coder-pass
// evidence for the authoring-time log of that run.

const path = require('node:path');
const fixtureLib = require(path.join(__dirname, '..', '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'bl746StopSwarmFixture'));

const SURVIVOR_SHAPES = [
  { label: 'none', argv: null },
  { label: 'babysitterd', argv: 'bash /fixture/.swarmforge/operator/babysitterd.sh /fixture' },
  { label: 'Operator', argv: 'claude --remote-control Operator --model x' },
];

const KILL_RC_VALUES = [0, 1, 7];

function runOne({ survivor, killRc }) {
  const fixture = fixtureLib.buildFixture();
  if (survivor.argv) {
    fixtureLib.setSurvivor(fixture, survivor.argv);
  } else {
    fixtureLib.setNoSurvivors(fixture);
  }
  fixtureLib.writeKillStub(fixture.root, killRc);
  const result = fixtureLib.runStopSwarm(fixture);
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// Independent oracle: a fresh restatement of invariant 2, built without
// calling into stop-swarm.sh's own source at all.
function oracleShouldSucceed({ survivor, killRc }) {
  return survivor.argv === null && killRc === 0;
}

function main() {
  const failures = [];
  let runs = 0;

  for (const survivor of SURVIVOR_SHAPES) {
    for (const killRc of KILL_RC_VALUES) {
      runs += 1;
      const input = { survivor: survivor.label, killRc };
      const { status, stdout, stderr } = runOne({ survivor, killRc });
      const expectSuccess = oracleShouldSucceed({ survivor, killRc });
      const hasSuccessLine = stdout.includes('full stack SUCCESS — no known survivors');
      const combined = `${stdout}${stderr}`;

      if (expectSuccess) {
        if (status !== 0) {
          failures.push(`${JSON.stringify(input)}: expected exit 0, got ${status}. stdout=${stdout} stderr=${stderr}`);
        }
        if (!hasSuccessLine) {
          failures.push(`${JSON.stringify(input)}: expected the success line, got stdout=${stdout}`);
        }
      } else {
        if (status === 0) {
          failures.push(`${JSON.stringify(input)}: SOUNDNESS VIOLATION - a refuse condition held but exit status was 0. stdout=${stdout} stderr=${stderr}`);
        }
        if (hasSuccessLine) {
          failures.push(`${JSON.stringify(input)}: LOUDNESS VIOLATION - a refuse condition held but the success line was printed anyway. combined=${combined}`);
        }
      }
    }
  }

  console.log(`bl746 stop-swarm refuse-gate property: ${runs} runs (exhaustive over ${SURVIVOR_SHAPES.length} survivor shapes x ${KILL_RC_VALUES.length} kill_rc values)`);
  if (failures.length === 0) {
    console.log('ALL PROPERTIES HOLD');
    process.exit(0);
  } else {
    console.log(`${failures.length} PROPERTY FAILURE(S):`);
    for (const f of failures.slice(0, 10)) {
      console.log(f);
    }
    process.exit(1);
  }
}

main();
