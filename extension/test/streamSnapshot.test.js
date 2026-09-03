'use strict';

// BL-1351: the /events snapshot carries only the per-item fields its
// consumers read. Unit-level TDD for the projection itself; the acceptance
// feature drives it through the real bridge.
const assert = require('node:assert/strict');
const {
  STREAM_BACKLOG_ITEM_FIELDS,
  projectBacklogItemForStream,
  projectBridgeStateForStream,
} = require('../out/bridge/streamSnapshot');

function fatItem(id) {
  return {
    id,
    title: `title of ${id}`,
    status: 'todo',
    assignedTo: 'coder',
    milestone: 'M8',
    priority: 30,
    epic: 'swarm-reliability',
    type: 'defect',
    severity: 'medium',
    humanApproval: 'approved',
    filename: `${id}.yaml`,
    description: 'x'.repeat(4000),
    notes: 'y'.repeat(4000),
    acceptance: 'specs/features/whatever.feature',
    approvalContext: 'z'.repeat(2000),
    rulingOptions: ['option 1', 'option 2'],
    remainingSlices: ['a slice'],
    firstAcceptanceStep: 'Given something',
  };
}

test('the projection keeps exactly the fields the consumer sweep found read, and nothing else', () => {
  const projected = projectBacklogItemForStream(fatItem('BL-1'));
  assert.deepEqual(Object.keys(projected).sort(), [...STREAM_BACKLOG_ITEM_FIELDS].sort());
  assert.equal(projected.id, 'BL-1');
  assert.equal(projected.title, 'title of BL-1');
});

test('the prose bodies that make the frame 6.7 MB are gone', () => {
  const projected = projectBacklogItemForStream(fatItem('BL-2'));
  for (const dropped of ['description', 'notes', 'acceptance', 'approvalContext', 'rulingOptions', 'remainingSlices', 'firstAcceptanceStep']) {
    assert.ok(!(dropped in projected), `${dropped} is still on the stream`);
  }
});

test('every backlog folder stays on the stream - option 1 narrows items, it does not drop folders', () => {
  const state = {
    pipeline: [{ role: 'coder', displayName: 'Coder', status: 'idle' }],
    agents: [],
    runLog: [],
    backlog: {
      active: [fatItem('BL-3')],
      paused: [fatItem('BL-4')],
      hold: [fatItem('BL-5')],
      done: [fatItem('BL-6')],
    },
  };
  const projected = projectBridgeStateForStream(state);
  assert.deepEqual(Object.keys(projected.backlog).sort(), ['active', 'done', 'hold', 'paused']);
  for (const folder of ['active', 'paused', 'hold', 'done']) {
    assert.equal(projected.backlog[folder].length, 1, `${folder} lost its items`);
    assert.deepEqual(Object.keys(projected.backlog[folder][0]).sort(), [...STREAM_BACKLOG_ITEM_FIELDS].sort());
  }
});

test('everything outside the backlog rides the stream untouched', () => {
  const state = {
    pipeline: [{ role: 'coder', displayName: 'Coder', status: 'working' }],
    agents: [{ role: 'coder', status: 'working', heartbeat: { ageSeconds: 3 } }],
    runLog: [{ id: 'run-1', startedAt: '2026-09-03T00:00:00Z' }],
    backlog: { active: [], paused: [], hold: [], done: [] },
  };
  const projected = projectBridgeStateForStream(state);
  assert.deepEqual(projected.pipeline, state.pipeline);
  assert.deepEqual(projected.agents, state.agents);
  assert.deepEqual(projected.runLog, state.runLog);
});

test('a backlog folder the reader does not carry is not invented', () => {
  const projected = projectBridgeStateForStream({
    pipeline: [],
    agents: [],
    runLog: [],
    backlog: { active: [fatItem('BL-7')] },
  });
  assert.deepEqual(Object.keys(projected.backlog), ['active']);
});

test('the projection is a copy - the state the JSON routes serve is not narrowed underneath them', () => {
  const item = fatItem('BL-8');
  const state = { pipeline: [], agents: [], runLog: [], backlog: { active: [item] } };
  projectBridgeStateForStream(state);
  assert.equal(item.description.length, 4000, 'the projection mutated the shared state');
  assert.equal(state.backlog.active[0], item);
});
