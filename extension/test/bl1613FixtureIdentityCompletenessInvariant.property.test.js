'use strict';

// BL-1613 declared invariant (property authorship rests with the coder,
// first pass — BL-654). Thin Vitest wrapper over the Babashka property
// runner that pins "the fixture is a swarm root the launcher could have
// made": every key backlog_depth_lib.bb reads from a swarm-identity
// (derived from that library's own real source, never a hand-maintained
// duplicate) is present and names a file that exists under the root.
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
  'bl1613_launcher_shaped_identity_property_runner.bb'
);

test('BL-1613/BL-654: the launcher-shaped-identity invariant holds (bb property runner)', () => {
  const r = spawnSync('bb', [RUNNER], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `bl1613 property runner failed:\n${r.stdout || ''}${r.stderr || ''}`);
});
