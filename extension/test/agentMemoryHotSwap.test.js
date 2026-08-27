'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  attemptSameRoleModelSwitch,
  buildOutgoingCaptureState,
  runMemoryTransferForRole,
  runTrialBoundaryMemoryTransfer,
} = require('../out/tools/agentMemoryHotSwap');
const { agentMemoryTransfer } = require('../out/tools/agentMemoryTransfer');

test('BL-1178: buildOutgoingCaptureState reads open parcels from role inbox', () => {
  const root = mkTmpDir('agent-memory-hotswap-');
  const inbox = path.join(root, '.swarmforge', 'handoffs', 'inbox');
  fs.mkdirSync(path.join(inbox, 'new'), { recursive: true });
  fs.mkdirSync(path.join(inbox, 'in_process'), { recursive: true });
  fs.writeFileSync(path.join(inbox, 'new', '10_foo.handoff'), 'payload\n', 'utf8');
  fs.writeFileSync(path.join(inbox, 'in_process', '20_bar.handoff'), 'payload\n', 'utf8');
  const state = buildOutgoingCaptureState(root, 'coder');
  assert.deepEqual(state.openParcelIds.sort(), ['10_foo.handoff', '20_bar.handoff']);
});

test('BL-1178: attemptSameRoleModelSwitch injects before performSwap runs', () => {
  let swapRan = false;
  const result = attemptSameRoleModelSwitch({
    role: 'coder',
    outgoingState: {
      role: 'coder',
      transcriptSummary: 'unit test',
      openParcelIds: ['p1'],
    },
    performSwap: () => {
      swapRan = true;
      return { success: true, message: 'ok' };
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.memoryCaptured, true);
  assert.equal(result.memoryInjected, true);
  assert.equal(swapRan, true);
});

test('BL-1178: failed inject aborts switch without calling performSwap', () => {
  let swapRan = false;
  const result = attemptSameRoleModelSwitch({
    role: 'coder',
    outgoingState: { role: 'coder', transcriptSummary: '', openParcelIds: [] },
    performSwap: () => {
      swapRan = true;
      return { success: true, message: 'must not run' };
    },
    deps: {
      capture: agentMemoryTransfer.capture,
      inject: () => ({
        ok: false,
        signal: 'inject refused: portable memory payload is malformed — fail closed',
        pretendedContinuity: false,
      }),
    },
  });
  assert.equal(result.success, false);
  assert.match(result.message, /inject refused/i);
  assert.equal(swapRan, false);
});

test('BL-1178: trial boundary uses same capture/inject API', () => {
  for (const boundary of ['start', 'end']) {
    const result = runTrialBoundaryMemoryTransfer('architect', boundary, {
      role: 'architect',
      transcriptSummary: `trial ${boundary}`,
      openParcelIds: [`trial-${boundary}`],
    });
    assert.equal(result.ok, true);
    assert.equal(result.captured, true);
    assert.equal(result.injected, true);
  }
});

test('BL-1178: runMemoryTransferForRole round-trips capture and inject', () => {
  const result = runMemoryTransferForRole('qa', {
    role: 'qa',
    transcriptSummary: 'continuity',
    openParcelIds: ['parcel-a'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.continuitySummary, 'continuity');
});
