'use strict';

// BL-1052 declared invariants (property authorship rests with the coder,
// first pass — BL-654). Thin Vitest wrapper over the Babashka property
// runner that encodes all three invariants against the live capability map,
// launch adapter and pack family.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'bl1052_local_model_seat_property_runner.bb'
);

test('BL-1052/BL-654: local-model seat invariants hold (bb property runner)', () => {
  const r = spawnSync('bb', [RUNNER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PROPERTY_RUNS: process.env.PROPERTY_RUNS || '80',
      PROPERTY_LAUNCH_RUNS: process.env.PROPERTY_LAUNCH_RUNS || '16',
    },
    timeout: 180000,
  });
  assert.equal(
    r.status,
    0,
    `bl1052 property runner failed:\n${r.stdout || ''}${r.stderr || ''}`
  );
});
