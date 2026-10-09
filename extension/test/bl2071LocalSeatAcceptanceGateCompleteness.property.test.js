'use strict';

// BL-2071 declared invariant 1: "A local-model seat never queues a
// git_handoff for a ticket whose acceptance feature does not pass at the
// forwarded commit." Drives the REAL send path (swarm_handoff.bb, via
// lib/bl2071LocalSeatAcceptanceGateCli.sh's `cell` action) over a real git
// fixture for a local-model seat, across every (markerA, markerB) shape of
// its two-scenario acceptance feature - EXHAUSTIVE, not sampled: the shape
// space is exactly 4 cells (BL-1062/BL-2083's own rule - a space this small
// is constructed by a plain loop, never hoped for from a random draw), so
// every cell runs exactly once rather than leaning on fast-check's sampler.
//
// Non-vacuous: confirmed red (a local seat delivering regardless of the
// acceptance feature's outcome) by temporarily short-circuiting
// local_seat_acceptance_gate_lib.bb's run-check! to always return
// {:findings []}, then restoring it.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'bl2071LocalSeatAcceptanceGateCli.sh');

function runCell(markerA, markerB) {
  const out = execFileSync('bash', [CLI, 'cell', 'local', markerA, markerB], { encoding: 'utf8', timeout: 60000 });
  return JSON.parse(out.trim().split('\n').pop());
}

const CELLS = [
  ['pass', 'pass'],
  ['pass', 'fail'],
  ['fail', 'pass'],
  ['fail', 'fail'],
];

test('property (BL-2071 invariant 1): a local-model seat delivers iff every scenario of its ticket\'s acceptance feature passes', async () => {
  for (const [markerA, markerB] of CELLS) {
    const result = runCell(markerA, markerB);
    const bothPass = markerA === 'pass' && markerB === 'pass';
    assert.equal(
      result.delivered,
      bothPass,
      `markerA=${markerA} markerB=${markerB}: expected delivered=${bothPass}, got ${JSON.stringify(result)}`
    );
    assert.equal(
      result.exitCode === 0,
      bothPass,
      `markerA=${markerA} markerB=${markerB}: expected exit 0 iff both pass, got ${JSON.stringify(result)}`
    );
  }
});
