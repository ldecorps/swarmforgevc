const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/qa-sibling-check');
const { readSiblingDeferralRecords } = require('../out/metrics/siblingDeferralStore');

// BL-532: the CLI QA runs to disposition a batch parcel - status/defer/clear
// over the sibling-deferral store.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'qa-sibling-check.js');

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
  const root = mkTmp('sfvc-qa-sibling-check-repo-');
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'seed roles.tsv');
  return root;
}

// Runs the REAL main() in-process against a real fixture repo (CLI
// main()-thin-wrapper rule) - stubs process.cwd/argv, restoring both in a
// `finally` so a later test file in the same Vitest worker never inherits a
// moved cwd or leaked exit code.
async function runCli(root, args) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const logs = [];
  const originalLog = console.log;
  console.log = (line) => logs.push(line);
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', CLI, ...args];
    process.exitCode = undefined;
    await main();
    return { exitCode: process.exitCode ?? 0, logs, stdout: writes.join('') };
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

function runCliSubprocess(root, args) {
  return execFileSync('node', [CLI, ...args], { cwd: root, encoding: 'utf8' });
}

function deferArgs({ ticket = 'BL-477', blockedBy = 'BL-469', cls = 'integration', check = 'npm run compile', commit = 'abc1234567' } = {}) {
  return ['defer', '--ticket', ticket, '--blocked-by', blockedBy, '--class', cls, '--check', check, '--commit', commit];
}

function clearArgs({ ticket = 'BL-477', blockedBy = 'BL-469', commit = 'def4567890' } = {}) {
  return ['clear', '--ticket', ticket, '--blocked-by', blockedBy, '--commit', commit];
}

// ── parseArgs ──────────────────────────────────────────────────────────

test('parseArgs accepts a valid status invocation and upcases the ticket', () => {
  assert.deepEqual(parseArgs(['status', '--ticket', 'bl-477']), { command: 'status', ticket: 'BL-477' });
});

test('parseArgs accepts a valid defer invocation', () => {
  assert.deepEqual(parseArgs(deferArgs()), {
    command: 'defer',
    ticket: 'BL-477',
    blockedBy: 'BL-469',
    failureClass: 'integration',
    check: 'npm run compile',
    commit: 'abc1234567',
  });
});

test('parseArgs accepts a valid clear invocation', () => {
  assert.deepEqual(parseArgs(clearArgs()), { command: 'clear', ticket: 'BL-477', blockedBy: 'BL-469', commit: 'def4567890' });
});

test('parseArgs rejects an unknown subcommand', () => {
  assert.equal(parseArgs(['bogus', '--ticket', 'BL-477']), null);
});

test('parseArgs rejects a defer whose --class is outside KNOWN_FAILURE_CLASSES', () => {
  assert.equal(parseArgs(deferArgs({ cls: 'scope' })), null);
});

test('parseArgs rejects a defer missing a required flag', () => {
  assert.equal(parseArgs(['defer', '--ticket', 'BL-477', '--blocked-by', 'BL-469', '--class', 'integration', '--commit', 'abc1234567']), null);
});

test('parseArgs rejects status with no --ticket', () => {
  assert.equal(parseArgs(['status']), null);
});

test('parseArgs rejects an unrecognized flag', () => {
  assert.equal(parseArgs(['status', '--bogus', 'BL-477']), null);
});

// ── status: exit codes ────────────────────────────────────────────────────

test('status on an unknown ticket (no deferral ever recorded) exits 0 VERIFY', async () => {
  const root = mkRepo();
  const result = await runCli(root, ['status', '--ticket', 'BL-999']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.logs[0], 'VERIFY BL-999');
});

test('status on a ticket with an open deferral exits 3 and names the blocker and its check', async () => {
  const root = mkRepo();
  await runCli(root, deferArgs());
  const result = await runCli(root, ['status', '--ticket', 'BL-477']);
  assert.equal(result.exitCode, 3);
  assert.equal(result.logs[0], 'DEFERRED BL-477 BLOCKED_BY BL-469 CHECK npm run compile');
});

test('status lists one line per open blocker when a ticket has several', async () => {
  const root = mkRepo();
  await runCli(root, deferArgs({ blockedBy: 'BL-469' }));
  await runCli(root, deferArgs({ blockedBy: 'BL-480', check: 'npm test' }));
  const result = await runCli(root, ['status', '--ticket', 'BL-477']);
  assert.equal(result.exitCode, 3);
  assert.equal(result.logs.length, 2);
  assert.ok(result.logs.some((l) => l.includes('BLOCKED_BY BL-469')));
  assert.ok(result.logs.some((l) => l.includes('BLOCKED_BY BL-480')));
});

test('clearing the only open blocker returns status to exit 0 VERIFY', async () => {
  const root = mkRepo();
  await runCli(root, deferArgs());
  await runCli(root, clearArgs());
  const result = await runCli(root, ['status', '--ticket', 'BL-477']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.logs[0], 'VERIFY BL-477');
});

test('clearing one of two blockers leaves status naming only the remaining one', async () => {
  const root = mkRepo();
  await runCli(root, deferArgs({ blockedBy: 'BL-469' }));
  await runCli(root, deferArgs({ blockedBy: 'BL-480', check: 'npm test' }));
  await runCli(root, clearArgs({ blockedBy: 'BL-469' }));
  const result = await runCli(root, ['status', '--ticket', 'BL-477']);
  assert.equal(result.exitCode, 3);
  assert.equal(result.logs.length, 1);
  assert.equal(result.logs[0], 'DEFERRED BL-477 BLOCKED_BY BL-480 CHECK npm test');
});

// ── defer / clear: durable record, never touches qa_bounces ──────────────

test('defer records exactly one line and never touches qa_bounces/', async () => {
  const root = mkRepo();
  const result = await runCli(root, deferArgs());
  assert.equal(JSON.parse(result.stdout).recorded, true);
  assert.equal(readSiblingDeferralRecords(root).length, 1);
  assert.equal(fs.existsSync(path.join(root, '.swarmforge', 'qa_bounces')), false);
});

test('recording the same defer twice does not double-count it', async () => {
  const root = mkRepo();
  await runCli(root, deferArgs());
  const second = await runCli(root, deferArgs({ commit: 'deadbeef00' }));
  assert.equal(JSON.parse(second.stdout).recorded, false);
  assert.equal(readSiblingDeferralRecords(root).length, 1);
});

// ── usage errors: exit code 2 ─────────────────────────────────────────────

test('an invalid invocation exits 2 with a usage message, never a raw crash', async () => {
  const root = mkRepo();
  const result = await runCli(root, ['defer', '--ticket', 'BL-477', '--class', 'not-a-real-class']);
  assert.equal(result.exitCode, 2);
});

test('a missing required flag exits 2', async () => {
  const root = mkRepo();
  const result = await runCli(root, ['clear', '--ticket', 'BL-477']);
  assert.equal(result.exitCode, 2);
});

test('an unknown subcommand exits 2', async () => {
  const root = mkRepo();
  const result = await runCli(root, ['bogus']);
  assert.equal(result.exitCode, 2);
});

// ── exit codes are distinct ────────────────────────────────────────────────

test('exit codes: 0 verify, 3 deferred, 2 usage', async () => {
  const root = mkRepo();
  const verify = await runCli(root, ['status', '--ticket', 'BL-999']);
  assert.equal(verify.exitCode, 0);
  await runCli(root, deferArgs());
  const deferred = await runCli(root, ['status', '--ticket', 'BL-477']);
  assert.equal(deferred.exitCode, 3);
  const usage = await runCli(root, ['status']);
  assert.equal(usage.exitCode, 2);
});

// A single subprocess smoke test locks the compiled CLI's own wiring - an
// ADDITION to the in-process tests above, never the only cover for the real
// logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkRepo();
  const out = runCliSubprocess(root, deferArgs());
  assert.equal(JSON.parse(out).recorded, true);
  assert.equal(readSiblingDeferralRecords(root).length, 1);
});

test('the compiled CLI subprocess exits 3 on a deferred status check', () => {
  const root = mkRepo();
  runCliSubprocess(root, deferArgs());
  try {
    runCliSubprocess(root, ['status', '--ticket', 'BL-477']);
    assert.fail('expected the status subprocess to exit non-zero');
  } catch (error) {
    assert.equal(error.status, 3);
    assert.match(error.stdout.toString(), /DEFERRED BL-477 BLOCKED_BY BL-469/);
  }
});
