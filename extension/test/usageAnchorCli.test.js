const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/usage-anchor');
const { readUsageAnchors } = require('../out/metrics/usageAnchorStore');

// BL-619 anchor-validation-07: the CLI is a thin wrapper over
// usageAnchorStore.ts's appendUsageAnchor - these wiring tests prove argv
// parsing and the disk write/failure paths are load-bearing.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'usage-anchor.js');

function mkTmp() {
  return mkTmpDir('sfvc-usage-anchor-cli-');
}
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}
function mkFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tmaster\t${root}\tswarmforge-coder\tcoder\tclaude\ttask\n`);
  return root;
}

// Runs the REAL main() in-process against a real fixture repo, mirroring
// applyCooldownPauseCli.test.js's own identical seam (the CLI
// main()-thin-wrapper rule) - never the only cover for the real logic.
function runCli(root, argv) {
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
  const stdoutWrites = [];
  const stderrWrites = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalExitCode = process.exitCode;
  process.stdout.write = (chunk) => {
    stdoutWrites.push(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    stderrWrites.push(chunk);
    return true;
  };
  process.exitCode = undefined;
  try {
    process.cwd = () => root;
    process.argv = ['node', 'usage-anchor.js', ...argv];
    main();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.cwd = originalCwd;
    process.argv = originalArgv;
  }
  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;
  return { stdout: stdoutWrites.join(''), stderr: stderrWrites.join(''), exitCode };
}

function runCliSubprocess(root, argv) {
  return execFileSync('node', [CLI, ...argv], { encoding: 'utf8', cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
}

test('parseArgs rejects an unknown command', () => {
  const parsed = parseArgs(['bogus'], 1000);
  assert.ok('error' in parsed);
  assert.match(parsed.error, /unknown command/);
});

test('parseArgs rejects a non-numeric pct', () => {
  const parsed = parseArgs(['record', 'not-a-number'], 1000);
  assert.ok('error' in parsed);
  assert.match(parsed.error, /pct must be a number/);
});

test('parseArgs defaults scope and now when omitted', () => {
  const parsed = parseArgs(['record', '23'], 1000);
  assert.deepEqual(parsed, { command: 'record', pct: 23, scope: 'all-models', nowMs: 1000 });
});

test('parseArgs accepts an explicit scope and --now override', () => {
  const parsed = parseArgs(['record', '23', 'fable-only', '--now', '5000'], 1000);
  assert.deepEqual(parsed, { command: 'record', pct: 23, scope: 'fable-only', nowMs: 5000 });
});

// anchor-validation-07: persists the checkpoint
test('BL-619 anchor-validation-07: recording a valid pct persists it and prints confirmation JSON', () => {
  const root = mkFixture();
  const { stdout, exitCode } = runCli(root, ['record', '23', '--now', '1784980800000']);
  assert.equal(exitCode, undefined);
  const printed = JSON.parse(stdout);
  assert.equal(printed.recorded, true);
  assert.equal(printed.pct, 23);
  assert.deepEqual(readUsageAnchors(root), [{ atMs: 1784980800000, pct: 23, scope: 'all-models' }]);
});

// anchor-validation-07: rejects the value
test('BL-619 anchor-validation-07: recording an out-of-range pct exits non-zero and writes nothing', () => {
  const root = mkFixture();
  const { stderr, exitCode } = runCli(root, ['record', '130', '--now', '1784980800000']);
  assert.equal(exitCode, 1);
  assert.match(stderr, /0\.\.100/);
  assert.deepEqual(readUsageAnchors(root), []);
});

test('BL-619 anchor-validation-07: a negative pct is also rejected', () => {
  const root = mkFixture();
  const { exitCode } = runCli(root, ['record', '-5', '--now', '1784980800000']);
  assert.equal(exitCode, 1);
  assert.deepEqual(readUsageAnchors(root), []);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkFixture();
  const output = runCliSubprocess(root, ['record', '42', 'fable-only', '--now', '1784980800000']);
  const printed = JSON.parse(output);
  assert.equal(printed.recorded, true);
  assert.deepEqual(readUsageAnchors(root), [{ atMs: 1784980800000, pct: 42, scope: 'fable-only' }]);
});
