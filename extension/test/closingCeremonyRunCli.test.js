const assert = require('node:assert/strict');
const { mkTmpDir } = require('./helpers/tmpDir');
const { main } = require('../out/tools/closing-ceremony-run');
const { readCeremonyRun } = require('../out/metrics/closingCeremonyStore');

// BL-820: closing-ceremony-run.js's driver CLI. main() is a thin wrapper -
// tested in-process (mirrors closingCeremonyOutcomeCli.test.js). A target
// with no lean ledger events at all takes the empty-shift auto-no-change
// path, so this never shells out through the real sendNoteViaHandoff -
// deps.sendNote is only reached on a non-empty shift or a stale prior run,
// neither of which exists in a fresh fixture dir.

function mkTmp() {
  return mkTmpDir('sfvc-closing-ceremony-run-cli-');
}

test('main() runs the ceremony end-to-end for an empty shift, auto-recording no_change', async () => {
  const target = mkTmp();
  const originalArgv = process.argv;
  process.argv = ['node', 'closing-ceremony-run.js', '--target', target, '--at', '2026-08-08T22:00:00.000Z'];
  try {
    await main();
  } finally {
    process.argv = originalArgv;
  }
  const run = readCeremonyRun(target, '2026-08-08');
  assert.equal(run.outcome.type, 'no_change');
});

test('main() prints usage and does not throw when args are malformed', async () => {
  const originalArgv = process.argv;
  process.argv = ['node', 'closing-ceremony-run.js', '--bogus', 'x'];
  try {
    await main();
  } finally {
    process.argv = originalArgv;
  }
});
