'use strict';

// BL-1912 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Thin Vitest wrapper over the Babashka property
// runner that encodes both invariants against the real git!/
// daemon-cycle-guard-lib bounded-wait mechanism: a commit hook that does
// not finish inside its bound is killed, never silently passed as
// complete (no --no-verify, no skip), and a commit that does not finish
// leaves HEAD (and so origin/main) untouched.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

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
  'bl1912_land_replay_commit_bound_property_runner.bb'
);

test(
  'BL-1912/BL-654: a replay commit hook either runs to completion or is killed, never both (bb property runner)',
  () => {
    const r = spawnSync('bb', [RUNNER], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PROPERTY_RUNS: process.env.PROPERTY_RUNS || '16',
      },
      timeout: 60000,
    });
    assert.equal(
      r.status,
      0,
      `bl1912 property runner failed:\n${r.stdout || ''}${r.stderr || ''}`
    );
  },
  propertyLaneTimeoutMs(20000)
);
