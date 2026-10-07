'use strict';

// BL-2044 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Thin Vitest wrapper over the Babashka property
// runner that encodes both invariants against real git fixtures (a
// linked worktree, real cherry-picks): a take-up never leaves the
// ticket's own unlanded commits reachable only from a backup ref, and
// never leaves a worktree mid-merge or mid-cherry-pick.
//
// bl2044_seat_commits_survive_line_move_property_runner.bb is a
// *_property_runner.bb file, which the standing bb suite's own discovery
// predicate does not match (test-file? only matches test_*.sh and
// *_test_runner.bb) - without this wrapper it would never run at all
// (BL-1613's own comment names the same orphaned shape). This wrapper is
// what makes it runnable via `npm run test:properties`
// (vitest.properties.config.mjs) - the ONLY lane that runs it.
//
// Measured solo (real git init/commit/cherry-pick per run, not
// contention-bound): ~51s for the runner's own 60-run default - a higher
// base than the common 20000ms convention is needed so a solo invocation
// of just this file does not time out under propertyLaneTimeoutMs's
// forced factor=1.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'bl2044_seat_commits_survive_line_move_property_runner.bb'
);

test(
  'BL-2044/BL-654: a seat\'s own commits survive a parcel-line move (bb property runner)',
  () => {
    const r = spawnSync('bb', [RUNNER], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PROPERTY_RUNS: process.env.PROPERTY_RUNS || '60',
      },
      timeout: 120000,
    });
    assert.equal(
      r.status,
      0,
      `bl2044 property runner failed:\n${r.stdout || ''}${r.stderr || ''}`
    );
  },
  propertyLaneTimeoutMs(90000)
);
