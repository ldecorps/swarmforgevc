const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatQaBounceLine, main } = require('../out/tools/qa-bounce-line');
const { appendQaBounceRecordIfNew, qaBouncesDir } = require('../out/metrics/qaBounceStore');

// BL-454: the daily-briefing line CLI briefing_email_lib.bb shells out to.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'qa-bounce-line.js');

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
  const root = mkTmp('sfvc-qa-bounce-line-repo-');
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'seed roles.tsv');
  return root;
}

// ── formatQaBounceLine (pure) ─────────────────────────────────────────────

test('formats a tally into one line naming totals, per-role, and per-ticket-type breakdowns', () => {
  const tally = {
    total: 3,
    byRole: [
      { role: 'coder', count: 2 },
      { role: 'architect', count: 1 },
    ],
    byTicketType: { feature: 2, bug: 1 },
  };
  assert.equal(
    formatQaBounceLine(tally),
    'QA bounces: 3 total - by role: coder x2, architect x1 - by ticket type: feature x2, bug x1'
  );
});

// ── end-to-end: process.cwd stubbed, console.log mocked (qa-bounce-line.ts
//    prints via console.log, matching not-done-count-line.ts's own
//    convention - Vitest intercepts console.* separately from
//    process.stdout.write) ──────────────────────────────────────────────

async function runCli(root) {
  const originalCwd = process.cwd;
  const writes = [];
  const originalLog = console.log;
  console.log = (...args) => {
    writes.push(args.join(' '));
  };
  try {
    process.cwd = () => root;
    await main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
  }
  return writes.join('\n');
}

function runCliSubprocess(root) {
  return execFileSync('node', [CLI], { cwd: root, encoding: 'utf8' });
}

test('BL-454: prints nothing when there are no recorded bounces yet', async () => {
  const root = mkRepo();
  const output = await runCli(root);
  assert.equal(output, '');
});

test('BL-454: prints the tally line once bounces are recorded', async () => {
  const root = mkRepo();
  appendQaBounceRecordIfNew(root, {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-14T10:00:00.000Z',
  });
  const output = await runCli(root);
  assert.match(output, /^QA bounces: 1 total/);
  assert.match(output, /coder x1/);
  assert.match(output, /feature x1/);
});

test('the compiled CLI runs standalone as a subprocess and produces the same empty-state result', () => {
  const root = mkRepo();
  const output = runCliSubprocess(root);
  assert.equal(output.trim(), '');
});

test('the compiled CLI runs standalone as a subprocess and reports recorded bounces', () => {
  const root = mkRepo();
  fs.mkdirSync(qaBouncesDir(root), { recursive: true });
  appendQaBounceRecordIfNew(root, {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-14T10:00:00.000Z',
  });
  const output = runCliSubprocess(root);
  assert.match(output.trim(), /^QA bounces: 1 total/);
});
