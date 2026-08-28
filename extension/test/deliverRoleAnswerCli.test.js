const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { main, parseArgs } = require('../out/tools/deliver-role-answer');
const {
  roleAwaitingAnswerPath,
  enqueueRoleAnswerNote,
} = require('../out/tools/telegram-front-desk-bot');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

// Hardener (BL-1201 architect flag): deliver-role-answer.ts's own
// parseArgs/main CLI wrapper had zero direct test coverage - only the
// underlying deliverRoleAnswer function was tested
// (bl1201DeliverRoleAnswer.test.js). Per the CLI main() thin-wrapper rule
// (engineering.prompt), the wrapper itself - argv parsing, usage-guard
// exit code, and the real resolveCliMainWorktreeContext() -> deliverRoleAnswer
// -> printJsonToStdout wiring - needs its own coverage before this file can
// pass CRAP/coverage.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'deliver-role-answer.js');

function mkRepo() {
  const root = mkTmpDir('sfvc-deliver-role-answer-');
  copySeededRepoInto(root);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`
  );
  return root;
}

function writeAwaiting(root, role, record) {
  const abs = roleAwaitingAnswerPath(root, role);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(record));
}

// Same in-process argv/cwd/stdout stub shape as recordBounceCli.test.js's
// own runCli - drives the REAL main(), never a reimplementation of its
// wiring.
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

// ── parseArgs (pure) ────────────────────────────────────────────────────

test('parseArgs accepts --role with a value', () => {
  assert.deepEqual(parseArgs(['--role', 'specifier']), { role: 'specifier' });
});

test('parseArgs returns null when --role is absent', () => {
  assert.equal(parseArgs([]), null);
});

test('parseArgs returns null when --role is present but given no value', () => {
  assert.equal(parseArgs(['--role']), null);
});

test('parseArgs returns null for an empty --role value (falsy, same as absent)', () => {
  assert.deepEqual(parseArgs(['--role', '']), null);
});

// ── main() wiring: real resolveCliMainWorktreeContext -> deliverRoleAnswer ──

test('main() with no --role prints usage to stderr and sets a non-zero exit code, without touching stdout', async () => {
  const root = mkRepo();
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const stderrChunks = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    stderrChunks.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', CLI];
    process.exitCode = undefined;
    await main();
    assert.notEqual(process.exitCode, 0);
    assert.match(stderrChunks.join(''), /Usage: node deliver-role-answer\.js/);
  } finally {
    process.stderr.write = originalStderrWrite;
    process.cwd = originalCwd;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
});

test('main() with a matching pending question delivers the real answer via the real production wiring', async () => {
  const root = mkRepo();
  // asked_at_ms (snake_case) is the Babashka role_ask.bb writer's own field
  // name for this file - writeRoleAnswerFile reads it via
  // readRoleAwaitingAskedAtMs at capture time and stamps it onto the
  // answer's own (camelCase) askedAtMs field. The two files deliberately
  // use different casings; only the VALUE correlates them.
  writeAwaiting(root, 'specifier', { asked_at_ms: 1000 });
  await enqueueRoleAnswerNote(root, 'specifier', 'use staging', 1000);
  const result = await runCli(root, ['--role', 'specifier']);
  assert.equal(result.kind, 'delivered');
  assert.equal(result.text, 'use staging');
});

test('main() reports a mismatch without throwing when the recorded answer names a different question', async () => {
  const root = mkRepo();
  writeAwaiting(root, 'specifier', { asked_at_ms: 1000 });
  await enqueueRoleAnswerNote(root, 'specifier', 'stale answer', 1000);
  // Pending question changes AFTER the answer was captured - the stamped
  // askedAtMs (1000) no longer matches the now-pending one (2000).
  writeAwaiting(root, 'specifier', { asked_at_ms: 2000 });
  const result = await runCli(root, ['--role', 'specifier']);
  assert.equal(result.kind, 'mismatch');
});

test('main() reports no-answer for a role with no recorded answer at all', async () => {
  const root = mkRepo();
  const result = await runCli(root, ['--role', 'specifier']);
  assert.equal(result.kind, 'no-answer');
});
