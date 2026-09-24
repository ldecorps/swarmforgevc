'use strict';

// BL-1716: step handlers for "A land replay recovers the scratch a killed
// land left behind". Drives the REAL land-step-lib/replay! via the shared
// `replay` helper from lib/bl1446LandFixture.js - never a reimplementation.
// The leftover worktree/branch a killed run would leave is built with REAL
// `git worktree add -b` calls (the exact shape replay! itself uses), and a
// "still alive" owner is a REAL long-lived child process whose start time
// is read back through the REAL land-step-lib/process-start-ms (via the
// fixture's processStartMs) - so the liveness check under test and this
// fixture's own setup can never quietly disagree about what "alive" means.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { git, commit, initRepo, markOriginMainHere, replay, mkTmpDir, processStartMs } = require('./lib/bl1446LandFixture');

const FEATURE = 'BL-1716 A land replay recovers the scratch a killed land left behind';
const TASK_TICKET_ID = 'BL-9716';
const OWN_PATH = 'backlog/active/BL-9716-x.yaml';

function scoped(pattern, handler) {
  return { pattern, handler };
}

// The exact naming replay! itself uses (land_step_lib.bb: id, branch,
// scratch, owner-record-path) - recomputed here rather than hand-copied
// constants, so this fixture can never drift from the production naming.
function replayPaths(root, commitSha) {
  const reported = git(root, 'rev-parse', '--git-common-dir');
  const commonDir = path.resolve(root, reported);
  const id = `${TASK_TICKET_ID}-${commitSha.slice(0, 10)}`;
  const worktreesDir = path.join(commonDir, 'land-replay-worktrees');
  return {
    id,
    branch: `land-replay/${id}`,
    scratch: path.join(worktreesDir, id),
    ownerRecordPath: path.join(worktreesDir, `${id}.owner.json`),
  };
}

function createLeftoverScratch(root, commitSha, originMainSha) {
  const { branch, scratch } = replayPaths(root, commitSha);
  fs.mkdirSync(path.dirname(scratch), { recursive: true });
  git(root, 'worktree', 'add', '-q', '-b', branch, scratch, originMainSha);
  return { branch, scratch };
}

function writeOwnerRecord(root, commitSha, pid, startMs) {
  const { ownerRecordPath } = replayPaths(root, commitSha);
  fs.mkdirSync(path.dirname(ownerRecordPath), { recursive: true });
  fs.writeFileSync(ownerRecordPath, JSON.stringify({ pid, 'start-ms': startMs }));
}

function branchExists(root, branch) {
  return spawnSync('git', ['-C', root, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
}

function registerSteps(registry) {
  const defs = [
    scoped(/^a fixture origin with an approved parcel for fixture ticket BL-9716$/, (ctx) => {
      ctx.root = mkTmpDir('bl1716-fixture-');
      initRepo(ctx.root);
      ctx.originMain = markOriginMainHere(ctx.root);
      ctx.commitSha = commit(ctx.root, OWN_PATH, 'id: BL-9716\n', `${TASK_TICKET_ID}: own work`);
    }),

    // ── a-dead-runs-scratch-is-cleared-01 / a-live-runs-scratch-is-left-alone-02 ──
    scoped(
      /^the parcel's replay worktree and scratch branch exist, recorded to a run that is (no longer alive|still alive)$/,
      (ctx, aliveness) => {
        createLeftoverScratch(ctx.root, ctx.commitSha, ctx.originMain);
        if (aliveness === 'no longer alive') {
          // A real child that has ALREADY exited by the time spawnSync
          // returns - a genuinely dead pid, not a guessed unused number.
          // The recorded start-ms value is irrelevant here: process-start-ms
          // resolves to nil for a dead pid regardless, so any recorded
          // number fails the equality check and reads as dead.
          const dead = spawnSync(process.execPath, ['-e', '0']);
          writeOwnerRecord(ctx.root, ctx.commitSha, dead.pid, 1);
        } else {
          // A real, still-running child - its start-ms is read back
          // through the SAME production function replay! calls, so the
          // owner record matches by construction.
          const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
          const startMs = processStartMs(child.pid);
          writeOwnerRecord(ctx.root, ctx.commitSha, child.pid, startMs);
          ctx.liveChild = child;
        }
      }
    ),

    scoped(/^the land step replays the parcel$/, (ctx) => {
      // `replay` shells out via execFileSync, which inherits process.env
      // by default - set only for this one call, restored (or deleted)
      // right after, so a scenario's env override can never leak into a
      // later scenario in the same process.
      const overrides = ctx.envOverrides || {};
      const prior = {};
      for (const key of Object.keys(overrides)) {
        prior[key] = process.env[key];
        process.env[key] = overrides[key];
      }
      try {
        ctx.result = replay(ctx.root, ctx.commitSha, TASK_TICKET_ID, [OWN_PATH], []);
      } finally {
        for (const key of Object.keys(overrides)) {
          if (prior[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = prior[key];
          }
        }
      }
    }),

    scoped(/^it builds the tip-pure commit off origin\/main$/, (ctx) => {
      assert.equal(ctx.result.success, true, `expected the replay to succeed: ${JSON.stringify(ctx.result)}`);
    }),

    scoped(/^no replay worktree for BL-9716 remains registered or on disk$/, (ctx) => {
      // The WORKTREE directory and its registration only. Both the
      // BRANCH (QA's own land action reads it) and the owner record
      // (so a LATER re-land of the same ticket+commit can tell this now-
      // ownerless branch apart from one a still-running replay owns)
      // survive a successful replay on purpose - neither belongs to
      // this step's assertion.
      const { scratch } = replayPaths(ctx.root, ctx.commitSha);
      assert.equal(fs.existsSync(scratch), false, `expected the scratch directory gone, still at ${scratch}`);
      const worktreeList = git(ctx.root, 'worktree', 'list', '--porcelain');
      assert.ok(!worktreeList.includes(scratch), `expected no registered worktree entry for ${scratch}, got: ${worktreeList}`);
    }),

    scoped(/^the replay refuses naming the live run that owns the scratch$/, (ctx) => {
      assert.equal(ctx.result.success, false, `expected the replay to refuse: ${JSON.stringify(ctx.result)}`);
      assert.ok(
        ctx.result.reason.includes(String(ctx.liveChild.pid)),
        `expected the refusal to name pid ${ctx.liveChild.pid}, got: ${ctx.result.reason}`
      );
    }),

    scoped(/^that worktree and branch are unchanged$/, (ctx) => {
      const { scratch, branch, ownerRecordPath } = replayPaths(ctx.root, ctx.commitSha);
      assert.equal(fs.existsSync(scratch), true, `expected the scratch directory to remain, missing at ${scratch}`);
      assert.equal(fs.existsSync(ownerRecordPath), true, `expected the owner record to remain, missing at ${ownerRecordPath}`);
      assert.equal(branchExists(ctx.root, branch), true, `expected branch ${branch} to remain`);
      if (ctx.liveChild) {
        ctx.liveChild.kill();
      }
    }),

    // ── a-create-failure-names-gits-reason-03 ──────────────────────────
    scoped(/^the parcel's replay worktree path is occupied by a plain file$/, (ctx) => {
      const { scratch } = replayPaths(ctx.root, ctx.commitSha);
      fs.mkdirSync(path.dirname(scratch), { recursive: true });
      fs.writeFileSync(scratch, 'not a worktree\n');
    }),

    scoped(/^the replay refuses with a reason that carries git's own error text$/, (ctx) => {
      assert.equal(ctx.result.success, false, `expected the replay to refuse: ${JSON.stringify(ctx.result)}`);
      const m = /^land-step replay: could not create worktree .+ off origin\/main: ([\s\S]+)$/.exec(ctx.result.reason);
      assert.ok(m, `expected the create-failure shape, got: ${ctx.result.reason}`);
      assert.ok(m[1].trim().length > 0, `expected git's own error text appended, got: ${ctx.result.reason}`);
    }),

    // ── a-recordless-scratch-past-the-age-bound-is-cleared-04 /
    //    a-recordless-scratch-still-young-is-refused-unestablished-05 ─────
    // No owner record at all - the exact shape a scratch left by a run
    // killed BEFORE this fix ever wrote one, or a run that died between
    // `worktree add` and the record write. Only age (not liveness) can
    // decide these; the two scenarios below drive opposite sides of that
    // decision through the REAL wiring (scratch-age-ms!, the env-read age
    // bound, stale-scratch-decision), which the pure property test alone
    // cannot reach - it is handed age-past-bound? directly rather than
    // deriving it from a real leftover's mtime and the real env var.
    scoped(/^the parcel's replay worktree and scratch branch exist with no owner record$/, (ctx) => {
      createLeftoverScratch(ctx.root, ctx.commitSha, ctx.originMain);
    }),

    scoped(/^the stale-scratch age bound is (\d+) hours$/, (ctx, hours) => {
      // 0 hours makes ANY leftover - even one created an instant ago -
      // read as past the bound (age-ms >= 0 is always true), without a
      // sleep: the fixture never needs to backdate a real mtime.
      ctx.envOverrides = ctx.envOverrides || {};
      ctx.envOverrides.SWARMFORGE_LAND_REPLAY_STALE_SCRATCH_HOURS = hours;
    }),

    scoped(/^the replay refuses naming no owner at all$/, (ctx) => {
      assert.equal(ctx.result.success, false, `expected the replay to refuse: ${JSON.stringify(ctx.result)}`);
      assert.ok(
        ctx.result.reason.includes('unestablished owner'),
        `expected the refusal to name no owner (unestablished), got: ${ctx.result.reason}`
      );
    }),

    scoped(/^the worktree and branch remain, still with no owner record$/, (ctx) => {
      const { scratch, branch, ownerRecordPath } = replayPaths(ctx.root, ctx.commitSha);
      assert.equal(fs.existsSync(scratch), true, `expected the scratch directory to remain, missing at ${scratch}`);
      assert.equal(branchExists(ctx.root, branch), true, `expected branch ${branch} to remain`);
      assert.equal(
        fs.existsSync(ownerRecordPath),
        false,
        `expected no owner record to have been written, found at ${ownerRecordPath}`
      );
    }),

    // ── a-branch-only-leftover-with-no-directory-is-cleared-06 ─────────────
    // The shape a PAST SUCCESSFUL replay leaves on purpose (replay!'s
    // success path removes only the worktree directory; the branch and
    // its owner record both survive) once the owning run has since
    // exited - `leftover?` must see this leftover through the BRANCH
    // alone, since dir-exists? is false. A mutant dropping the
    // branch-exists? half of that OR survives every other scenario here
    // (each one creates both the directory and the branch together) and
    // was caught, during this hardening pass, only by the much slower
    // test_bl1366_land_is_one_command.sh shell test - this scenario gives
    // the dedicated feature its own fast, targeted kill.
    scoped(
      /^the parcel's replay branch exists with no directory, recorded to a run that is no longer alive$/,
      (ctx) => {
        const { branch, scratch } = createLeftoverScratch(ctx.root, ctx.commitSha, ctx.originMain);
        git(ctx.root, 'worktree', 'remove', '-f', scratch);
        fs.rmSync(scratch, { recursive: true, force: true });
        assert.equal(fs.existsSync(scratch), false, 'expected the directory to be gone before the record is written');
        assert.equal(branchExists(ctx.root, branch), true, 'expected the branch to survive the directory removal');
        const dead = spawnSync(process.execPath, ['-e', '0']);
        writeOwnerRecord(ctx.root, ctx.commitSha, dead.pid, 1);
      }
    ),
  ];

  for (const { pattern, handler } of defs) {
    registry.defineScoped(pattern, handler, FEATURE);
  }
}

module.exports = { registerSteps };
