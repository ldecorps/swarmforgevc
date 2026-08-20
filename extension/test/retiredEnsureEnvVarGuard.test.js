'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RETIRED_ENSURE_ENV_VARS,
  scanDirForRetiredEnsureVars,
  scanTreeForRetiredEnsureVars,
} = require('./helpers/retiredEnsureEnvVarGuard');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-964: the standing-suite lane for the retired-prefix regression gate
// (same shape as tempDirTrapGuard.test.js / socketFixtureShortRootGuard
// .test.js): the helpers module owns the needles and the walk, this file
// proves the scan is COLLECTED and enforced by the one suite every parcel
// runs (`npm test`, vitest.config.mjs). This file lives outside the
// guarded directories, so spelling the literals here is allowed.

const REPO_ROOT = path.join(__dirname, '..', '..');

test('the retired set covers exactly the three incident vars', () => {
  assert.deepEqual(RETIRED_ENSURE_ENV_VARS, [
    'SWARMFORGE_ENSURE_EXTENSION_CHECK',
    'SWARMFORGE_ENSURE_EXTENSION_BOUNCE',
    'SWARMFORGE_ENSURE_SUPERVISOR',
  ]);
});

test('a prefix-only comment mention ("SWARMFORGE_ENSURE_*") is never flagged - the needles are the full names', () => {
  const root = mkTmpDir('sfvc-bl964-prefix-');
  fs.writeFileSync(
    path.join(root, 'example.sh'),
    '# The older SWARMFORGE_ENSURE_* spelling is read by nothing.\nSWARM_ENSURE_EXTENSION_CHECK_CMD=/fake\n'
  );
  assert.deepEqual(scanDirForRetiredEnsureVars(root), []);
});

// ── break-then-fix: the walk reaches disk from this suite ──────────────────

test('flags a planted retired name, naming the file and the string, then confirms clean once fixed', () => {
  const root = mkTmpDir('sfvc-bl964-planted-');
  const offender = path.join(root, 'test_offender.sh');
  fs.writeFileSync(offender, 'export SWARMFORGE_ENSURE_EXTENSION_CHECK=/fake\n');

  const before = scanDirForRetiredEnsureVars(root);
  assert.equal(before.length, 1);
  assert.equal(before[0].file, offender);
  assert.equal(before[0].retired, 'SWARMFORGE_ENSURE_EXTENSION_CHECK');

  fs.writeFileSync(offender, 'export SWARM_ENSURE_EXTENSION_CHECK_CMD=/fake\n');
  assert.deepEqual(scanDirForRetiredEnsureVars(root), []);
});

// ── BL-964: the actual zero-occurrences assertion over the REAL tree ───────

test('the real specs/pipeline/steps and swarmforge/scripts/test trees carry no retired SWARMFORGE_ENSURE_* name', () => {
  const violations = scanTreeForRetiredEnsureVars(REPO_ROOT);
  assert.deepEqual(
    violations,
    [],
    `expected zero retired-prefix occurrences, found:\n${violations.map((v) => `${v.file}: ${v.retired}`).join('\n')}`
  );
});
