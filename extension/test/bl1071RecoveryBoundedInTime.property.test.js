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
//   break 2 - `setsid` dropped from run-bounded!: RED on the first draw, "the
//     recovery ran in this test's own process group - setsid did not isolate
//     it, so a group kill cannot reach its children", and it genuinely orphans
//     two sleeps. Recorded because the FIRST version of the QA-bounce fix did
//     NOT catch this break: it recorded $$ as the group id, which is only the
//     group when setsid worked, so without setsid it looked in an empty group
//     and read zero survivors. That is why the pgid is read from `ps` and why
//     the isolation assertion exists alongside the survivor one.
//   break 3 - the timed-out branch made unreachable and the exit defaulted to
//     0, so a bounded-out recovery reports success: RED on the first draw at
//     the `REPAIR [unfinished]` assertion, which trips before the
//     never-a-repair one. Right order either way: a recovery that never
//     returned and claims a clean exit has already failed the invariant.
// All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { makeSweepFixture, breakProbes, writeStub, ensureCalls, runSweep, died, TMUX_NO_SERVER } = require('./helpers/bl1071SweepFixture');

const mkdir = () => mkTmpDir('bl1071-bound-');

// Each hang shape records its own PGID before hanging. run-bounded! wraps the
// command in `setsid`, so this script IS its group leader and $$ is the group
// id - which makes "did anything survive the kill?" a question about THIS
// test's own process tree.
//
// QA bounce 2026-08-23: the first version asked that question of the whole
// host (`pgrep -f '[s]leep 3600' | wc -l`) and went red on one of two full
// `npm run test:properties` runs, with 2 survivors it could not attribute.
// That is the pattern engineering.prompt's Guardrails name outright - "never
// diff shared globals (/tmp, broad ps patterns, live runtime paths)" - and the
// bounce's own reading is the point: a host-wide diff cannot tell "our
// grandchild is not reaped YET" from "the group kill genuinely missed it",
// which is exactly the distinction invariant 2 is about. A check that cannot
// distinguish its own failure from someone else's noise is not evidence.
// The REAL process group, read from ps, not assumed to be $$. Recording $$
// would assume the very thing under test: `setsid` makes this script its own
// group leader, so $$ IS the group id only when setsid worked. Without it the
// script inherits the caller's group and $$ names a group it does not lead -
// which made an earlier version of this fix pass against a run-bounded! with
// setsid removed, because it then looked in an empty group. Measured, and the
// reason the isolation assertion below exists as well as the survivor one.
const RECORD =
  'd="$(dirname "$0")"; echo 1 >> "$d/ensure-count"; ps -o pgid= -p $$ | tr -d " " > "$d/ensure-pgid"';

const HANG_SHAPES = {
  plain: `#!/usr/bin/env bash\n${RECORD}\nsleep 3600\n`,
  grandchild: `#!/usr/bin/env bash\n${RECORD}\nsleep 3600 &\nsleep 3600\n`,
  'ignores-sigterm': `#!/usr/bin/env bash\ntrap '' TERM\n${RECORD}\nsleep 3600 &\nsleep 3600\n`,
  'output-then-hang': `#!/usr/bin/env bash\n${RECORD}\necho "ensure: starting"\nsleep 3600 &\nsleep 3600\n`,
};

function recordedPgid(fixture) {
  const f = path.join(fixture.root, 'ensure-pgid');
  if (!fs.existsSync(f)) return null;
  const pgid = Number(fs.readFileSync(f, 'utf8').trim());
  return Number.isInteger(pgid) && pgid > 1 ? pgid : null;
}

// This test process's own group, read the same way, so the two are comparable.
function ownPgid() {
  const r = spawnSync('bash', ['-c', `ps -o pgid= -p ${process.pid} | tr -d ' '`], { encoding: 'utf8' });
  return Number((r.stdout ?? '').trim()) || null;
}

// How many processes remain in that group. Scoped by PGID, so another test's
// processes - or another run's - cannot be counted here whatever they are
// called.
function survivorsInGroup(pgid) {
  const r = spawnSync('bash', ['-c', `pgrep -g ${pgid} | wc -l`], { encoding: 'utf8' });
  return Number((r.stdout ?? '0').trim()) || 0;
}

// A KILLed process is not gone the instant kill returns - it is a zombie until
// its parent reaps it, and under the real gate's fork pressure that window is
// long enough to see. So the assertion gets a bounded settle window rather
// than a bare instant read. The budget is small: this is waiting for reaping,
// not for work.
function waitForGroupToDie(pgid, budgetMs = 5000) {
  const deadline = Date.now() + budgetMs;
  let remaining = survivorsInGroup(pgid);
  while (remaining > 0 && Date.now() < deadline) {
    spawnSync('bash', ['-c', 'sleep 0.1']);
    remaining = survivorsInGroup(pgid);
  }
  return remaining;
}

test('BL-1071/BL-654 invariant 2: a recovery that never returns is bounded, reported unfinished, and leaves nothing behind', () => {
  const boundMs = 1500;
  const shapes = Object.keys(HANG_SHAPES);
  assert.equal(shapes.length, 4, 'every hang shape must run, or the sweep is not covering the ways a kill half-works');

  for (const shape of shapes) {
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

    // And it left nothing running, asked of THIS sweep's own process group.
    // A group kill is the only thing that reaches a hung script's children,
    // and the group is where the evidence for that lives.
    const pgid = recordedPgid(fixture);
    assert.ok(
      pgid,
      `the hang stub recorded no process group id (${shape}), so the survivor check would prove nothing`
    );
    // The recovery ran in a group of ITS OWN. Without that, killing the group
    // would mean killing the babysitter's own - so run-bounded! could not use
    // a group kill at all, and the survivor check below would be looking at
    // the wrong process tree while reading green.
    assert.notEqual(
      pgid,
      ownPgid(),
      `the recovery ran in this test's own process group (${shape}) - setsid did not isolate it, so a group kill cannot reach its children`
    );
    const survivors = waitForGroupToDie(pgid);
    assert.equal(
      survivors,
      0,
      `${survivors} process(es) survived the kill in the sweep's own group ${pgid} (${shape})`
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
