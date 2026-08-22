const assert = require('node:assert/strict');
const { mkTmpDir } = require('./helpers/tmpDir');
const { parseArgs, USAGE } = require('../out/tools/closingCeremonyOutcomeArgs');
const { main } = require('../out/tools/closing-ceremony-outcome');
const { writeCeremonyRun, readCeremonyRun } = require('../out/metrics/closingCeremonyStore');
const { buildClosingCeremonyPacket } = require('../out/quality/closingCeremony');

// BL-820: the specifier's own CLI for ending a ceremony run in a recorded
// outcome. main() is a thin wrapper - tested in-process per the CLI
// thin-wrapper rule (mirrors leanLedgerRecordCli.test.js).

function mkTmp() {
  return mkTmpDir('sfvc-closing-ceremony-outcome-cli-');
}

function seedPendingRun(target, shiftKey) {
  writeCeremonyRun(target, {
    shiftKey,
    packet: buildClosingCeremonyPacket(shiftKey, [
      { ticket: 'BL-900', type: 'stage_transition', source: 'stage-dwell', at: `${shiftKey}T09:00:00.000Z`, role: 'coder', data: { processingMs: 1000 } },
    ]),
    deliveredAt: `${shiftKey}T20:00:00.000Z`,
    outcome: null,
    adjustments: [],
    failedAt: null,
  });
}

// ── parseArgs (pure) ────────────────────────────────────────────────────

test('parseArgs accepts a process_ticket outcome with a ref', () => {
  assert.deepEqual(parseArgs(['--shift', '2026-08-08', '--outcome', 'process_ticket', '--ref', 'BL-901', '--target', '/tmp/x']), {
    shift: '2026-08-08',
    outcomeType: 'process_ticket',
    ref: 'BL-901',
    target: '/tmp/x',
  });
});

test('parseArgs accepts a no_change outcome with no ref', () => {
  assert.deepEqual(parseArgs(['--shift', '2026-08-08', '--outcome', 'no_change']), { shift: '2026-08-08', outcomeType: 'no_change' });
});

test('parseArgs rejects a process_ticket outcome with no ref', () => {
  assert.equal(parseArgs(['--shift', '2026-08-08', '--outcome', 'process_ticket']), null);
});

test('parseArgs rejects a malformed shift key', () => {
  assert.equal(parseArgs(['--shift', 'today', '--outcome', 'no_change']), null);
});

test('parseArgs rejects an unknown outcome type', () => {
  assert.equal(parseArgs(['--shift', '2026-08-08', '--outcome', 'shrug']), null);
});

test('parseArgs rejects an unrecognized flag', () => {
  assert.equal(parseArgs(['--bogus', 'x', '--shift', '2026-08-08', '--outcome', 'no_change']), null);
});

test('USAGE mentions all three outcome types', () => {
  assert.ok(USAGE.includes('process_ticket') && USAGE.includes('spec_gate_tweak') && USAGE.includes('no_change'));
});

// ── main() (impure, in-process per the CLI thin-wrapper rule) ──────────

test('main() records the outcome and ends the run complete', async () => {
  const target = mkTmp();
  seedPendingRun(target, '2026-08-08');
  const originalArgv = process.argv;
  process.argv = ['node', 'closing-ceremony-outcome.js', '--shift', '2026-08-08', '--outcome', 'process_ticket', '--ref', 'BL-901', '--target', target, '--at', '2026-08-08T22:00:00.000Z'];
  try {
    await main();
  } finally {
    process.argv = originalArgv;
  }
  const run = readCeremonyRun(target, '2026-08-08');
  assert.equal(run.outcome.type, 'process_ticket');
  assert.equal(run.outcome.ref, 'BL-901');
});

test('main() records an explicit no-change outcome with a null ref', async () => {
  const target = mkTmp();
  seedPendingRun(target, '2026-08-08');
  const originalArgv = process.argv;
  process.argv = ['node', 'closing-ceremony-outcome.js', '--shift', '2026-08-08', '--outcome', 'no_change', '--target', target, '--at', '2026-08-08T22:00:00.000Z'];
  try {
    await main();
  } finally {
    process.argv = originalArgv;
  }
  const run = readCeremonyRun(target, '2026-08-08');
  assert.equal(run.outcome.type, 'no_change');
  assert.equal(run.outcome.ref, null);
});
