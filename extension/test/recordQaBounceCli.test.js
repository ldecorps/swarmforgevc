const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/record-qa-bounce');
const { readQaBounceRecords } = require('../out/metrics/qaBounceStore');

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

// BL-608: a minimal backlog/active/<ticket>-*.yaml fixture - the ticket's
// own record the CLI merges a bounce_history entry onto.
function writeTicketYaml(root, ticket, extra = '') {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ticket}-fixture.yaml`);
  fs.writeFileSync(file, `id: ${ticket}\ntitle: "fixture"\nstatus: active\n${extra}`);
  return file;
}

function flagArgs({
  ticket = 'BL-340',
  role = 'coder',
  type = 'feature',
  cls = 'behavior',
  commit = 'abc1234567',
  by = 'QA',
  evidence = 'backlog/evidence/BL-340-qa-bounce-20260723.md',
} = {}) {
  return ['--ticket', ticket, '--role', role, '--type', type, '--class', cls, '--commit', commit, '--by', by, '--evidence', evidence];
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
    by: 'QA',
    evidence: 'backlog/evidence/BL-340-qa-bounce-20260723.md',
  });
});

test('parseArgs accepts flags in any order', () => {
  assert.deepEqual(
    parseArgs([
      '--commit',
      'abc1234567',
      '--class',
      'behavior',
      '--ticket',
      'BL-340',
      '--type',
      'feature',
      '--role',
      'coder',
      '--evidence',
      'backlog/evidence/BL-340-qa-bounce-20260723.md',
      '--by',
      'QA',
    ]),
    {
      ticket: 'BL-340',
      producingRole: 'coder',
      ticketType: 'feature',
      failureClass: 'behavior',
      commit: 'abc1234567',
      by: 'QA',
      evidence: 'backlog/evidence/BL-340-qa-bounce-20260723.md',
    }
  );
});

test('parseArgs rejects a bouncing role outside the closed set', () => {
  assert.equal(parseArgs(flagArgs({ by: 'coder' })), null);
});

test('parseArgs rejects an evidence path outside backlog/evidence/*.md', () => {
  assert.equal(parseArgs(flagArgs({ evidence: 'backlog/evidence/BL-340-qa-bounce.txt' })), null);
  assert.equal(parseArgs(flagArgs({ evidence: 'somewhere/else.md' })), null);
});

// BL-608: --by/--evidence are OPTIONAL - the live QA.prompt invocation still
// calls with only the original five flags until the documenter lands the
// two-flag addition there, and that must keep working exactly as before.
test('parseArgs accepts the original five-flag invocation with no --by/--evidence', () => {
  const args = ['--ticket', 'BL-340', '--role', 'coder', '--type', 'feature', '--class', 'behavior', '--commit', 'abc1234567'];
  assert.deepEqual(parseArgs(args), {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'abc1234567',
    by: undefined,
    evidence: undefined,
  });
});

test('parseArgs accepts --by with no --evidence (and vice versa) - each is independently optional', () => {
  const byOnly = ['--ticket', 'BL-340', '--role', 'coder', '--type', 'feature', '--class', 'behavior', '--commit', 'abc1234567', '--by', 'QA'];
  assert.equal(parseArgs(byOnly).by, 'QA');
  assert.equal(parseArgs(byOnly).evidence, undefined);

  const evidenceOnly = [
    '--ticket',
    'BL-340',
    '--role',
    'coder',
    '--type',
    'feature',
    '--class',
    'behavior',
    '--commit',
    'abc1234567',
    '--evidence',
    'backlog/evidence/BL-340-qa-bounce-20260723.md',
  ];
  assert.equal(parseArgs(evidenceOnly).evidence, 'backlog/evidence/BL-340-qa-bounce-20260723.md');
  assert.equal(parseArgs(evidenceOnly).by, undefined);
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
  // no backlog/active/ fixture exists in this repo - best-effort, reported not-found
  assert.equal(result.ticketRecordUpdated, false);
  assert.equal(result.ticketRecordReason, 'not-found');
});

// ── qa-bounce-02: idempotency ─────────────────────────────────────────────

test('BL-454: recording the same bounce twice does not double-count it', async () => {
  const root = mkRepo();
  await runCli(root, flagArgs());
  const second = await runCli(root, flagArgs({ commit: 'deadbeef00' }));
  assert.equal(second.recorded, false);
  assert.equal(readQaBounceRecords(root).length, 1);
});

// BL-608: the live QA.prompt caller still passes only the original five
// flags until the documenter lands the --by/--evidence addition there -
// that invocation must keep recording the JSONL entry exactly as before,
// with no usage-error regression, even against a ticket that HAS a
// backlog/active/ fixture (the ticket record is simply left untouched).
test('BL-608: the original five-flag invocation (no --by/--evidence) still records the bounce and leaves the ticket record untouched', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-340');
  const before = fs.readFileSync(ticketPath, 'utf8');
  const result = await runCli(root, ['--ticket', 'BL-340', '--role', 'coder', '--type', 'feature', '--class', 'behavior', '--commit', 'abc1234567']);
  assert.equal(result.recorded, true);
  assert.equal(readQaBounceRecords(root).length, 1);
  assert.equal(result.ticketRecordUpdated, false);
  assert.equal(result.ticketRecordReason, 'not-attempted');
  assert.equal(fs.readFileSync(ticketPath, 'utf8'), before);
});

// ── BL-608: bounce-history-on-ticket-01 ──────────────────────────────────

test('BL-608: recording a bounce writes a structured entry + count onto the ticket record', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-340');
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);
  assert.equal(result.ticketRecordUpdated, true);

  const yamlText = fs.readFileSync(ticketPath, 'utf8');
  assert.match(yamlText, /bounce_count: 1/);
  assert.match(
    yamlText,
    /bounce_history:\n {2}- \{ at: \d{4}-\d{2}-\d{2}, by: QA, blamed: coder, class: behavior, commit: abc1234567, evidence: backlog\/evidence\/BL-340-qa-bounce-20260723\.md \}/
  );
});

// ── BL-608: bounce-history-on-ticket-02 ──────────────────────────────────

test('BL-608: recording the identical bounce twice leaves one entry on the ticket record', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-340');
  await runCli(root, flagArgs());
  const second = await runCli(root, flagArgs({ commit: 'deadbeef00' }));
  assert.equal(second.ticketRecordUpdated, false);
  assert.equal(second.ticketRecordReason, 'duplicate');
  const yamlText = fs.readFileSync(ticketPath, 'utf8');
  assert.match(yamlText, /bounce_count: 1/);
  assert.equal((yamlText.match(/^ {2}- \{/gm) || []).length, 1);
});

// ── BL-608: bounce-history-on-ticket-03 ──────────────────────────────────

test('BL-608: a later distinct bounce appends in order and raises the count', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-340');
  const first = await runCli(root, flagArgs());
  assert.equal(first.ticketRecordUpdated, true);

  // Distinct failure class -> distinct natural key (date + class), even
  // recorded the same day - the same "distinct bounce" shape the ticket's
  // own natural key (date + failure class) is built to distinguish.
  const second = await runCli(root, flagArgs({ commit: 'deadbeef00', cls: 'compile' }));
  assert.equal(second.ticketRecordUpdated, true);

  const yamlText = fs.readFileSync(ticketPath, 'utf8');
  assert.match(yamlText, /bounce_count: 2/);
  const entryLines = yamlText.match(/^ {2}- \{.*\}$/gm) || [];
  assert.equal(entryLines.length, 2);
  assert.match(entryLines[0], /class: behavior/);
  assert.match(entryLines[1], /class: compile/);
});

// ── BL-608: bounce-history-on-ticket-04 ──────────────────────────────────

test('BL-608: the durable aggregate log is still written alongside the ticket record', async () => {
  const root = mkRepo();
  writeTicketYaml(root, 'BL-340');
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);
  assert.equal(result.ticketRecordUpdated, true);
  assert.equal(readQaBounceRecords(root).length, 1);
});

// ── BL-608: bounce-history-on-ticket-05 ──────────────────────────────────

test('BL-608: an unwritable ticket record does not block the bounce from being recorded', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-340');
  fs.chmodSync(ticketPath, 0o444);
  fs.chmodSync(path.dirname(ticketPath), 0o555);
  try {
    const result = await runCli(root, flagArgs());
    assert.equal(result.recorded, true);
    assert.equal(readQaBounceRecords(root).length, 1);
    assert.equal(result.ticketRecordUpdated, false);
  } finally {
    fs.chmodSync(path.dirname(ticketPath), 0o755);
    fs.chmodSync(ticketPath, 0o644);
  }
});

// ── BL-608: bounce-history-on-ticket-06 ──────────────────────────────────

test('BL-608: bounce count and reasons are answerable from the ticket record alone', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-340');
  await runCli(root, flagArgs());
  await runCli(root, flagArgs({ commit: 'deadbeef00', cls: 'compile', evidence: 'backlog/evidence/BL-340-qa-bounce-20260724.md' }));

  const yamlText = fs.readFileSync(ticketPath, 'utf8');
  const countMatch = yamlText.match(/bounce_count: (\d+)/);
  assert.equal(countMatch[1], '2');
  const entryLines = yamlText.match(/^ {2}- \{.*\}$/gm) || [];
  assert.equal(entryLines.length, 2);
  for (const line of entryLines) {
    assert.match(line, /class: (behavior|compile)/);
    assert.match(line, /blamed: coder/);
    assert.match(line, /evidence: backlog\/evidence\//);
  }
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
