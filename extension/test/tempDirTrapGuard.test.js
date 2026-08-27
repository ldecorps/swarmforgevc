const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findTempDirTrapViolation, scanForTempDirTrapViolations } = require('../../specs/pipeline/steps/lib/tempDirTrapGuard');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-872: this guard's verdict (BL-459) was decorative for three weeks - its
// own "zero violations" assertion lived only in specs/pipeline/test/, which
// no standing gate runs; node's --test over that directory is invoked ad
// hoc by roles naming individual files. This file gives it a standing home
// in the ONE suite every parcel runs (`npm test`/`npm run coverage`,
// vitest.config.mjs), mirroring extension/test/tmpDirMigrationGuard.test.js
// (BL-420) for the shell/bb side.
//
// This file does NOT restate the pure-classifier examples already covered
// by specs/pipeline/test/tempDirTrapGuard.test.js (findTempDirTrapViolation)
// or the generative property coverage in tempDirTrapGuard.property.test.js
// (BL-654) - it requires the SAME module (invariant 2: one implementation
// of the scan rules) and adds only what those two do not already prove: the
// scan is actually COLLECTED and enforced by the standing suite.

test('a shell file with an EXIT trap is not flagged (smoke test that the shared module wired in correctly)', () => {
  const text = 'set -euo pipefail\ntrap \'rm -rf "$ROOT"\' EXIT\nROOT="$(mktemp -d)"\n';
  assert.equal(findTempDirTrapViolation('test_example.sh', text), null);
});

test('a babashka file that creates a temp root with no shutdown hook and no try/finally is flagged', () => {
  const text = '(defn mk-tmp [] (str (fs/create-temp-dir {:prefix "x-"})))\n';
  assert.ok(findTempDirTrapViolation('example_test_runner.bb', text));
});

// ── break-then-fix (impure, real fs) - proves the DIRECTORY WALK itself
// reaches disk when driven from THIS suite, not just when node --test is
// invoked by hand against specs/pipeline/test/ ─────────────────────────────

test('flags a violation planted in a fixture dir, then confirms clean once fixed', () => {
  const root = mkTmpDir('sfvc-tempdir-trap-guard-fixture-');
  const offender = path.join(root, 'test_offender.sh');
  fs.writeFileSync(offender, 'set -euo pipefail\nd="$(mktemp -d)"\n');

  const before = scanForTempDirTrapViolations(root);
  assert.equal(before.length, 1);
  assert.equal(before[0].file, offender);

  fs.writeFileSync(offender, 'set -euo pipefail\ntrap \'rm -rf "$d"\' EXIT\nd="$(mktemp -d)"\n');
  const after = scanForTempDirTrapViolations(root);
  assert.deepEqual(after, []);
});

// ── BL-459 tempdir-cleanup-trap-02 / BL-872: the actual migration-complete
// gate, now collected by the standing suite instead of a suite nothing
// runs. required_wiring anchor: this exact filename, this exact assertion.
test('the real swarmforge/scripts tree has zero temp-dir-trap violations', () => {
  const scriptsDir = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  const violations = scanForTempDirTrapViolations(scriptsDir);
  assert.deepEqual(
    violations,
    [],
    `expected zero temp-dir-trap violations under swarmforge/scripts, found:\n${violations.map((v) => `${v.file}: ${v.reason}`).join('\n')}`
  );
});
