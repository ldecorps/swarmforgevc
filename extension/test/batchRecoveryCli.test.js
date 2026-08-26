const test = require('node:test');
const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/batch-recovery');
const { appendSiblingDeferralRecordIfNew } = require('../out/metrics/siblingDeferralStore');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

// BL-588: thin-wrapper CLI tests for batch recovery tooling (approach 3).

function mkRepo() {
  const root = mkTmpDir('sfvc-batch-recovery-cli-');
  copySeededRepoInto(root);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`
  );
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: root });
  return root;
}

async function runCli(root, args) {
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
    process.argv = ['node', 'batch-recovery.js', ...args];
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

test('parseArgs accepts prepare-rework with valid flags', () => {
  const parsed = parseArgs([
    'prepare-rework',
    '--ticket',
    'BL-9001',
    '--batch-commit',
    'b123456789',
    '--ancestor',
    'c123456789',
  ]);
  assert.deepEqual(parsed, {
    command: 'prepare-rework',
    ticket: 'BL-9001',
    batchCommit: 'b123456789',
    ancestor: 'c123456789',
  });
});

test('prepare-re-forward reads BL-532 deferral and preserves the batch commit', async () => {
  const root = mkRepo();
  appendSiblingDeferralRecordIfNew(root, {
    ticket: 'BL-9002',
    blockedBy: 'BL-9001',
    action: 'defer',
    failureClass: 'integration',
    check: 'npm run compile',
    commit: 'b123456789',
    at: '2026-08-26T10:00:00.000Z',
  });
  const result = await runCli(root, [
    'prepare-re-forward',
    '--ticket',
    'BL-9002',
    '--defective-ticket',
    'BL-9001',
  ]);
  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.forwardCommit, 'b123456789');
  assert.equal(payload.recoveryTicket, 'BL-9001');
});

test('validate-land refuses cherry-pick with whole-tree reason', async () => {
  const root = mkRepo();
  const result = await runCli(root, [
    'validate-land',
    '--operation',
    'cherry-pick',
    '--verified-commit',
    '0123456789',
  ]);
  assert.equal(result.exitCode, 4);
  assert.match(result.stderr, /verified whole tree/i);
});
