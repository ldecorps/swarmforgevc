'use strict';

// BL-1702 declared invariant (property authorship rests with the coder,
// first pass — BL-654). Thin Vitest wrapper over the Babashka property
// runner that encodes the ticket's own invariant against the pure gate
// decision (local_coder_probe_gate_lib.bb).
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
  'bl1702_local_coder_probe_gate_property_runner.bb'
);

test('BL-1702/BL-654: local coder probe gate invariants hold (bb property runner)', () => {
  const r = spawnSync('bb', [RUNNER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PROPERTY_RUNS: process.env.PROPERTY_RUNS || '400',
    },
    timeout: 60000,
  });
  assert.equal(
    r.status,
    0,
    `bl1702 property runner failed:\n${r.stdout || ''}${r.stderr || ''}`
  );
});
