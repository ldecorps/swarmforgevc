'use strict';

// BL-1861 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Thin Vitest wrapper over the Babashka property
// runner that encodes all three invariants against the real local_llm_cli.bb
// (a bare-seat refusal, parcel/worktree/mailbox/model-server survival plus
// never unloading a model no removed seat names, and a non-local-model
// seat's roster row and tmux session surviving remove).
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
  'bl1861_local_llm_remove_property_runner.bb'
);

test(
  'BL-1861/BL-654: local_llm remove invariants hold (bb property runner)',
  () => {
    const r = spawnSync('bb', [RUNNER], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PROPERTY_RUNS: process.env.PROPERTY_RUNS || '20',
      },
      timeout: 120000,
    });
    assert.equal(
      r.status,
      0,
      `bl1861 property runner failed:\n${r.stdout || ''}${r.stderr || ''}`
    );
  },
  propertyLaneTimeoutMs(20000)
);
