'use strict';

// BL-1071 declared invariant 2 (property authorship rests with the coder,
// first pass - BL-654): "A recovery the babysitter owns is bounded in
// wall-clock as well as in attempts: no repair can hold a sweep open
// indefinitely."
//
// This is the invariant the landed hotfix did NOT satisfy, and confirming it
// was review goal 2. The attempt budget (session-repair-allowed?) stops a
// recovery being retried forever; it says nothing whatever about one that
// never returns. `bash ./swarm ensure` was shelled with no deadline, so a
// hanging ensure held the sweep open and the next tick never happened - and a
// babysitter that is stuck is indistinguishable from one that is not running,
// which is the incident's own shape one level up.
//
// The sweep is driven for real, with a ./swarm that hangs in a different way
// each draw. The shapes matter individually:
//
//   plain hang            the base case.
//   hang with a
//   grandchild            `.destroyForcibly` kills the DIRECT child only, so a
//                         shell script's own children survive it. Only a
//                         process-GROUP kill reaches them.
//   ignores SIGTERM       a `trap '' TERM` script survives a polite kill
//                         entirely; this is what makes KILL rather than TERM
//                         load-bearing.
//   hang after output     writes to stdout first, then hangs. Deref-ing a
//                         destroyed process BLOCKS while a surviving
//                         grandchild holds the pipe open, so this is the shape
//                         that punishes a :string pipe instead of a file.
//
// A property that only ever used the plain hang would pass against an
// implementation that kills the child and leaks its whole subtree.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit):
//   break 1 - the bound removed entirely, restoring the landed hotfix's own
//     `process/sh` with no deadline: the run HUNG rather than failing an
//     assertion - the sweep never returned, and the harness had to be killed.
//     That is the demonstration, and it is the failure mode itself: an
//     unbounded recovery does not produce a red test, it produces a babysitter
//     that stops ticking, which is indistinguishable from one that is dead.
//   break 2 - `setsid` dropped from run-bounded!, so only the direct child is
//     killed: RED on the grandchild draw, "a grandchild survived the kill".
//   break 3 - the timed-out branch made unreachable and the exit defaulted to
//     0, so a bounded-out recovery reports success: RED on the first draw at
//     the `REPAIR [unfinished]` assertion, which trips before the
//     never-a-repair one. Right order either way: a recovery that never
//     returned and claims a clean exit has already failed the invariant.
// All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { makeSweepFixture, breakProbes, writeStub, ensureCalls, runSweep, died, TMUX_NO_SERVER } = require('./helpers/bl1071SweepFixture');

const mkdir = () => mkTmpDir('bl1071-bound-');

const RECORD = 'echo 1 >> "$(dirname "$0")/ensure-count"';

// Each shape hangs differently, and each defeats a different half-measure.
const HANG_SHAPES = {
  plain: `#!/usr/bin/env bash\n${RECORD}\nsleep 3600\n`,
  grandchild: `#!/usr/bin/env bash\n${RECORD}\nsleep 3600 &\nsleep 3600\n`,
  'ignores-sigterm': `#!/usr/bin/env bash\ntrap '' TERM\n${RECORD}\nsleep 3600 &\nsleep 3600\n`,
  'output-then-hang': `#!/usr/bin/env bash\n${RECORD}\necho "ensure: starting"\nsleep 3600 &\nsleep 3600\n`,
};

// The marker every hang shape's `sleep` carries. Bracketed so a pgrep for it
// can never match its own command line.
function strayHangs() {
  try {
    return execFileSync('bash', ['-c', "pgrep -f '[s]leep 3600' | wc -l"], { encoding: 'utf8' }).trim();
  } catch {
    return '0';
  }
}

test('BL-1071/BL-654 invariant 2: a recovery that never returns is bounded, reported unfinished, and leaves nothing behind', () => {
  const boundMs = 1500;
  const shapes = Object.keys(HANG_SHAPES);
  assert.equal(shapes.length, 4, 'every hang shape must run, or the sweep is not covering the ways a kill half-works');

  for (const shape of shapes) {
    const before = strayHangs();
    const fixture = breakProbes(makeSweepFixture(mkdir, { swarmStub: HANG_SHAPES[shape] }), [], {
      planeMissing: true,
    });
    writeStub(fixture, 'tmux', TMUX_NO_SERVER);

    const r = runSweep(fixture, { BABYSITTER_ENSURE_TIMEOUT_MS: String(boundMs) });

    // Bounded: the sweep ENDED. The harness timeout would otherwise be what
    // ends it, and a run killed by the harness reports exitCode null.
    assert.notEqual(r.exitCode, null, `the sweep never ended at all (${shape}, ${r.elapsedMs}ms)`);
    assert.ok(!died(r.output), `the sweep died rather than bounding the recovery (${shape}):\n${r.output}`);

    // The recovery really was started, or there is no hang to be bounded and
    // the whole draw proves nothing.
    assert.equal(ensureCalls(fixture).length, 1, `the recovery never started (${shape}):\n${r.output}`);

    // Bounded in WALL CLOCK, not merely eventually. The slack is generous
    // because a sweep does real work either side of the recovery; what it
    // rules out is the 3600s hang.
    assert.ok(
      r.elapsedMs < 60000,
      `the sweep ran ${r.elapsedMs}ms against a ${boundMs}ms recovery bound (${shape}) - the hang held it open`
    );

    // Reported honestly: not a repair (nothing said it worked) and not a
    // failure (nothing said it did not) - unfinished is the third answer.
    assert.match(r.output, /REPAIR \[unfinished\] control-plane/, `(${shape}):\n${r.output}`);
    assert.ok(
      !/REPAIR \[repaired\] control-plane/.test(r.output),
      `a recovery that never returned was reported as a repair (${shape}):\n${r.output}`
    );

    // And it left nothing running. A group kill is the only thing that
    // reaches a hung script's children.
    const after = strayHangs();
    assert.equal(
      after,
      before,
      `a grandchild survived the kill (${shape}): ${before} stray hangs before, ${after} after`
    );
  }
});

test('BL-1071/BL-654 invariant 2, the other direction: a recovery that DOES return is still reported as a repair', () => {
  // Without this, "bounded" would be satisfied by an implementation that
  // reported every recovery unfinished and never waited for any of them.
  const fixture = breakProbes(makeSweepFixture(mkdir), [], { planeMissing: true });
  writeStub(fixture, 'tmux', TMUX_NO_SERVER);
  const r = runSweep(fixture, { BABYSITTER_ENSURE_TIMEOUT_MS: '30000' });

  assert.equal(ensureCalls(fixture).length, 1, `the recovery never ran:\n${r.output}`);
  assert.match(r.output, /REPAIR \[repaired\] control-plane/, r.output);
  assert.ok(
    !/REPAIR \[unfinished\] control-plane/.test(r.output),
    `a recovery that returned promptly was reported unfinished:\n${r.output}`
  );
});
