const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/record-bounce');
const { readBounceRecords, qaBouncesDir, bouncesDir } = require('../out/metrics/qaBounceStore');
const { USAGE } = require('../out/tools/recordBounceArgs');

// BL-635: the generalised go-forward writer CLI - every reviewing role runs
// this at bounce time (not just QA). `--by` is REQUIRED, unlike the legacy
// record-qa-bounce.js CLI it generalises (recordQaBounceCli.test.js), which
// stays untouched and keeps its own optional-by contract.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'record-bounce.js');

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
  const root = mkTmp('sfvc-record-bounce-repo-');
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'seed roles.tsv');
  return root;
}

function writeTicketYaml(root, ticket, extra = '') {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ticket}-fixture.yaml`);
  fs.writeFileSync(file, `id: ${ticket}\ntitle: "fixture"\nstatus: active\n${extra}`);
  return file;
}

function flagArgs({
  ticket = 'BL-590',
  role = 'coder',
  type = 'defect',
  cls = 'behavior',
  commit = 'abc1234567',
  by = 'architect',
  evidence = 'backlog/evidence/BL-590-bounce-20260726.md',
} = {}) {
  const args = ['--ticket', ticket, '--role', role, '--type', type, '--class', cls, '--commit', commit];
  if (by !== undefined) {
    args.push('--by', by);
  }
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

// ── parseArgs ──────────────────────────────────────────────────────────────

test('parseArgs accepts a fully valid invocation with the full role set', () => {
  assert.deepEqual(parseArgs(flagArgs()), {
    ticket: 'BL-590',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: 'abc1234567',
    by: 'architect',
    evidence: 'backlog/evidence/BL-590-bounce-20260726.md',
  });
});

for (const by of ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
  test(`parseArgs accepts every known bouncing role, including ${by}`, () => {
    assert.equal(parseArgs(flagArgs({ by })).by, by);
  });
}

// record-bounce-by-role-02: no --by at all fails loudly, writes nothing.

test('parseArgs rejects an invocation with no --by flag at all', () => {
  const args = ['--ticket', 'BL-590', '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567'];
  assert.equal(parseArgs(args), null);
});

test('USAGE names the required --by flag', () => {
  assert.match(USAGE, /--by <bouncingRole>/);
  assert.match(USAGE, /required/);
});

// record-bounce-by-role-03: an unknown/misspelt bouncing role is rejected,
// naming the valid set (canonical spelling is "hardender", not "hardener").

test('parseArgs rejects the misspelt bouncing role "hardener"', () => {
  assert.equal(parseArgs(flagArgs({ by: 'hardener' })), null);
});

test('USAGE names the valid bouncing role set', () => {
  assert.match(USAGE, /specifier\|coder\|cleaner\|architect\|hardender\|documenter\|QA/);
});

test('parseArgs rejects a dangling --by flag with no following value', () => {
  const args = ['--ticket', 'BL-590', '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567', '--by'];
  assert.equal(parseArgs(args), null);
});

test('parseArgs rejects an evidence path outside backlog/evidence/*.md', () => {
  assert.equal(parseArgs(flagArgs({ evidence: 'backlog/evidence/BL-590-bounce.txt' })), null);
});

test('parseArgs accepts --by with no --evidence - evidence alone stays optional', () => {
  const args = ['--ticket', 'BL-590', '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567', '--by', 'architect'];
  assert.equal(parseArgs(args).by, 'architect');
  assert.equal(parseArgs(args).evidence, undefined);
});

// ── record-bounce-by-role-01: writes `by` to BOTH durable stores ──────────

test('recording a bounce writes `by` to the durable log AND the ticket record', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-590');
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);

  const records = readBounceRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].by, 'architect');
  assert.equal(records[0].producingRole, 'coder');

  assert.equal(result.ticketRecordUpdated, true);
  const yamlText = fs.readFileSync(ticketPath, 'utf8');
  assert.match(yamlText, /bounce_count: 1/);
  assert.match(yamlText, /by: architect, blamed: coder/);
});

// ── record-bounce-by-role-07: new path only, legacy dir never written ─────

test('the record lands in the generalised bounces log; the legacy qa_bounces dir is never created', async () => {
  const root = mkRepo();
  const result = await runCli(root, flagArgs({ by: 'QA' }));
  assert.equal(result.recorded, true);
  assert.equal(fs.existsSync(path.join(bouncesDir(root), '2026-07.jsonl')) || fs.existsSync(bouncesDir(root)), true);
  assert.equal(fs.existsSync(qaBouncesDir(root)), false);
});

// ── record-bounce-by-role-04: four same-day bounces by architect on one
//    ticket, each a distinct commit, all land (bounce_count 4) ────────────

test('four architect bounces on one ticket, each a distinct commit, end with bounce_count 4', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-590');
  // The CLI stamps `at` from the real wall clock, so all four calls in this
  // test share the same calendar day - the ticket-YAML merge's own
  // idempotency key is date+failureClass (bounceHistory.ts, a locked BL-608
  // contract this ticket does not touch), so each bounce here also varies
  // failureClass to land as a genuinely distinct entry, same convention
  // recordQaBounceCli.test.js's bounce-history-on-ticket-03 already uses.
  const classes = ['behavior', 'compile', 'unit', 'integration'];
  for (let i = 0; i < classes.length; i++) {
    const commit = `commit000${i + 1}`;
    const result = await runCli(root, flagArgs({ commit, cls: classes[i], evidence: `backlog/evidence/BL-590-bounce-${commit}.md` }));
    assert.equal(result.recorded, true);
  }
  const records = readBounceRecords(root).filter((r) => r.ticket === 'BL-590');
  assert.equal(records.length, 4);
  assert.ok(records.every((r) => r.by === 'architect'));

  const yamlText = fs.readFileSync(ticketPath, 'utf8');
  assert.match(yamlText, /bounce_count: 4/);
  assert.equal((yamlText.match(/^ {2}- \{/gm) || []).length, 4);
});

test('recording the identical bounce twice does not double-count it', async () => {
  const root = mkRepo();
  await runCli(root, flagArgs());
  const second = await runCli(root, flagArgs());
  assert.equal(second.recorded, false);
  assert.equal(readBounceRecords(root).length, 1);
});

test('an unwritable ticket record does not block the bounce from being recorded', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-590');
  fs.rmSync(ticketPath, { force: true });
  fs.mkdirSync(ticketPath);
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);
  assert.equal(readBounceRecords(root).length, 1);
  assert.equal(result.ticketRecordUpdated, false);
});

test('a missing ticket record is best-effort - the bounce is still recorded', async () => {
  const root = mkRepo();
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);
  assert.equal(result.ticketRecordUpdated, false);
  assert.equal(result.ticketRecordReason, 'not-found');
});

test('the CLI prints usage and exits non-zero when invoked as a real subprocess with no --by', () => {
  const root = mkRepo();
  assert.throws(() => {
    execFileSync('node', [CLI, '--ticket', 'BL-590', '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }, /Command failed/);
});
