const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, bridgeCostLogPath, readBridgeCostRecords } = require('../out/tools/telegram-bridge-cost-line');

// BL-511: the daily-briefing line CLI briefing_email_lib.bb shells out to.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'telegram-bridge-cost-line.js');
const DAY = '2026-07-18';

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
  const root = mkTmp('sfvc-bridge-cost-line-repo-');
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'seed roles.tsv');
  return root;
}

function writeLog(root, lines) {
  const logPath = bridgeCostLogPath(root);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

// ── readBridgeCostRecords (impure reader) ─────────────────────────────────

test('readBridgeCostRecords: a missing log file degrades to an empty list, never an error', () => {
  const root = mkRepo();
  assert.deepEqual(readBridgeCostRecords(bridgeCostLogPath(root)), []);
});

test('readBridgeCostRecords: an unreadable (garbage) log file degrades to an empty list', () => {
  const root = mkRepo();
  const logPath = bridgeCostLogPath(root);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, 'not valid jsonl at all {{{\n\x00\x01garbage');
  assert.deepEqual(readBridgeCostRecords(logPath), []);
});

test('readBridgeCostRecords: a malformed line is skipped, valid lines around it still parse', () => {
  const root = mkRepo();
  const logPath = bridgeCostLogPath(root);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(
    logPath,
    [
      JSON.stringify({ ts: `${DAY}T09:00:00Z`, kind: 'front-desk', total_cost_usd: 0.04 }),
      'not json',
      JSON.stringify({ ts: `${DAY}T10:00:00Z`, kind: 'front-desk', total_cost_usd: 0.02 }),
    ].join('\n')
  );
  assert.equal(readBridgeCostRecords(logPath).length, 2);
});

test('readBridgeCostRecords: a line that parses to valid JSON but not an object is skipped', () => {
  const root = mkRepo();
  const logPath = bridgeCostLogPath(root);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, ['42', JSON.stringify({ ts: `${DAY}T09:00:00Z`, kind: 'front-desk', total_cost_usd: 0.04 })].join('\n'));
  assert.equal(readBridgeCostRecords(logPath).length, 1);
});

test('readBridgeCostRecords: a record with an unrecognized kind is skipped', () => {
  const root = mkRepo();
  const logPath = bridgeCostLogPath(root);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify({ ts: `${DAY}T09:00:00Z`, kind: 'bogus', total_cost_usd: 0.04 }));
  assert.equal(readBridgeCostRecords(logPath).length, 0);
});

test('readBridgeCostRecords: a record with a non-numeric, non-null total_cost_usd is skipped', () => {
  const root = mkRepo();
  const logPath = bridgeCostLogPath(root);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify({ ts: `${DAY}T09:00:00Z`, kind: 'front-desk', total_cost_usd: 'a lot' }));
  assert.equal(readBridgeCostRecords(logPath).length, 0);
});

// ── end-to-end: process.cwd/argv stubbed, console.log mocked ─────────────

async function runCli(root, dayKey) {
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
  const writes = [];
  const originalLog = console.log;
  console.log = (...args) => {
    writes.push(args.join(' '));
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', 'telegram-bridge-cost-line.js', dayKey];
    await main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
    process.argv = originalArgv;
  }
  return writes.join('\n');
}

function runCliSubprocess(root, dayKey) {
  return execFileSync('node', [CLI, dayKey], { cwd: root, encoding: 'utf8' });
}

test('BL-511: prints nothing when the bridge-cost log has no records for the day (absent)', async () => {
  const root = mkRepo();
  const output = await runCli(root, DAY);
  assert.equal(output, '');
});

test('BL-511: prints nothing when the bridge-cost log has records, but none for the requested day', async () => {
  const root = mkRepo();
  writeLog(root, [{ ts: '2026-07-01T09:00:00Z', kind: 'front-desk', total_cost_usd: 0.04 }]);
  const output = await runCli(root, DAY);
  assert.equal(output, '');
});

test('BL-511: prints nothing when the log file is unreadable garbage (never crashes)', async () => {
  const root = mkRepo();
  const logPath = bridgeCostLogPath(root);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '{{{ not json');
  const output = await runCli(root, DAY);
  assert.equal(output, '');
});

test('BL-511: prints the cost line once records exist for the day', async () => {
  const root = mkRepo();
  writeLog(root, [{ ts: `${DAY}T09:00:00Z`, kind: 'front-desk', model: 'claude-opus-4-8', total_cost_usd: 0.04 }]);
  const output = await runCli(root, DAY);
  assert.match(output, /^Telegram bridge cost: \$0\.04 today/);
});

// BL-511 amended to front-desk-only: an 'operator'-kind line (a stray
// leftover from before the amendment, or a hand-edited log) is unrecognized
// and skipped, never counted toward the total or rendered as an "Operator
// ... attributed" term.
test("BL-511: an 'operator'-kind log line is unrecognized and skipped, never counted", async () => {
  const root = mkRepo();
  writeLog(root, [
    { ts: `${DAY}T09:00:00Z`, kind: 'front-desk', model: 'claude-opus-4-8', total_cost_usd: 0.04 },
    { ts: `${DAY}T09:05:00Z`, kind: 'operator', model: 'claude-opus-4-8', total_cost_usd: 0.08, telegram_events: 1, total_events: 4 },
  ]);
  const output = await runCli(root, DAY);
  assert.match(output, /^Telegram bridge cost: \$0\.04 today \(1 front-desk call\)$/);
});

test('the compiled CLI runs standalone as a subprocess and produces the same empty-state result', () => {
  const root = mkRepo();
  const output = runCliSubprocess(root, DAY);
  assert.equal(output.trim(), '');
});

test('the compiled CLI runs standalone as a subprocess and reports recorded cost', () => {
  const root = mkRepo();
  writeLog(root, [{ ts: `${DAY}T09:00:00Z`, kind: 'front-desk', total_cost_usd: 0.05 }]);
  const output = runCliSubprocess(root, DAY);
  assert.match(output.trim(), /^Telegram bridge cost: \$0\.05 today/);
});
