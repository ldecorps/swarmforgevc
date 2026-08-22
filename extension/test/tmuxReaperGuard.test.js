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

// ── BL-1032: scope by the HAZARD, not by a quoted token ───────────────────
// BL-817's guard decided scope with /['"]new-session['"]/ and its own comment
// explains the quoting: prose and URLs must never false-positive, because
// "every real tmux-server starter in this repo passes 'new-session' as its own
// argv array element". The converse was never checked, and it is where the
// guard broke: a file that ASSERTS ABOUT tmux argv also writes 'new-session'
// as a quoted argv element, because it is comparing against argv.
//
// bl1018SingleRoleRepairNeverKillsServerSteps.js is exactly that shape. Its
// header says "Nothing here runs tmux, and that is the design, not a
// shortcut". It was RED BECAUSE IT IS CORRECT, and the two ways to green it
// were to add a reaper call guarding nothing or to obfuscate the string - a
// guard whose cheapest satisfying move is to write a lie is not measuring the
// hazard it names.

test('BL-1032: a file that only ASSERTS about tmux argv is not in scope', () => {
  const text = [
    "const creates = ctx.commands.filter((c) => has(c, 'new-session'));",
    "assert.ok(!has(cmd, 'kill-server'), 'no repair may kill the server');",
    "execFileSync('bb', ['-e', expr], { encoding: 'utf8' });",
  ].join('\n');
  assert.equal(findTmuxReaperViolation('asserting.js', text), null,
    'asserting about argv starts no server, so there is nothing to reap');
});

test('BL-1032: a file that SPAWNS tmux directly stays in scope', () => {
  const text = "execFileSync('tmux', ['-S', sock, 'new-session', '-d']);";
  assert.ok(findTmuxReaperViolation('spawning.js', text),
    'a direct tmux spawn is the hazard this guard exists for');
});

test('BL-1032: a file that reaches tmux through a PATH stub stays in scope', () => {
  // bl958ControlPlaneLossSteps.js's shape, and the measured reason the obvious
  // fix is wrong: keying purely on a literal tmux spawn would exempt it. It
  // happens to be compliant today, so exempting it would regress nothing
  // VISIBLE - which is exactly what makes that hole worth closing before it is
  // dug.
  const text = [
    "fs.writeFileSync(path.join(root, 'bin', 'tmux'), stubSource);",
    "fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);",
    "env.PATH = `${path.join(ctx.root, 'bin')}:${env.PATH}`;",
    "execFileSync('bb', [script], { env });",
    "const creates = commands.filter((c) => has(c, 'new-session'));",
  ].join('\n');
  assert.ok(findTmuxReaperViolation('stubbing.js', text),
    'a file that puts a tmux on PATH can still cause one to run');
});

test('BL-1032: an in-scope file that adopts the reaper is still clean', () => {
  const text = [
    "const { track } = require('./lib/fixtureReaper');",
    "execFileSync('tmux', ['-S', sock, 'new-session', '-d']);",
    'track(sock);',
  ].join('\n');
  assert.equal(findTmuxReaperViolation('ok.js', text), null);
});

test('BL-1032: the token alone no longer puts a file in scope', () => {
  // The whole defect in one assertion.
  assert.equal(findTmuxReaperViolation('prose.js', "// we never call 'new-session' here"), null);
});
