'use strict';

// BL-733 declared invariant: pattern tickets never satisfy the pilot land gate
// on repro-only coverage when the producer output space is enumerable.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');
const { PRODUCER_CROSSCHECK_REQUIRED_REFUSAL } = require('../out/tools/producerCrosscheckAcceptance');
const { makeAcceptanceGateDeps } = require('./helpers/pilotAcceptanceGateDeps');

// BL-1229: built on the shared, contract-checked base
// (helpers/pilotAcceptanceGateDeps.js) - only this file's own overrides
// are listed here now.
function patternDeps(overrides = {}) {
  const calls = { move: 0, receipt: 0 };
  const deps = makeAcceptanceGateDeps({
    readAcceptanceDeclaration: () => 'specs/features/BL-733-role-crosscheck.feature',
    readRequiredWiring: () => ['pattern tickets require producer output-space crosscheck'],
    resolveFeatureFilePath: () => '/repo/specs/features/BL-733-role-crosscheck.feature',
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-733-fixture.yaml' };
    },
    writeReceipt: () => {
      calls.receipt += 1;
    },
    getLandedCommit: () => 'a'.repeat(40),
    now: () => '2026-08-25T00:00:00.000Z',
    ...overrides,
  });
  return {
    deps,
    calls,
  };
}

test('BL-733: pattern ticket without producer crosscheck refuses land', async () => {
  const { deps } = patternDeps();
  const outcome = await landPilotedTicket('BL-733', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'producer-crosscheck-required');
  assert.match(outcome.reason, new RegExp(PRODUCER_CROSSCHECK_REQUIRED_REFUSAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('BL-733: exhaustive producer crosscheck lands with receipt metadata', async () => {
  const crosscheck = {
    producer: 'swarmforge.sh::display_name_for_role',
    outputSpaceSize: 7,
    valuesChecked: 7,
    exhaustive: true,
  };
  let written;
  const { deps, calls } = patternDeps({
    runAcceptance: async () => ({ success: true, output: 'ok', producerCrosscheck: crosscheck }),
    writeReceipt: (_ticketId, receipt) => {
      written = receipt;
      calls.receipt += 1;
    },
  });
  const outcome = await landPilotedTicket('BL-733', deps);
  assert.equal(outcome.landed, true);
  assert.deepEqual(written.producerCrosscheck, crosscheck);
});

test('BL-733: incomplete producer crosscheck refuses without move or receipt', async () => {
  const { deps, calls } = patternDeps({
    runAcceptance: async () => ({
      success: true,
      output: 'ok',
      producerCrosscheck: {
        producer: 'swarmforge.sh::display_name_for_role',
        outputSpaceSize: 7,
        valuesChecked: 3,
        exhaustive: false,
      },
    }),
  });
  const outcome = await landPilotedTicket('BL-733', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'producer-crosscheck-required');
  assert.equal(calls.move, 0);
  assert.equal(calls.receipt, 0);
});
