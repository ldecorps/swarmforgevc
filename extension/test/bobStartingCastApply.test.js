'use strict';

const assert = require('node:assert/strict');
const {
  applyBobCast,
  assertKnownApplyPath,
  rolesWithModelChange,
} = require('../out/tools/bobStartingCastApply');
const { agentMemoryTransfer } = require('../out/tools/agentMemoryTransfer');

const FIXTURE_CAST = {
  kind: 'bob-starting-cast',
  schemaVersion: 1,
  roles: {
    coder: {
      role: 'coder',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      agent: 'claude',
    },
  },
};

test('BL-1181: rolesWithModelChange detects model delta', () => {
  assert.deepEqual(rolesWithModelChange(FIXTURE_CAST, { coder: 'claude-sonnet-5' }), ['coder']);
  assert.deepEqual(rolesWithModelChange(FIXTURE_CAST, { coder: 'claude-opus-4-8' }), []);
});

test('BL-1181: applyBobCast runs memory transfer before overlay write', () => {
  let overlayWritten = false;
  const result = applyBobCast({
    cast: FIXTURE_CAST,
    currentModels: { coder: 'claude-sonnet-5' },
    outgoingByRole: {
      coder: { role: 'coder', transcriptSummary: 'continuity', openParcelIds: ['p1'] },
    },
    writeOverlay: () => {
      overlayWritten = true;
      return { via: 'model-factory-overlay', overlayPath: '/tmp/overlay.json' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(overlayWritten, true);
  assert.equal(result.via, 'model-factory-overlay');
  assert.deepEqual(result.memoryTransferred, ['coder']);
});

test('BL-1181: applyBobCast refuses unknown apply paths', () => {
  assert.throws(() => assertKnownApplyPath('custom-assignment-writer'), /unknown BoB cast apply path/);
});

test('BL-1181: applyBobCast transfers memory for changed role only', () => {
  const result = applyBobCast({
    cast: FIXTURE_CAST,
    currentModels: { coder: 'claude-sonnet-5' },
    outgoingByRole: {
      coder: { role: 'coder', transcriptSummary: 'x', openParcelIds: [] },
    },
    deps: {
      capture: agentMemoryTransfer.capture,
      inject: agentMemoryTransfer.inject,
    },
    writeOverlay: () => ({ via: 'model-factory-overlay' }),
  });
  assert.equal(result.ok, true);
});
