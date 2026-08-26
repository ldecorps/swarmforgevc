'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findTempDirTrapViolation, scanForTempDirTrapViolations } = require('../steps/lib/tempDirTrapGuard');

// BL-459: the regression guard's own tests. findTempDirTrapViolation is the
// pure per-file scanner (fixture strings, no filesystem);
// scanForTempDirTrapViolations is the real directory walk, proven
// break-then-fix (engineering.prompt's disk-input rule) before trusting it
// against the real swarmforge/scripts tree - mirrors
// extension/test/tmpDirMigrationGuard.test.js's own structure (BL-420) for
// the shell/bb side.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-tempdir-trap-guard-'));
}

// ── findTempDirTrapViolation (pure) ─────────────────────────────────────

test('flags a shell harness that creates a temp root with no trap and no shared source', () => {
  const text = 'set -euo pipefail\nmake_fixture() {\n  local d; d="$(mktemp -d)"\n  printf %s "$d"\n}\n';
  assert.ok(findTempDirTrapViolation('test_example.sh', text));
});

test('does not flag a shell harness with an EXIT trap', () => {
  const text = 'set -euo pipefail\ntrap \'rm -rf "$ROOT"\' EXIT\nROOT="$(mktemp -d)"\n';
  assert.equal(findTempDirTrapViolation('test_example.sh', text), null);
});

test('does not flag a shell harness that sources the shared lib/tmp_cleanup.sh', () => {
  const text = 'set -euo pipefail\nsource "$(dirname "${BASH_SOURCE[0]}")/lib/tmp_cleanup.sh"\nd="$(mktemp -d)"\nregister_tmp_dir "$d"\n';
  assert.equal(findTempDirTrapViolation('test_example.sh', text), null);
});

test('does not flag a shell file with no mktemp -d at all', () => {
  assert.equal(findTempDirTrapViolation('test_other.sh', 'echo hi\n'), null);
});

test('flags a babashka test runner that creates a temp root with no shutdown hook and no try/finally', () => {
  const text = '(defn mk-tmp [] (str (fs/create-temp-dir {:prefix "x-"})))\n';
  assert.ok(findTempDirTrapViolation('example_test_runner.bb', text));
});

test('does not flag a babashka runner that installs a shutdown hook', () => {
  const text = [
    '(def created-temp-dirs (atom []))',
    '(.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (doseq [d @created-temp-dirs] (fs/delete-tree d)))))',
    '(defn mk-tmp [] (let [d (str (fs/create-temp-dir {:prefix "x-"}))] (swap! created-temp-dirs conj d) d))',
  ].join('\n');
  assert.equal(findTempDirTrapViolation('example_test_runner.bb', text), null);
});

test('does not flag a babashka runner that wraps its temp-dir use in try/finally delete-tree', () => {
  const text = ['(let [d (fs/create-temp-dir {:prefix "x-"})]', '  (try', '    (do-something d)', '    (finally (fs/delete-tree d))))'].join('\n');
  assert.equal(findTempDirTrapViolation('example_test_runner.bb', text), null);
});

test('does not flag a babashka file with no create-temp-dir at all', () => {
  assert.equal(findTempDirTrapViolation('example_lib.bb', '(defn foo [] 1)\n'), null);
});

test('never flags the shared lib/tmp_cleanup.sh itself, even though it mentions mktemp -d in its own comments', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'test', 'lib', 'tmp_cleanup.sh'), 'utf8');
  assert.equal(findTempDirTrapViolation('tmp_cleanup.sh', text), null);
});

test('ignores a non-.sh, non-.bb file entirely', () => {
  assert.equal(findTempDirTrapViolation('README.md', 'mktemp -d\n'), null);
});

// ── scanForTempDirTrapViolations (impure, real fs) - break-then-fix ────

test('flags a violation planted in a fixture dir, then confirms clean once fixed', () => {
  const root = mkTmp();
  const offender = path.join(root, 'test_offender.sh');
  fs.writeFileSync(offender, 'set -euo pipefail\nd="$(mktemp -d)"\n');

  const before = scanForTempDirTrapViolations(root);
  assert.equal(before.length, 1);
  assert.equal(before[0].file, offender);

  fs.writeFileSync(offender, 'set -euo pipefail\ntrap \'rm -rf "$d"\' EXIT\nd="$(mktemp -d)"\n');
  const after = scanForTempDirTrapViolations(root);
  assert.deepEqual(after, []);

  fs.rmSync(root, { recursive: true, force: true });
});

test('finds violations nested several directories deep', () => {
  const root = mkTmp();
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  const offender = path.join(nested, 'deep_test_runner.bb');
  fs.writeFileSync(offender, '(fs/create-temp-dir {:prefix "x-"})\n');

  const violations = scanForTempDirTrapViolations(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, offender);

  fs.rmSync(root, { recursive: true, force: true });
});

test('a clean fixture tree has zero violations', () => {
  const root = mkTmp();
  fs.writeFileSync(path.join(root, 'test_clean.sh'), 'set -euo pipefail\ntrap \'rm -rf "$d"\' EXIT\nd="$(mktemp -d)"\n');
  fs.writeFileSync(path.join(root, 'clean_test_runner.bb'), '(.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] nil)))\n(fs/create-temp-dir {:prefix "x-"})\n');

  assert.deepEqual(scanForTempDirTrapViolations(root), []);

  fs.rmSync(root, { recursive: true, force: true });
});

// ── BL-459 tempdir-cleanup-trap-02: the actual migration-complete gate ──

test('the real swarmforge/scripts tree has zero temp-dir-trap violations', () => {
  const scriptsDir = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
  const violations = scanForTempDirTrapViolations(scriptsDir);
  assert.deepEqual(
    violations,
    [],
    `expected zero temp-dir-trap violations under swarmforge/scripts, found:\n${violations.map((v) => `${v.file}: ${v.reason}`).join('\n')}`
  );
});
