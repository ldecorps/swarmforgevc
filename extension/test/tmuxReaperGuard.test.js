const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findTmuxReaperViolation, scanForTmuxReaperViolations } = require('../../specs/pipeline/steps/lib/tmuxReaperGuard');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-817: gives the tmux-reaper-adoption guard a standing home in the ONE
// suite every parcel runs (`npm test`/`npm run coverage`, vitest.config.mjs)
// - mirrors extension/test/tempDirTrapGuard.test.js (BL-872) for the
// sibling temp-dir-trap concern, so this check is never merely decorative
// in specs/pipeline/test/, which no standing gate runs.

test('a file with no tmux server start at all is not flagged', () => {
  const text = "fetch('/lets-talk/new-session');\nconsole.log('data-testid=\"lets-talk-new-session\"');\n";
  assert.equal(findTmuxReaperViolation('example.js', text), null);
});

test('a file that starts a tmux server but never requires fixtureReaper is flagged', () => {
  const text = "execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', name]);\n";
  assert.ok(findTmuxReaperViolation('example.js', text));
});

test('a file that requires fixtureReaper but never calls track() is still flagged', () => {
  const text = "const { reap } = require('./lib/fixtureReaper');\nexecFileSync('tmux', ['-S', sock, 'new-session', '-d']);\n";
  assert.ok(findTmuxReaperViolation('example.js', text));
});

test('a file that requires fixtureReaper and calls track() is not flagged', () => {
  const text = "const { track } = require('./lib/fixtureReaper');\ntrack(root);\nexecFileSync('tmux', ['-S', sock, 'new-session', '-d']);\n";
  assert.equal(findTmuxReaperViolation('example.js', text), null);
});

// ── break-then-fix (impure, real fs) - proves the DIRECTORY WALK itself
// reaches disk when driven from THIS suite ─────────────────────────────

test('flags a violation planted in a fixture dir, then confirms clean once fixed', () => {
  const root = mkTmpDir('sfvc-tmux-reaper-guard-fixture-');
  const offender = path.join(root, 'exampleSteps.js');
  fs.writeFileSync(offender, "execFileSync('tmux', ['-S', sock, 'new-session', '-d']);\n");

  const before = scanForTmuxReaperViolations(root);
  assert.equal(before.length, 1);
  assert.equal(before[0].file, offender);

  fs.writeFileSync(
    offender,
    "const { track } = require('./lib/fixtureReaper');\ntrack(root);\nexecFileSync('tmux', ['-S', sock, 'new-session', '-d']);\n"
  );
  const after = scanForTmuxReaperViolations(root);
  assert.deepEqual(after, []);
});

// A nested lib/ subdirectory must be ignored - fixtureReaper.js and its own
// abnormal-exit harness legitimately call track() directly, not as a step
// handler; the scan is deliberately non-recursive over specs/pipeline/
// steps/*.js only.
test('does not recurse into a lib/ subdirectory', () => {
  const root = mkTmpDir('sfvc-tmux-reaper-guard-fixture-');
  fs.mkdirSync(path.join(root, 'lib'));
  fs.writeFileSync(path.join(root, 'lib', 'fixtureReaper.js'), "execFileSync('tmux', ['-S', sock, 'new-session', '-d']);\n");
  assert.deepEqual(scanForTmuxReaperViolations(root), []);
});

// ── BL-817's own gate: the actual adoption-complete check, collected by
// the standing suite instead of a suite nothing runs. required_wiring
// anchor: this exact filename, this exact assertion.
test('the real specs/pipeline/steps tree has zero tmux-reaper violations', () => {
  const stepsDir = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps');
  const violations = scanForTmuxReaperViolations(stepsDir);
  assert.deepEqual(
    violations,
    [],
    `expected zero tmux-reaper violations under specs/pipeline/steps, found:\n${violations.map((v) => `${v.file}: ${v.reason}`).join('\n')}`
  );
});
