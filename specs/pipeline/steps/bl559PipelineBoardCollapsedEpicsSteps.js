'use strict';

// BL-1947 (BL-559 stamp-off): step handlers for "The pipeline board
// collapses paused epic trackers into one line per epic with child
// counts". Drives the REAL compiled computePipelineBoard
// (extension/out/concierge/pipelineBoard.js) directly against fixture
// paused items/ticketMeta - mirroring extension/test/pipelineBoard.test.js's
// own established BL-559 fixture shape exactly, never a restatement of
// the collapse/child-count logic.

const assert = require('node:assert/strict');
const path = require('node:path');

let _pipelineBoardModule = null;
function pipelineBoardModule() {
  if (!_pipelineBoardModule) _pipelineBoardModule = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'pipelineBoard.js'));
  return _pipelineBoardModule;
}

const FEATURE = 'The pipeline board collapses paused epic trackers into one line per epic with child counts';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── collapsed-epics-01 ────────────────────────────────────────────────
  scoped(/^a paused epic tracker for epic swarm-reliability$/, (ctx) => {
    ctx.paused = ctx.paused || [];
    ctx.ticketMeta = ctx.ticketMeta || {};
    ctx.paused.push({ id: 'BL-539', type: 'epic', epic: 'swarm-reliability', priority: 1 });
    ctx.ticketMeta['BL-539'] = { type: 'epic', epic: 'swarm-reliability', title: 'EPIC — Swarm reliability', location: 'paused' };
  });

  scoped(/^paused child slices under that epic$/, (ctx) => {
    ctx.paused.push(
      { id: 'BL-528', type: 'defect', epic: 'swarm-reliability', priority: 5 },
      { id: 'BL-530', type: 'defect', epic: 'swarm-reliability', priority: 6 }
    );
    ctx.ticketMeta['BL-528'] = { type: 'defect', epic: 'swarm-reliability', title: 'Auto heal', location: 'paused' };
    ctx.ticketMeta['BL-530'] = { type: 'defect', epic: 'swarm-reliability', title: 'Launch config heal', location: 'paused' };
    // An active child slice too, proving activeChildCount is wired, not
    // just pausedChildCount.
    ctx.ticketMeta['BL-551'] = { type: 'feature', epic: 'swarm-reliability', title: 'Cost ledger', location: 'active' };
    ctx.activeIds = ['BL-551'];
  });

  scoped(/^the pipeline board is computed$/, (ctx) => {
    const { computePipelineBoard } = pipelineBoardModule();
    ctx.board = computePipelineBoard({}, ctx.paused, ctx.ticketMeta, { activeIds: ctx.activeIds || [] });
  });

  scoped(/^the collapsed epics list names swarm-reliability with child counts$/, (ctx) => {
    assert.equal(ctx.board.collapsedEpics.length, 1);
    assert.equal(ctx.board.collapsedEpics[0].epicSlug, 'swarm-reliability');
    assert.equal(ctx.board.collapsedEpics[0].pausedChildCount, 2);
    assert.equal(ctx.board.collapsedEpics[0].activeChildCount, 1);
  });

  scoped(/^the tracker ticket id does not appear as a plain parked line$/, (ctx) => {
    const parkedIds = ctx.board.parked.filter((p) => p.status === 'parked').map((p) => p.id);
    assert.ok(!parkedIds.includes('BL-539'), 'the epic tracker itself must not appear as a plain parked line');
    assert.deepEqual(parkedIds, ['BL-528', 'BL-530'], 'the child slices must still render as normal parked lines');
  });

  // ── collapsed-epics-02 ────────────────────────────────────────────────
  scoped(/^a paused epic tracker with human approval pending$/, (ctx) => {
    ctx.paused = [{ id: 'BL-554', type: 'epic', epic: 'root-capability-commands', humanApproval: 'pending' }];
    ctx.ticketMeta = { 'BL-554': { type: 'epic', epic: 'root-capability-commands', title: 'Root capability epic', location: 'paused' } };
  });

  scoped(/^the tracker appears under AWAITING APPROVAL with its ticket id$/, (ctx) => {
    const awaitingIds = ctx.board.parked.filter((p) => p.status === 'awaiting-approval').map((p) => p.id);
    assert.deepEqual(awaitingIds, ['BL-554']);
  });

  scoped(/^it does not appear in the collapsed epics list$/, (ctx) => {
    assert.equal(ctx.board.collapsedEpics.length, 0);
  });
}

module.exports = { registerSteps };
