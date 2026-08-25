const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { parseArgs, USAGE } = require('../out/tools/leanLedgerRecordArgs');
const { main } = require('../out/tools/lean-ledger-record');
const { readLeanLedgerEvents, readLeanLedgerSnapshot } = require('../out/metrics/leanLedgerStore');
const { formatBounceHistoryEntry } = require('../out/quality/bounceHistory');

// BL-819: the thin CLI wrapper - composes every instrument for one ticket
// and appends whatever is new, writing the refreshed snapshot. This is the
// callable unit the "handoff and close points that already exist" (bb
// scripts) invoke.

function mkTmp() {
  return mkTmpDir('sfvc-lean-ledger-cli-');
}

// ── parseArgs (pure) ────────────────────────────────────────────────────

test('parseArgs accepts --ticket and --target', () => {
  assert.deepEqual(parseArgs(['--ticket', 'BL-819', '--target', '/tmp/x']), { ticket: 'BL-819', target: '/tmp/x' });
});

test('parseArgs accepts a GH- ticket', () => {
  assert.deepEqual(parseArgs(['--ticket', 'GH-26', '--target', '/tmp/x']), { ticket: 'GH-26', target: '/tmp/x' });
});

test('parseArgs requires --ticket and rejects a malformed id', () => {
  assert.equal(parseArgs(['--target', '/tmp/x']), null);
  assert.equal(parseArgs(['--ticket', 'nonsense', '--target', '/tmp/x']), null);
});

test('USAGE is a non-empty usage string', () => {
  assert.ok(USAGE.includes('--ticket'));
});

// ── main() (impure, in-process per the CLI thin-wrapper rule) ──────────

function setupProject(target) {
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(target, '.swarmforge', 'roles.tsv'), 'role\tworktreeName\tworktreePath\tdisplayName\tagent\ncoder\tcoder\t' + target + '\tCoder\tclaude\n');
}

function writeBouncedTicket(target) {
  const dir = path.join(target, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  const entry = { at: '2026-08-07', by: 'architect', blamed: 'coder', failureClass: 'behavior', commit: 'abc1234567', evidence: 'backlog/evidence/BL-819-architect-20260807.md' };
  const lines = ['id: BL-819', 'title: "x"', 'bounce_count: 1', 'bounce_history:', formatBounceHistoryEntry(entry)];
  fs.writeFileSync(path.join(dir, 'BL-819-x.yaml'), lines.join('\n') + '\n');
}

test('main() composes and appends events for the given ticket, then writes its snapshot', async () => {
  const target = mkTmp();
  setupProject(target);
  writeBouncedTicket(target);

  const originalArgv = process.argv;
  const originalCwd = process.cwd;
  process.argv = ['node', 'lean-ledger-record.js', '--ticket', 'BL-819', '--target', target];
  process.cwd = () => target;
  try {
    await main();
  } finally {
    process.argv = originalArgv;
    process.cwd = originalCwd;
  }

  const events = readLeanLedgerEvents(target, 'BL-819');
  assert.equal(events.length, 1);
  const snapshot = readLeanLedgerSnapshot(target, 'BL-819');
  assert.equal(snapshot.bounceCount, 1);
});

test('main() run twice on unchanged state appends nothing the second time (invariant 1)', async () => {
  const target = mkTmp();
  setupProject(target);
  writeBouncedTicket(target);

  process.argv = ['node', 'lean-ledger-record.js', '--ticket', 'BL-819', '--target', target];
  process.cwd = () => target;
  await main();
  const firstCount = readLeanLedgerEvents(target, 'BL-819').length;
  await main();
  const secondCount = readLeanLedgerEvents(target, 'BL-819').length;
  assert.equal(firstCount, secondCount);
});

// BL-918 scenario 03: a chaser-telemetry type nobody has classified yet is
// reported on this CLI's own stdout - the seam an operator running it would
// see - rather than silently dropped the way an excluded sample type is.
test('main() reports an unrecognised chaser-telemetry type on stdout instead of silently dropping it', async () => {
  const target = mkTmp();
  setupProject(target);
  writeBouncedTicket(target);
  const telemetryDir = path.join(target, '.swarmforge', 'telemetry');
  fs.mkdirSync(telemetryDir, { recursive: true });
  fs.writeFileSync(
    path.join(telemetryDir, 'chaser-2026-08.jsonl'),
    JSON.stringify({ type: 'never-classified-type', role: 'coder', at: '2026-08-07T08:00:00.000Z' }) + '\n'
  );

  const originalWrite = process.stdout.write.bind(process.stdout);
  const writes = [];
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  process.argv = ['node', 'lean-ledger-record.js', '--ticket', 'BL-819', '--target', target];
  process.cwd = () => target;
  try {
    await main();
  } finally {
    process.stdout.write = originalWrite;
  }

  const printed = JSON.parse(writes.join(''));
  assert.deepEqual(printed.unrecognizedTelemetryTypes, ['never-classified-type']);
});
