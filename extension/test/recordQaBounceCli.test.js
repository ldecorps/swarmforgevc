const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/record-qa-bounce');
const { readQaBounceRecords } = require('../out/quality/qaBounceStore');

// BL-454: the go-forward writer CLI QA runs at bounce time. Flag contract
// (--ticket/--role/--type/--class/--commit) matches swarmforge/roles/
// QA.prompt's own caller exactly (specifier commit dc056df79c).

const CLI = path.join(__dirname, '..', 'out', 'tools', 'record-qa-bounce.js');

function mkTmp(prefix) {
  return mkTmpDir(prefix);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(root) {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
}

function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

function mkRepo() {
  const root = mkTmp('sfvc-record-qa-bounce-repo-');
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'seed roles.tsv');
  return root;
}

function flagArgs({ ticket = 'BL-340', role = 'coder', type = 'feature', cls = 'behavior', commit = 'abc1234567' } = {}) {
  return ['--ticket', ticket, '--role', role, '--type', type, '--class', cls, '--commit', commit];
}

// Runs the REAL main() in-process against a real fixture repo (the CLI
// main()-thin-wrapper rule) - stubs process.cwd (resolveCliMainWorktreeContext
// reads it) and process.argv, restoring both in a `finally` so a later test
// file in the same Vitest worker never inherits a moved cwd.
async function runCli(root, args) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', CLI, ...args];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = previousArgv;
  }
  return writes.length > 0 ? JSON.parse(writes.join('')) : null;
}

function runCliSubprocess(root, args) {
  const out = execFileSync('node', [CLI, ...args], { cwd: root, encoding: 'utf8' });
  return JSON.parse(out);
}

// ── parseArgs (in-process validation) ────────────────────────────────────

test('parseArgs accepts a fully valid invocation, flags in the QA.prompt order', () => {
  assert.deepEqual(parseArgs(flagArgs()), {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'abc1234567',
  });
});

test('parseArgs accepts flags in any order', () => {
  assert.deepEqual(parseArgs(['--commit', 'abc1234567', '--class', 'behavior', '--ticket', 'BL-340', '--type', 'feature', '--role', 'coder']), {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'abc1234567',
  });
});

test('parseArgs upcases a lowercase ticket id', () => {
  assert.equal(parseArgs(flagArgs({ ticket: 'bl-340' })).ticket, 'BL-340');
});

test('parseArgs rejects a ticket id with no BL- prefix', () => {
  assert.equal(parseArgs(flagArgs({ ticket: '340' })), null);
});

test('parseArgs rejects a producingRole outside the closed set', () => {
  assert.equal(parseArgs(flagArgs({ role: 'QA' })), null);
});

test('parseArgs rejects a ticketType outside the closed set', () => {
  assert.equal(parseArgs(flagArgs({ type: 'spike' })), null);
});

test('parseArgs rejects a failureClass outside the closed set', () => {
  assert.equal(parseArgs(flagArgs({ cls: 'scope' })), null);
});

test('parseArgs rejects a missing commit', () => {
  assert.equal(parseArgs(['--ticket', 'BL-340', '--role', 'coder', '--type', 'feature', '--class', 'behavior']), null);
});

test('parseArgs rejects an unrecognized flag', () => {
  assert.equal(parseArgs(['--bogus', 'x', '--role', 'coder', '--type', 'feature', '--class', 'behavior', '--commit', 'abc1234567']), null);
});

test('parseArgs rejects a flag with no following value', () => {
  assert.equal(parseArgs(['--ticket', 'BL-340', '--role']), null);
});

// ── end-to-end: recording a bounce (qa-bounce-01) ────────────────────────

test('BL-454: recording a bounce captures its producing role, ticket type, and failure class', async () => {
  const root = mkRepo();
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);
  const records = readQaBounceRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].ticket, 'BL-340');
  assert.equal(records[0].producingRole, 'coder');
  assert.equal(records[0].ticketType, 'feature');
  assert.equal(records[0].failureClass, 'behavior');
  assert.ok(Date.parse(records[0].at), 'expected a real ISO `at` timestamp');
});

// ── qa-bounce-02: idempotency ─────────────────────────────────────────────

test('BL-454: recording the same bounce twice does not double-count it', async () => {
  const root = mkRepo();
  await runCli(root, flagArgs());
  const second = await runCli(root, flagArgs({ commit: 'deadbeef00' }));
  assert.equal(second.recorded, false);
  assert.equal(readQaBounceRecords(root).length, 1);
});

// ── usage guard ────────────────────────────────────────────────────────

test('an invalid invocation exits non-zero with a usage message, never a raw crash', async () => {
  const root = mkRepo();
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const result = await runCli(root, ['--ticket', 'not-a-ticket']);
    assert.equal(result, null);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

// A single subprocess smoke test locks the compiled CLI's own wiring - an
// ADDITION to the in-process tests above, never the only cover for the real
// logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkRepo();
  const result = runCliSubprocess(root, flagArgs());
  assert.equal(result.recorded, true);
  assert.equal(readQaBounceRecords(root).length, 1);
});
