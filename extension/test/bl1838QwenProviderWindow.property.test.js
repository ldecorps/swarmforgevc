'use strict';

// BL-1838 declared invariant (property authorship rests with the coder,
// first pass — BL-654). Thin Vitest wrapper over the Babashka property
// runner that encodes it against resolve-window's real precedence logic.
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
  'bl1838_qwen_provider_window_property_runner.bb'
);

test(
  "BL-1838/BL-654: a local-model seat's qwen context budget always equals the served window when known, else the swarm's context length, else no entry (bb property runner)",
  () => {
    const r = spawnSync('bb', [RUNNER], {
      encoding: 'utf8',
      env: { ...process.env, PROPERTY_RUNS: process.env.PROPERTY_RUNS || '200' },
      timeout: 60000,
    });
    assert.equal(r.status, 0, `bl1838 property runner failed:\n${r.stdout || ''}${r.stderr || ''}`);
  },
  propertyLaneTimeoutMs(20000)
);
