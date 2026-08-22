const assert = require('node:assert/strict');
const { mkTmpDir } = require('./helpers/tmpDir');
const { parseArgs, USAGE } = require('../out/tools/closingCeremonyAdjustmentArgs');
const { main } = require('../out/tools/closing-ceremony-adjustment');
const { writeCeremonyRun, readCeremonyRun } = require('../out/metrics/closingCeremonyStore');
const { buildClosingCeremonyPacket } = require('../out/quality/closingCeremony');

// BL-820: the coordinator's own CLI for recording a within-power adjustment
// (promotion order / throttle posture) against the ceremony run. main() is
// a thin wrapper - tested in-process (mirrors leanLedgerRecordCli.test.js).

function mkTmp() {
  return mkTmpDir('sfvc-closing-ceremony-adjustment-cli-');
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

test('parseArgs accepts a well-formed promotion_order adjustment', () => {
  assert.deepEqual(parseArgs(['--shift', '2026-08-08', '--kind', 'promotion_order', '--detail', 'reordered active/', '--form', 'note', '--ref', 'note-123', '--target', '/tmp/x']), {
    shift: '2026-08-08',
    kind: 'promotion_order',
    detail: 'reordered active/',
    form: 'note',
    ref: 'note-123',
    target: '/tmp/x',
  });
});

test('parseArgs rejects an unknown kind', () => {
  assert.equal(parseArgs(['--shift', '2026-08-08', '--kind', 'reprioritize_backlog_schema', '--detail', 'x', '--form', 'note', '--ref', 'n']), null);
});

test('parseArgs rejects a missing ref', () => {
  assert.equal(parseArgs(['--shift', '2026-08-08', '--kind', 'throttle_posture', '--detail', 'x', '--form', 'note']), null);
});

test('parseArgs rejects an unknown form', () => {
  assert.equal(parseArgs(['--shift', '2026-08-08', '--kind', 'throttle_posture', '--detail', 'x', '--form', 'email', '--ref', 'n']), null);
});

test('parseArgs rejects an unrecognized flag', () => {
  assert.equal(parseArgs(['--bogus', 'x', '--shift', '2026-08-08', '--kind', 'throttle_posture', '--detail', 'x', '--form', 'note', '--ref', 'n']), null);
});

test('parseArgs rejects a malformed shift key', () => {
  assert.equal(parseArgs(['--shift', 'today', '--kind', 'throttle_posture', '--detail', 'x', '--form', 'note', '--ref', 'n']), null);
});

test('parseArgs rejects a missing detail', () => {
  assert.equal(parseArgs(['--shift', '2026-08-08', '--kind', 'throttle_posture', '--form', 'note', '--ref', 'n']), null);
});

test('USAGE mentions both adjustment kinds', () => {
  assert.ok(USAGE.includes('promotion_order') && USAGE.includes('throttle_posture'));
});

// ── main() (impure, in-process per the CLI thin-wrapper rule) ──────────

test('main() records the adjustment against the run', async () => {
  const target = mkTmp();
  seedPendingRun(target, '2026-08-08');
  const originalArgv = process.argv;
  process.argv = [
    'node',
    'closing-ceremony-adjustment.js',
    '--shift',
    '2026-08-08',
    '--kind',
    'throttle_posture',
    '--detail',
    'dropped active_backlog_max_depth to 1',
    '--form',
    'ticket',
    '--ref',
    'BL-901',
    '--target',
    target,
    '--at',
    '2026-08-08T21:00:00.000Z',
  ];
  try {
    await main();
  } finally {
    process.argv = originalArgv;
  }
  const run = readCeremonyRun(target, '2026-08-08');
  assert.equal(run.adjustments.length, 1);
  assert.equal(run.adjustments[0].kind, 'throttle_posture');
  assert.equal(run.adjustments[0].record.ref, 'BL-901');
});
