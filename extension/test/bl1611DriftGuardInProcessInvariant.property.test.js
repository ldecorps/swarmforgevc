'use strict';

// BL-1611 declared invariant (property authorship rests with the coder,
// first pass — BL-654). Thin Vitest wrapper over the Babashka property
// runner that pins handoff_lib.bb's handoff-files-with-batches - the
// batch-aware reader the drift guard's has-in-process-parcel? now wires
// to - against the invariant:
//
//   "For every roster shape, the drift guard's in-process input is true
//    exactly when a git_handoff or note parcel exists anywhere under the
//    role's in_process box, at the top level or inside a batch_
//    directory."
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
  'bl1611_drift_guard_in_process_property_runner.bb'
);

test('BL-1611/BL-654: the drift guard\'s in-process existence invariant holds (bb property runner)', () => {
  const r = spawnSync('bb', [RUNNER], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `bl1611 property runner failed:\n${r.stdout || ''}${r.stderr || ''}`);
});
