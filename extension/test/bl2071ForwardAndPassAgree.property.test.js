'use strict';

// BL-2071 declared invariant 2: "The forward check and the assert step's
// pass run the same check and agree on the same commit." Drives BOTH real
// callers - swarm_handoff.bb's send (lib/bl2071LocalSeatAcceptanceGateCli.sh's
// `cell` action) and local_seat_phase_cli.bb's `pass` (`cell-phase-pass`) -
// over the SAME fixture commit for every (markerA, markerB) shape of the
// two-scenario acceptance feature. EXHAUSTIVE, not sampled: the shape space
// is exactly 4 cells (BL-1062/BL-2083's own rule), each run exactly once.
//
// Non-vacuous: confirmed red (the two callers disagreeing) by temporarily
// making local_seat_phase_cli.bb's pass-path skip the acceptance check
// (local-model-acceptance-refusal short-circuited to nil) while
// swarm_handoff.bb's gate stayed wired - the send refused and pass
// proceeded on the SAME failing cell - then restoring it.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'bl2071LocalSeatAcceptanceGateCli.sh');

function runCell(action, markerA, markerB) {
  const out = execFileSync('bash', [CLI, action, 'local', markerA, markerB], { encoding: 'utf8', timeout: 60000 });
  return JSON.parse(out.trim().split('\n').pop());
}

const CELLS = [
  ['pass', 'pass'],
  ['pass', 'fail'],
  ['fail', 'pass'],
  ['fail', 'fail'],
];

test('property (BL-2071 invariant 2): the git_handoff send and the phase-pass check agree on every cell of the same fixture commit', async () => {
  for (const [markerA, markerB] of CELLS) {
    const sendResult = runCell('cell', markerA, markerB);
    const passResult = runCell('cell-phase-pass', markerA, markerB);
    const label = `markerA=${markerA} markerB=${markerB}`;
    assert.equal(
      sendResult.delivered,
      passResult.phase === 'done',
      `${label}: send delivered=${sendResult.delivered} but phase-pass left phase=${passResult.phase} - the two callers disagree: ${JSON.stringify({ sendResult, passResult })}`
    );
  }
});
