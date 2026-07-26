const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatBounceLine, main } = require('../out/tools/qa-bounce-line');
const { appendQaBounceRecordIfNew, qaBouncesDir } = require('../out/metrics/qaBounceStore');
const { appendBounceRecordIfNew } = require('../out/metrics/bounceStore');

// BL-454/BL-635: the daily-briefing bounce line CLI briefing_email_lib.bb
// shells out to. Generalised (BL-635) from a QA-only tally to report who
// bounced as well as whose work bounced, reading the merged bounce log
// (legacy qa_bounces/ + the new bounces/ path).

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

// ── formatBounceLine (pure) ────────────────────────────────────────────────

test('formats totals, by-bouncing-role, whose-work, and per-ticket-type breakdowns', () => {
  const byBouncingRole = [
    { role: 'architect', count: 2 },
    { role: 'QA', count: 1 },
  ];
  const tally = {
    total: 3,
    byRole: [
      { role: 'coder', count: 2 },
      { role: 'architect', count: 1 },
    ],
    byTicketType: { feature: 2, defect: 1 },
  };
  assert.equal(
    formatBounceLine(byBouncingRole, tally),
    'Bounces: 3 total - by bouncing role: architect x2, QA x1 - whose work: coder x2, architect x1 - by ticket type: feature x2, defect x1'
  );
});

// BL-635 (record-bounce-by-role-14): the line no longer frames every
// bounce as a QA bounce, and a legacy by-less record is shown unattributed.

test('does not frame every bounce as a QA bounce', () => {
  const line = formatBounceLine([{ role: 'architect', count: 1 }], { total: 1, byRole: [{ role: 'coder', count: 1 }], byTicketType: { defect: 1 } });
  assert.doesNotMatch(line, /^QA bounces/);
});

test('a legacy by-less record is shown as unattributed, not silently attributed to QA', () => {
  const line = formatBounceLine([{ role: 'unattributed', count: 1 }], { total: 1, byRole: [{ role: 'coder', count: 1 }], byTicketType: { defect: 1 } });
  assert.match(line, /unattributed x1/);
  assert.doesNotMatch(line, /QA x1/);
});

test('breaks a tied by-ticket-type count alphabetically', () => {
  const line = formatBounceLine([], { total: 2, byRole: [], byTicketType: { feature: 1, defect: 1 } });
  assert.match(line, /by ticket type: defect x1, feature x1/);
});

// ── end-to-end: process.cwd stubbed, console.log mocked ───────────────────

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

test('prints nothing when there are no recorded bounces yet', async () => {
  const root = mkRepo();
  const output = await runCli(root);
  assert.equal(output, '');
});

test('prints the tally line once a generalised bounce is recorded', async () => {
  const root = mkRepo();
  appendBounceRecordIfNew(root, {
    ticket: 'BL-590',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-26T10:00:00.000Z',
    by: 'architect',
  });
  const output = await runCli(root);
  assert.match(output, /^Bounces: 1 total/);
  assert.match(output, /architect x1/);
  assert.match(output, /defect x1/);
});

// BL-635 (record-bounce-by-role-06/14): a legacy QA-only record (no `by` on
// the JSONL line) still counts, attributed as unattributed rather than QA.

test('a legacy qa_bounces record with no `by` field is counted as unattributed', async () => {
  const root = mkRepo();
  appendQaBounceRecordIfNew(root, {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'legacyaa11',
    at: '2026-07-14T10:00:00.000Z',
  });
  const output = await runCli(root);
  assert.match(output, /^Bounces: 1 total/);
  assert.match(output, /by bouncing role: unattributed x1/);
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
  assert.match(output.trim(), /^Bounces: 1 total/);
});
