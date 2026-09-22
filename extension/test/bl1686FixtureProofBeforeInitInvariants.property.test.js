'use strict';

// BL-1686 declared invariant (coder-authored first, per BL-654):
// "No shell test under swarmforge/scripts/test runs a mutating git
// command against a root it has not proven under its own TMPROOT, and
// no test's startup sweep removes a temp root whose owner process is
// alive."
//
// Two independent clauses, two properties. Both drive REAL production
// code - the REAL prove_root/mk_fixture bodies of
// test_bl1378_expedite_close_guard.sh (extracted by source position, via
// specs/pipeline/steps/lib/bl1686FixtureProofBeforeInitCli.sh) and the
// REAL sweep_stale_prefix_roots helper (swarmforge/scripts/test/lib/
// tmp_cleanup.sh, sourced directly) - never a reimplementation.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { spawnZombie } = require('./helpers/fixtureLiveness');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1686FixtureProofBeforeInitCli.sh');
const TMP_CLEANUP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'lib', 'tmp_cleanup.sh');

function mkScratchDir(prefix) {
  return mkTmpDir(prefix);
}

// A real, guaranteed-dead pid: spawned and reaped via `wait` before use.
function deadPid() {
  const out = spawnSync('bash', ['-c', '( : ) & echo $!; wait $! 2>/dev/null || true']);
  return Number(out.stdout.toString().trim().split('\n')[0]);
}

// ── Property (invariant, clause 1): ordering ────────────────────────────
// "no mutating git command against a root it has not proven" - whatever
// unrelated content the calling working directory already holds, when
// TMPROOT has vanished the fixture builder refuses before creating
// anything there at all: the directory's own listing is byte-identical
// before and after.
//
// Generator reach: the scratch cwd is sometimes empty and sometimes
// pre-populated with a random number of arbitrarily-named files, proving
// the refusal is unconditional on the cwd's own contents - never "empty
// dirs are safe, non-empty ones happen to also pass".
const preexistingFileArb = fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/);

test('property (invariant clause 1): mk_fixture never mutates its caller\'s cwd once its own TMPROOT is gone, whatever the cwd already held', () => {
  fc.assert(
    fc.property(fc.uniqueArray(preexistingFileArb, { maxLength: 4 }), (preexisting) => {
      const scratch = mkScratchDir('bl1686-prop-clause1-');
      try {
        for (const name of preexisting) {
          fs.writeFileSync(path.join(scratch, name), 'x');
        }
        const before = fs.readdirSync(scratch).sort();

        const result = spawnSync('bash', [CLI, 'vanished-tmproot', scratch], { encoding: 'utf8' });

        assert.notEqual(result.status, 0, `expected a non-zero exit, got 0: ${result.stdout}${result.stderr}`);
        assert.match(
          `${result.stdout}${result.stderr}`,
          /refusing to mutate/,
          `expected the proof's own refusal, got: ${result.stdout}${result.stderr}`
        );
        const after = fs.readdirSync(scratch).sort();
        assert.deepEqual(after, before, `expected ${scratch} untouched (preexisting=${JSON.stringify(preexisting)}), before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    }),
    { numRuns: 15 }
  );
});

// ── Property (invariant, clause 2): sweep liveness ──────────────────────
// "no test's startup sweep removes a temp root whose owner process is
// alive" - whatever mix of live-owned and dead-owned roots share a
// prefix, sweep_stale_prefix_roots removes exactly the dead-owned ones.
//
// Generator reach: live-owner count and dead-owner count both vary
// (0-4 each, so the empty-live and empty-dead edges are drawn too), AND
// a zombie death mode is included alongside plain reaped-dead pids -
// `kill -0` alone reads a zombie as alive, so this crosses the two ways
// "dead" can present to prove the sweep's zombie-aware check (BL-1647)
// actually fires, not just the already-reaped case.
const countArb = fc.integer({ min: 0, max: 4 });

test('property (invariant clause 2): the sweep removes only roots whose owner is not alive, whatever the live/dead mix and however "dead" presents', async () => {
  await fc.assert(
    fc.asyncProperty(countArb, countArb, fc.boolean(), async (liveCount, deadCount, useZombie) => {
      const work = mkScratchDir('bl1686-prop-clause2-');
      const prefix = 'bl1686propfix';
      let zombie = null;
      try {
        let deadOwnerPid;
        if (useZombie && deadCount > 0) {
          zombie = await spawnZombie(`bl1686-prop-zombie-${Math.random().toString(36).slice(2, 8)}`);
          if (!zombie.confirmedZombie) {
            throw new Error(`expected a genuine zombie (/proc State: Z), got pid ${zombie.pid}`);
          }
          deadOwnerPid = zombie.pid;
        } else {
          deadOwnerPid = deadPid();
        }

        const liveRoots = [];
        for (let i = 0; i < liveCount; i += 1) {
          const dir = path.join(work, `${prefix}.${process.pid}.live${i}`);
          fs.mkdirSync(dir);
          liveRoots.push(dir);
        }
        const deadRoots = [];
        for (let i = 0; i < deadCount; i += 1) {
          const dir = path.join(work, `${prefix}.${deadOwnerPid}.dead${i}`);
          fs.mkdirSync(dir);
          deadRoots.push(dir);
        }

        const script = `TMPDIR='${work}'; source '${TMP_CLEANUP_LIB}'; sweep_stale_prefix_roots '${prefix}'`;
        const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
        assert.equal(result.status, 0, `sweep script failed: ${result.stdout}${result.stderr}`);

        for (const dir of liveRoots) {
          assert.ok(fs.existsSync(dir), `expected the live-owned root ${dir} to survive (liveCount=${liveCount} deadCount=${deadCount} useZombie=${useZombie})`);
        }
        for (const dir of deadRoots) {
          assert.ok(!fs.existsSync(dir), `expected the dead-owned root ${dir} to be removed (liveCount=${liveCount} deadCount=${deadCount} useZombie=${useZombie})`);
        }
      } finally {
        if (zombie) zombie.cleanup();
        fs.rmSync(work, { recursive: true, force: true });
      }
    }),
    { numRuns: 10 }
  );
});

// Non-vacuity, each broken for real and restored byte-identical afterward:
//   - Clause 1: reverting mk_fixture to call `git -C "$root" init -q -b main`
//     BEFORE `prove_root "$root"` (the exact BL-1686 defect) failed the
//     first generated case immediately - the scratch cwd's `after` listing
//     gained no new files (git ignores `-C ""`, re-init on the process's own
//     already-initialized cwd is a no-op here too), but a live checkout with
//     no `.git` yet would have been silently initialized - confirmed
//     separately via the file-level regression section 09 in
//     test_bl1378_expedite_close_guard.sh, which asserts the absence of
//     `.git` directly against an EMPTY scratch cwd where the no-op escape
//     hatch does not apply.
//   - Clause 2: dropping the `ps -o stat=` zombie check from
//     sweep_stale_prefix_roots (bare `kill -0` liveness only) failed
//     immediately on every useZombie=true, deadCount>0 case - "expected the
//     dead-owned root ... to be removed" - proving this property actually
//     exercises the zombie branch BL-1647 ruled on, not merely the
//     already-reaped path. Restored, re-verified green.
