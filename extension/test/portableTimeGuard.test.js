const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findPortableTimeViolation, scanForPortableTimeViolations } = require('../../specs/pipeline/steps/lib/portableTimeGuard');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-874: gives the "zero GNU-only relative-time invocations under
// swarmforge/scripts" check a standing home in the ONE suite every parcel
// runs (`npm test`/`npm run coverage`, vitest.config.mjs), mirroring
// extension/test/tempDirTrapGuard.test.js (BL-872) for the same reason: a
// check with no standing consumer is decorative, and this repo has already
// hit that failure mode twice before (BL-420 -> BL-459 -> BL-872).
//
// This file does not restate the generative property coverage in
// bl874PortableTimeInvariants.property.test.js (BL-654) - it requires the
// SAME module and adds only what that file does not already prove: the
// scan is actually collected and enforced by the standing suite.

test('a shell file that backdates via portable_touch_relative is not flagged (smoke test that the shared module wired in correctly)', () => {
  const text = 'source "$SCRIPT_DIR/portable_time_lib.sh"\nold_mtime() { portable_touch_relative 2 hours "$1"; }\n';
  assert.equal(findPortableTimeViolation('test_example.sh', text), null);
});

test('a shell file with an inline GNU-only touch -d relative spec is flagged', () => {
  const text = 'old_mtime() { touch -d "2 hours ago" "$1"; }\n';
  assert.ok(findPortableTimeViolation('test_example.sh', text));
});

test('a shell file with an inline GNU-only date -d relative spec is flagged', () => {
  const text = 'PAST_TIME=$(date -d "90 seconds ago" "+%Y-%m-%d %H:%M:%S")\n';
  assert.ok(findPortableTimeViolation('test_example.sh', text));
});

test('an absolute touch -d spec is not flagged (works on both BSD and GNU, not the defect this guards)', () => {
  const text = 'touch -d "2026-01-01T00:00:00" "$1"\n';
  assert.equal(findPortableTimeViolation('test_example.sh', text), null);
});

test('the shared helper file itself is exempt (its GNU fallback branch legitimately contains the pattern)', () => {
  const text = 'date -d "${amount} ${unit} ago" "+%Y%m%d%H%M.%S"\n';
  assert.equal(findPortableTimeViolation('portable_time_lib.sh', text), null);
});

// ── break-then-fix (impure, real fs) - proves the DIRECTORY WALK itself
// reaches disk when driven from THIS suite ─────────────────────────────

test('flags a violation planted in a fixture dir, then confirms clean once fixed', () => {
  const root = mkTmpDir('sfvc-portable-time-guard-fixture-');
  const offender = path.join(root, 'test_offender.sh');
  fs.writeFileSync(offender, 'old_mtime() { touch -d "2 hours ago" "$1"; }\n');

  const before = scanForPortableTimeViolations(root);
  assert.equal(before.length, 1);
  assert.equal(before[0].file, offender);

  fs.writeFileSync(offender, 'old_mtime() { portable_touch_relative 2 hours "$1"; }\n');
  const after = scanForPortableTimeViolations(root);
  assert.deepEqual(after, []);
});

// ── BL-874 required_wiring: the real zero-violation gate, in the standing
// suite instead of a suite nothing runs ─────────────────────────────────
test('the real swarmforge/scripts tree has zero GNU-only relative-time violations', () => {
  const scriptsDir = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  const violations = scanForPortableTimeViolations(scriptsDir);
  assert.deepEqual(
    violations,
    [],
    `expected zero GNU-only relative-time violations under swarmforge/scripts, found:\n${violations.map((v) => `${v.file}: ${v.reason}`).join('\n')}`
  );
});
