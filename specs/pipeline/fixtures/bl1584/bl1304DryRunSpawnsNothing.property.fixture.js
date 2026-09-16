'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');

const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1304 declared invariants (backlog/paused/BL-1304-a-dry-run-spawns-nothing.yaml):
//
// 1. "A --dry-run invocation starts no stage process and creates no branch,
//    worktree or backlog move, regardless of what an earlier run of the same
//    ticket left on disk."
// 2. "A --dry-run succeeds and prints a plan whenever a real run could start;
//    it never fails on a condition that only a real run would have created."
//
// These are CLI behavioral invariants about the expedite driver. The property
// test drives the REAL expedite_cli.bb through the REAL expedite_fixture.sh
// (same fixture the acceptance tests use), varying preconditions to exercise
// the "regardless of what an earlier run left on disk" clause.
//
// GENERATOR REACH. The invariant quantifies over "whatever an earlier run left
// on disk" - so the generator must construct cases where a worktree EXISTS,
// not merely where it MIGHT exist. The worktree state is drawn explicitly
// (absent vs present), and when present, the worktree is created by git
// worktree add (the same path a real run uses), so the "earlier run left it"
// state is reached by construction, never by accident.

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');
const FIXTURE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'expedite_fixture.sh');

const RUN_TICKET = 'BL-1304';
const OTHER_TICKET = 'BL-590';

// Generator draws: worktree state, ticket placement, bounce-bound
const WORKTREE_STATES = ['absent', 'present'];
const TICKET_PLACEMENTS = [
  { runIn: 'paused', otherIn: 'active' },
  { runIn: 'active', otherIn: 'paused' },
];

function buildFixture(args) {
  const dir = mkTmpDir('bl1304-prop-');
  const res = spawnSync('bash', [FIXTURE_SH, dir, ...args], { encoding: 'utf8' });
  assert.equal(res.status, 0, `fixture build failed: ${res.stdout || ''}${res.stderr || ''}`);
  return dir;
}

function seedWorktree(root, ticket) {
  const worktreeDir = path.join(root, '.worktrees', `expedite-${ticket}`);
  const branch = `expedite/${ticket}`;
  const res = spawnSync('git', ['-C', root, 'worktree', 'add', '-b', branch, worktreeDir, 'main'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `could not seed worktree: ${res.stderr}`);
  return worktreeDir;
}

function runExpedite(root, extraArgs) {
  const env = {
    ...process.env,
    EXPEDITE_STAGE_RUNNER: path.join(root, 'stage-runner.sh'),
    EXPEDITE_STOP_CMD: './stop-swarm.sh',
    EXPEDITE_START_CMD: './start-swarm.sh',
  };
  const res = spawnSync('bb', [CLI, root, RUN_TICKET, '--no-restart', ...extraArgs], {
    encoding: 'utf8',
    env,
    cwd: REPO_ROOT,
    timeout: 30000,
  });
  return { out: `${res.stdout || ''}${res.stderr || ''}`, status: res.status };
}

function ranStages(root) {
  try {
    return fs
      .readFileSync(path.join(root, '.swarmforge', 'expedite-fixture', 'ran.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function worktreeExists(root, ticket) {
  return fs.existsSync(path.join(root, '.worktrees', `expedite-${ticket}`));
}

function branchExists(root, ticket) {
  const res = spawnSync('git', ['-C', root, 'branch', '--list', `expedite/${ticket}`], {
    encoding: 'utf8',
  });
  return res.stdout.trim().length > 0;
}

function ticketInFolder(root, ticket, folder) {
  return fs.existsSync(path.join(root, 'backlog', folder, `${ticket}-fixture.yaml`));
}

test('invariant 1: dry run starts no stage and creates no worktree/branch, regardless of prior state', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...WORKTREE_STATES),
      fc.constantFrom(...TICKET_PLACEMENTS),
      fc.integer({ min: 0, max: 2 }),
      (worktreeState, placement, bounceBound) => {
        const args = [];
        if (placement.runIn === 'paused') {
          args.push('--paused', RUN_TICKET, '--active', OTHER_TICKET);
        } else {
          args.push('--active', RUN_TICKET, '--paused', OTHER_TICKET);
        }
        const root = buildFixture(args);

        // Seed worktree if the generator says "present"
        if (worktreeState === 'present') {
          seedWorktree(root, RUN_TICKET);
        }

        const bounceBoundArg = bounceBound > 0 ? [`--bounce-bound`, String(bounceBound)] : [];
        const result = runExpedite(root, ['--dry-run', ...bounceBoundArg]);

        try {
          // Invariant 1: no stage started
          const stages = ranStages(root);
          assert.deepEqual(stages, [], `expected no stage to run; ran: ${stages.join(',')}`);

          // Invariant 1: no worktree created (if it didn't exist before)
          if (worktreeState === 'absent') {
            assert.ok(!worktreeExists(root, RUN_TICKET), 'worktree was created by dry run');
            assert.ok(!branchExists(root, RUN_TICKET), 'branch was created by dry run');
          }

          // Invariant 1: no backlog move
          assert.ok(ticketInFolder(root, RUN_TICKET, placement.runIn), `ticket moved from ${placement.runIn}`);
          assert.ok(ticketInFolder(root, OTHER_TICKET, placement.otherIn), `other ticket moved from ${placement.otherIn}`);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 15 }
  );
});

test('invariant 2: dry run succeeds and prints a plan whenever a real run could start', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...WORKTREE_STATES),
      fc.constantFrom(...TICKET_PLACEMENTS),
      (worktreeState, placement) => {
        const args = [];
        if (placement.runIn === 'paused') {
          args.push('--paused', RUN_TICKET, '--active', OTHER_TICKET);
        } else {
          args.push('--active', RUN_TICKET, '--paused', OTHER_TICKET);
        }
        const root = buildFixture(args);

        // Seed worktree if the generator says "present"
        if (worktreeState === 'present') {
          seedWorktree(root, RUN_TICKET);
        }

        const result = runExpedite(root, ['--dry-run']);

        try {
          // Invariant 2: succeeds
          assert.equal(result.status, 0, `dry run failed: ${result.out}`);

          // Invariant 2: prints a plan
          assert.match(result.out, /dry-run plan: stages/, `no plan printed: ${result.out}`);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 12 }
  );
});

test('reach floor: without the fix, a real run DOES start stages when worktree exists', () => {
  // This test proves the property is non-vacuous: it shows that WITHOUT the
  // --dry-run flag, the driver DOES start stages when the worktree exists.
  // This is the "deep state" the invariant quantifies over - the state where
  // the old code would have run for real.
  const args = ['--paused', RUN_TICKET, '--active', OTHER_TICKET];
  const root = buildFixture(args);
  seedWorktree(root, RUN_TICKET);

  const result = runExpedite(root, []); // NO --dry-run

  try {
    const stages = ranStages(root);
    assert.ok(stages.length > 0, `expected stages to run without --dry-run; got none: ${result.out}`);
    assert.ok(stages.includes('QA'), `expected the chain to reach QA; ran: ${stages.join(',')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
