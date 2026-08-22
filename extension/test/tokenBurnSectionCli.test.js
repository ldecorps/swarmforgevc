const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/token-burn-section');
const { appendUsageAnchor } = require('../out/metrics/usageAnchorStore');

// BL-619: the token-burn-section CLI wires burnProjection.ts (decision) +
// usageAnchorStore.ts (anchors) + burnRate.ts (local rate) +
// burnSectionText.ts (formatting) together - these tests prove the wiring,
// not the pure decision/formatting logic itself (covered in
// burnProjection.test.js / burnSectionText.test.js).

const CLI = path.join(__dirname, '..', 'out', 'tools', 'token-burn-section.js');

function mkTmp() {
  return mkTmpDir('sfvc-token-burn-section-');
}
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}
function mkFixture({ confLines } = {}) {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tmaster\t${root}\tswarmforge-coder\tcoder\tclaude\ttask\n`);
  if (confLines !== undefined) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confLines);
  }
  return root;
}

// 2026-07-24 is a Friday; matches burnProjection.test.js's own baseline.
function localMs(monthDay, hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(2026, 6, monthDay, hour, minute, 0, 0).getTime();
}

// Runs the REAL main() in-process against a real fixture repo, mirroring
// usageAnchorCli.test.js's own identical seam (the CLI main()-thin-wrapper
// rule) - never the only cover for the real logic.
function runCli(root, argv) {
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
  const stdoutWrites = [];
  const stderrWrites = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    stdoutWrites.push(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    stderrWrites.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', 'token-burn-section.js', ...argv];
    main();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.cwd = originalCwd;
    process.argv = originalArgv;
  }
  return { stdout: JSON.parse(stdoutWrites.join('')), stderr: stderrWrites.join('') };
}

function runCliSubprocess(root, argv) {
  const output = execFileSync('node', [CLI, ...argv], {
    encoding: 'utf8',
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  return JSON.parse(output);
}

test('BL-619 warning-leads-briefing-01: a fast single anchor early in the window composes to warn', () => {
  const root = mkFixture({ confLines: 'config usage_week_reset_day thu\nconfig usage_week_reset_local 07:00\n' });
  const nowMs = localMs(24, '09:00');
  appendUsageAnchor(root, nowMs - 2 * 60 * 60 * 1000, 23, 'all-models');
  const { stdout } = runCli(root, ['--now', String(nowMs)]);
  assert.equal(stdout.kind, 'warn');
  assert.equal(stdout.subjectMarker, true);
  assert.match(stdout.leadingText, /TOKEN BURN WARNING/);
});

test('BL-619 ok-path-one-line-status-03: a slow single anchor late in the window composes to ok', () => {
  const root = mkFixture({ confLines: 'config usage_week_reset_day thu\nconfig usage_week_reset_local 07:00\n' });
  const nowMs = localMs(30, '00:00');
  appendUsageAnchor(root, nowMs - 2 * 60 * 60 * 1000, 23, 'all-models');
  const { stdout } = runCli(root, ['--now', String(nowMs)]);
  assert.equal(stdout.kind, 'ok');
  assert.equal(stdout.subjectMarker, false);
  assert.equal(stdout.leadingText, null);
});

test('BL-619 no-anchor-never-fabricates-06: with no anchors recorded the CLI reports no-anchor', () => {
  const root = mkFixture({ confLines: 'config usage_week_reset_day thu\nconfig usage_week_reset_local 07:00\n' });
  const { stdout } = runCli(root, ['--now', String(localMs(24, '10:00'))]);
  assert.equal(stdout.kind, 'no-anchor');
  assert.match(stdout.appendedText, /tokens\/hr/);
});

test('BL-619 malformed-reset-config-08: a malformed reset config degrades to malformed and logs loudly', () => {
  const root = mkFixture({ confLines: 'config usage_week_reset_day funday\n' });
  const { stdout, stderr } = runCli(root, ['--now', String(localMs(24, '10:00'))]);
  assert.equal(stdout.kind, 'malformed');
  assert.match(stderr, /malformed/i);
});

test('BL-619: an absent swarmforge.conf defaults to thu 07:00 rather than malformed', () => {
  const root = mkFixture({});
  const { stdout } = runCli(root, ['--now', String(localMs(24, '10:00'))]);
  assert.equal(stdout.kind, 'no-anchor');
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkFixture({ confLines: 'config usage_week_reset_day thu\nconfig usage_week_reset_local 07:00\n' });
  const printed = runCliSubprocess(root, ['--now', String(localMs(24, '10:00'))]);
  assert.equal(printed.kind, 'no-anchor');
});
