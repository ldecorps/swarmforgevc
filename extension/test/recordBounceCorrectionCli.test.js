const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/record-bounce-correction');
const { readBounceRecords, readRawBounceRecords, bouncesDir } = require('../out/metrics/bounceStore');
const { USAGE } = require('../out/tools/recordBounceCorrectionArgs');

// BL-990: main() itself (the makeArgsGuardedMain wiring: stamp `at`, build
// the BounceCorrection, call appendBounceCorrectionIfNew, print JSON) was
// exercised by no test at all - the unit/property/acceptance suites all go
// through appendBounceCorrectionIfNew directly, never through this CLI's own
// entrypoint. Mirrors recordBounceCli.test.js's shape for the sibling
// record-bounce.js CLI (same resolveCliMainWorktreeContext wiring).

const CLI = path.join(__dirname, '..', 'out', 'tools', 'record-bounce-correction.js');

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
  const root = mkTmpDir('sfvc-record-bounce-correction-repo-');
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'seed roles.tsv');
  return root;
}

function flagArgs({ ticket = 'BL-971', commit = '8956d30eee', reason = 'misattributed - amendment landed after the fix, not before', by = 'QA', evidence = undefined } = {}) {
  const args = ['--ticket', ticket, '--commit', commit, '--reason', reason, '--by', by];
  if (evidence !== undefined) {
    args.push('--evidence', evidence);
  }
  return args;
}

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

test('recording a correction writes a superseding record and prints recorded:true', async () => {
  const root = mkRepo();
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);
  assert.equal(result.ticket, 'BL-971');
  assert.equal(result.commit, '8956d30eee');

  const raw = readRawBounceRecords(root);
  assert.equal(raw.length, 0, 'a correction is not itself a bounce record');
  assert.equal(fs.existsSync(bouncesDir(root)), true, 'the correction still lands in the generalised store');
});

test('the correction stamps `at` from the real wall clock as a full ISO timestamp', async () => {
  const root = mkRepo();
  await runCli(root, flagArgs());
  const file = fs.readdirSync(bouncesDir(root)).find((f) => f.endsWith('.jsonl'));
  const line = fs.readFileSync(path.join(bouncesDir(root), file), 'utf8').trim();
  const record = JSON.parse(line);
  assert.equal(record.kind, 'bounce-correction');
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('recording the identical correction twice is a no-op the second time', async () => {
  const root = mkRepo();
  const first = await runCli(root, flagArgs());
  const second = await runCli(root, flagArgs());
  assert.equal(first.recorded, true);
  assert.equal(second.recorded, false);
});

test('an --evidence pointer is carried into the written record', async () => {
  const root = mkRepo();
  await runCli(root, flagArgs({ evidence: 'backlog/evidence/BL-971-amendment-supersession-20260820.md' }));
  const file = fs.readdirSync(bouncesDir(root)).find((f) => f.endsWith('.jsonl'));
  const line = fs.readFileSync(path.join(bouncesDir(root), file), 'utf8').trim();
  const record = JSON.parse(line);
  assert.equal(record.evidence, 'backlog/evidence/BL-971-amendment-supersession-20260820.md');
});

test('a correction actually withdraws a real bounce end to end, through the CLI entrypoint', async () => {
  const root = mkRepo();
  const { appendBounceRecordIfNew } = require('../out/metrics/bounceStore');
  const bounce = {
    ticket: 'BL-971',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'acceptance',
    commit: '8956d30eee',
    by: 'QA',
    at: '2026-08-20T13:45:00.000Z',
  };
  appendBounceRecordIfNew(root, bounce);
  assert.equal(readBounceRecords(root).length, 1);

  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);
  assert.equal(readBounceRecords(root).length, 0, 'the attributed view no longer reports the corrected bounce');
  assert.equal(readRawBounceRecords(root).length, 1, 'the original bounce line is still there, untouched');
});

test('the CLI prints usage and exits non-zero when invoked as a real subprocess with no --reason', () => {
  const root = mkRepo();
  assert.throws(() => {
    execFileSync('node', [CLI, '--ticket', 'BL-971', '--commit', '8956d30eee', '--by', 'QA'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }, /Command failed/);
  assert.equal(fs.existsSync(bouncesDir(root)), false, 'a usage error writes nothing');
});

test('the CLI subprocess writes a correction and exits zero for a valid invocation', () => {
  const root = mkRepo();
  const out = execFileSync('node', [CLI, ...flagArgs({ commit: 'subprocess01' })], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(out);
  assert.equal(parsed.recorded, true);
  assert.equal(parsed.commit, 'subprocess01');
});

// ── parseArgs / USAGE (already covered by bl990BounceCorrection.test.js's
// pure-core tests; these two confirm the CLI's own re-export is wired) ────

test('the re-exported parseArgs is the same function the CLI wiring uses', () => {
  assert.deepEqual(parseArgs(flagArgs()), {
    ticket: 'BL-971',
    commit: '8956d30eee',
    reason: 'misattributed - amendment landed after the fix, not before',
    by: 'QA',
  });
});

test('USAGE names the CLI and its required flags', () => {
  assert.match(USAGE, /^Usage: record-bounce-correction\.js --ticket <id> --commit <hex> --reason <text>/);
  assert.match(USAGE, /--by \(required\)/);
  assert.match(USAGE, /--reason \(required, non-blank\)/);
});
