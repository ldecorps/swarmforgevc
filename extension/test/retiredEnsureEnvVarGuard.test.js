'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RETIRED_ENSURE_ENV_VARS,
  deriveRetiredEnsureEnvVars,
  retiredNeedles,
  retiredSpellingOf,
  scanDirForRetiredEnsureVars,
  scanFileForRetiredEnsureVars,
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

// ── BL-964 hardening (hardender): 3 hand-written needles gated 3 of 11 seams ──
// The three constants above are the vars the 2026-08-20 incident exposed, not
// the vars the mechanism has. swarm_ensure.bb reads ELEVEN SWARM_ENSURE_*
// seams; measured before this change, 8 of 9 retired spellings went unflagged,
// each carrying the identical silent failure - the fake is ignored, the REAL
// command runs, the test still passes. A roster patched one name at a time is
// the shape this ticket exists to end, so the needles are derived from
// swarm_ensure.bb's own reads.

test('every SWARM_ENSURE_* seam swarm_ensure.bb reads has its retired spelling gated', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_ensure.bb'),
    'utf8'
  );
  const realNames = [...new Set(source.match(/\bSWARM_ENSURE_[A-Z_]+/g) || [])];
  assert.ok(realNames.length > 0, 'sanity: swarm_ensure.bb must read at least one seam');

  const needles = retiredNeedles();
  for (const real of realNames) {
    assert.ok(
      needles.includes(retiredSpellingOf(real)),
      `${real} has no gated retired spelling - a fake exported as ` +
        `${retiredSpellingOf(real)} would be silently ignored and the real command would run, ` +
        'which is exactly the failure BL-964 exists to catch'
    );
  }
});

test('a retired spelling of a seam OUTSIDE the original incident is flagged', () => {
  // Assembled from parts so this assertion cannot be satisfied by the literal
  // appearing in this file's own text if the scan is ever pointed here.
  const retired = 'SWARMFORGE_' + 'ENSURE_' + 'BABYSITTERD_CMD';
  const violations = scanFileForRetiredEnsureVars(
    'someSteps.js',
    `process.env.${retired} = 'echo fake';\n`
  );
  assert.equal(violations.length, 1, `${retired} must be flagged; it was not before this gate derived its needles`);
});

test('the historical floor survives - deriving must never SHRINK the gate', () => {
  const needles = retiredNeedles();
  for (const known of RETIRED_ENSURE_ENV_VARS) {
    assert.ok(needles.includes(known), `${known} caused a real incident and must stay gated`);
  }
});

test('an empty derivation fails LOUD rather than passing everything', () => {
  // The one failure this gate must never have: if the seams are renamed and
  // nothing matches, a silently-empty needle set would make every file clean.
  const root = mkTmpDir('sfvc-bl964-empty-derivation-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'swarm_ensure.bb'), ';; no seams here\n');

  assert.throws(
    () => deriveRetiredEnsureEnvVars(root),
    /never let the needle set fall empty/,
    'a swarm_ensure.bb with no SWARM_ENSURE_* names must raise, not yield an empty needle set'
  );
});
