const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { main: liftMain, parseArgs: parseLiftArgs } = require('../out/tools/quarantine-lift-check');
const { main: recoveryMain, parseArgs: parseRecoveryArgs } = require('../out/tools/recovery-filter-check');
const { appendBounceRecordIfNew } = require('../out/metrics/bounceStore');

// BL-1211 hardening: quarantine-lift-check.ts and recovery-filter-check.ts
// (the CLI thin wrappers for scenarios 06-08) were exercised only via
// specs/pipeline/steps/bl1211QuarantineLiftAuthorshipSteps.js, which drives
// the COMPILED CLI as a subprocess - that gives zero in-process coverage of
// parseArgs or main(), the CLI-entrypoint CRAP trap (hardener.prompt). This
// file gives both parseArgs functions direct unit coverage (every branch,
// including the failure shapes the subprocess acceptance run never reaches:
// unknown flag, missing required flag, unknown --by role, empty --paths)
// and drives main() in-process against a real git fixture, mirroring
// batchRecoveryCli.test.js / recordBounceCorrectionCli.test.js's shape.

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(root, file, content, message, byline) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  git(root, ['add', file]);
  git(root, ['commit', '-q', '-m', `${message}\n\nBy ${byline}.`]);
  return git(root, ['rev-parse', 'HEAD']);
}

function mkRepo() {
  const root = mkTmpDir('sfvc-bl1211-cli-');
  copySeededRepoInto(root);
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect']);
  return root;
}

async function runMain(main, root, argv) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const errWrites = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    errWrites.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', 'cli.js', ...argv];
    process.exitCode = undefined;
    await main();
    return { exitCode: process.exitCode ?? 0, stdout: writes.join(''), stderr: errWrites.join('') };
  } finally {
    process.cwd = originalCwd;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
  }
}

// ── quarantineLiftCliArgs / quarantine-lift-check.ts::parseArgs ──────────

test('parseArgs (lift): accepts --root and --by, --branch optional', () => {
  assert.deepEqual(parseLiftArgs(['--root', '/r', '--by', 'architect']), { root: '/r', by: 'architect', branch: undefined });
  assert.deepEqual(parseLiftArgs(['--root', '/r', '--by', 'architect', '--branch', 'foo']), {
    root: '/r',
    by: 'architect',
    branch: 'foo',
  });
});

test('parseArgs (lift): rejects a missing --root, missing --by, unknown --by role, and an unknown flag', () => {
  assert.equal(parseLiftArgs(['--by', 'architect']), null, 'missing --root');
  assert.equal(parseLiftArgs(['--root', '/r']), null, 'missing --by');
  assert.equal(parseLiftArgs(['--root', '/r', '--by', 'not-a-role']), null, 'unknown role');
  assert.equal(parseLiftArgs(['--root', '/r', '--by', 'architect', '--nope', 'x']), null, 'unknown flag');
});

// ── recoveryFilterCliArgs / recovery-filter-check.ts::parseArgs ──────────

test('parseArgs (recovery): accepts every required flag and splits --paths on commas', () => {
  assert.deepEqual(parseRecoveryArgs(['--root', '/r', '--by', 'architect', '--sibling', 'swarmforge-hardender', '--paths', 'a.ts,b.ts']), {
    root: '/r',
    by: 'architect',
    sibling: 'swarmforge-hardender',
    paths: ['a.ts', 'b.ts'],
  });
});

test('parseArgs (recovery): rejects a missing required flag, unknown role, empty --paths, and an unknown flag', () => {
  const full = ['--root', '/r', '--by', 'architect', '--sibling', 's', '--paths', 'a.ts'];
  assert.equal(parseRecoveryArgs(['--by', 'architect', '--sibling', 's', '--paths', 'a.ts']), null, 'missing --root');
  assert.equal(parseRecoveryArgs(['--root', '/r', '--sibling', 's', '--paths', 'a.ts']), null, 'missing --by');
  assert.equal(parseRecoveryArgs(['--root', '/r', '--by', 'architect', '--paths', 'a.ts']), null, 'missing --sibling');
  assert.equal(parseRecoveryArgs(['--root', '/r', '--by', 'architect', '--sibling', 's']), null, 'missing --paths');
  assert.equal(parseRecoveryArgs(['--root', '/r', '--by', 'nope', '--sibling', 's', '--paths', 'a.ts']), null, 'unknown role');
  assert.equal(parseRecoveryArgs(['--root', '/r', '--by', 'architect', '--sibling', 's', '--paths', '']), null, 'empty --paths string');
  assert.equal(parseRecoveryArgs([...full, '--nope', 'x']), null, 'unknown flag');
});

test('parseArgs (recovery): rejects a non-empty --paths string that splits into nothing but empty segments', () => {
  assert.equal(
    parseRecoveryArgs(['--root', '/r', '--by', 'architect', '--sibling', 's', '--paths', ',,']),
    null,
    'a non-empty string of bare commas has no real path in it once filtered'
  );
});

// ── main() in-process, real git fixture ───────────────────────────────────

test('quarantine-lift-check main(): granted:true, exit 0 on a clean branch', async () => {
  const root = mkRepo();
  const result = await runMain(liftMain, root, ['--root', root, '--by', 'architect']);
  assert.equal(result.exitCode, 0);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.granted, true);
});

test('quarantine-lift-check main(): granted:false, exit 1, names the unauthorized path', async () => {
  const root = mkRepo();
  const bouncedCommit = commitFile(root, 'src/thing.ts', 'bounced content\n', 'BL-9001: adds thing.ts', 'coder');
  commitFile(root, 'src/thing.ts', 'pre-bounce content\n', 'BL-9001: revert bounced content out', 'architect');
  appendBounceRecordIfNew(root, {
    ticket: 'BL-9001',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: bouncedCommit,
    by: 'architect',
    at: new Date().toISOString(),
  });
  commitFile(root, 'src/thing.ts', 'bounced content\n', 'recovery: restore thing.ts', 'coordinator');
  const result = await runMain(liftMain, root, ['--root', root, '--by', 'architect']);
  assert.equal(result.exitCode, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.granted, false);
  assert.deepEqual(verdict.refusedPaths, ['src/thing.ts']);
});

test('quarantine-lift-check main(): prints usage and exit 1 on invalid args, without calling the adapter', async () => {
  const root = mkRepo();
  const result = await runMain(liftMain, root, ['--by', 'architect']);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Usage: quarantine-lift-check/);
  assert.equal(result.stdout, '', 'no verdict JSON printed on a usage failure');
});

test('recovery-filter-check main(): exit 0 when every candidate path is safe to restore', async () => {
  const root = mkRepo();
  const result = await runMain(recoveryMain, root, [
    '--root',
    root,
    '--by',
    'architect',
    '--sibling',
    'main',
    '--paths',
    'src/unrelated.ts',
  ]);
  assert.equal(result.exitCode, 0);
  const decisions = JSON.parse(result.stdout);
  assert.deepEqual(decisions, [{ path: 'src/unrelated.ts', restore: true }]);
});

test('recovery-filter-check main(): exit 1 and holds back an unauthorized resurrection, restores the rest', async () => {
  const root = mkRepo();
  const bouncedCommit = commitFile(root, 'src/thing.ts', 'bounced content\n', 'BL-9002: adds thing.ts', 'coder');
  commitFile(root, 'src/thing.ts', 'pre-bounce content\n', 'BL-9002: revert bounced content out', 'architect');
  appendBounceRecordIfNew(root, {
    ticket: 'BL-9002',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: bouncedCommit,
    by: 'architect',
    at: new Date().toISOString(),
  });
  git(root, ['checkout', '-q', '-b', 'swarmforge-hardender', 'main']);
  commitFile(root, 'src/thing.ts', 'bounced content\n', 'hardender: unrelated work', 'hardener');
  commitFile(root, 'src/unrelated.ts', 'unrelated\n', 'hardender: also adds unrelated.ts', 'hardener');
  git(root, ['checkout', '-q', 'swarmforge-architect']);

  const result = await runMain(recoveryMain, root, [
    '--root',
    root,
    '--by',
    'architect',
    '--sibling',
    'swarmforge-hardender',
    '--paths',
    'src/thing.ts,src/unrelated.ts',
  ]);
  assert.equal(result.exitCode, 1);
  const decisions = JSON.parse(result.stdout);
  assert.deepEqual(
    decisions.sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: 'src/thing.ts', restore: false },
      { path: 'src/unrelated.ts', restore: true },
    ]
  );
});

test('recovery-filter-check main(): prints usage and exit 1 on invalid args, without calling the adapter', async () => {
  const root = mkRepo();
  const result = await runMain(recoveryMain, root, ['--root', root, '--by', 'architect']);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Usage: recovery-filter-check/);
  assert.equal(result.stdout, '', 'no decisions JSON printed on a usage failure');
});
