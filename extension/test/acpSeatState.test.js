const assert = require('node:assert/strict');
const {
  EMPTY_SEAT_STATE,
  applyAcpEvent,
  foldAcpEvents,
  decideIdle,
  decidePermission,
  snapshotForSeat,
} = require('../out/swarm/acpSeatState');

// BL-1081: the decisions the deterministic layer takes. Every assertion here
// is about a fact the protocol supplied - no pane text appears anywhere in
// this file, which is the invariant in miniature.

const turnEnded = (stopReason) => ({ kind: 'turn_ended', stopReason });
const permission = (tool, requestId = 1) => ({ kind: 'permission_requested', requestId, tool });
const toolStatus = (tool, status) => ({ kind: 'tool_status', tool, status });
const say = (text, role = 'agent') => ({ kind: 'transcript', role, text });

test('a seat that has never ended a turn is not idle', () => {
  // The case a frozen pane got wrong in both directions: quiet is not done.
  const v = decideIdle(EMPTY_SEAT_STATE);
  assert.equal(v.idle, false);
  assert.equal(v.from, 'no_turn_ended');
});

test('a turn that ended makes the seat idle, and names the stop reason it came from', () => {
  const v = decideIdle(foldAcpEvents([turnEnded('end_turn')]));
  assert.equal(v.idle, true);
  assert.equal(v.from, 'stop_reason:end_turn');
});

test('every stop reason ends the turn - the seat is idle however it stopped', () => {
  for (const stop of ['end_turn', 'max_tokens', 'refusal', 'cancelled', 'error']) {
    const v = decideIdle(foldAcpEvents([turnEnded(stop)]));
    assert.equal(v.idle, true, `${stop} ends the turn`);
    assert.equal(v.from, `stop_reason:${stop}`);
  }
});

test('a running tool is not idle, and says which tool', () => {
  const v = decideIdle(foldAcpEvents([toolStatus('bash', 'started')]));
  assert.equal(v.idle, false);
  assert.equal(v.from, 'tool_running:bash');
});

test('a completed tool no longer holds the seat busy', () => {
  const v = decideIdle(foldAcpEvents([toolStatus('bash', 'started'), toolStatus('bash', 'completed'), turnEnded('end_turn')]));
  assert.equal(v.idle, true);
});

test('a seat blocked on permission is NOT idle - blocked and idle are different conditions', () => {
  // Conflating them is how a permission moment used to read as a stall, and
  // why they need different responses.
  const v = decideIdle(foldAcpEvents([permission('write_file')]));
  assert.equal(v.idle, false);
  assert.equal(v.from, 'permission_requested:write_file');
});

test('a permission block is reported structurally, with the id needed to answer it', () => {
  const v = decidePermission(foldAcpEvents([permission('write_file', 42)]));
  assert.equal(v.blocked, true);
  assert.equal(v.tool, 'write_file');
  assert.equal(v.requestId, 42);
  assert.equal(v.from, 'permission_requested:write_file', 'the decision trail must name the actual tool, not a blank fact');
});

test('no request means not blocked', () => {
  assert.deepEqual(decidePermission(EMPTY_SEAT_STATE), { blocked: false, from: 'no_permission_request' });
});

test('a turn ending clears a pending permission - one moment cannot mute the seat forever', () => {
  const state = foldAcpEvents([permission('write_file'), turnEnded('end_turn')]);
  assert.equal(decidePermission(state).blocked, false);
  assert.equal(decideIdle(state).idle, true);
});

test('a tool resolving clears the permission that was gating it', () => {
  const state = foldAcpEvents([permission('bash'), toolStatus('bash', 'completed')]);
  assert.equal(decidePermission(state).blocked, false);
});

test('a tool STARTING again does not clear a pending permission for that tool - only completing/failing resolves it', () => {
  // Distinct from the test above: 'started' must take the OTHER branch of the
  // resolution check, not merely share its outcome by coincidence.
  const state = foldAcpEvents([permission('bash'), toolStatus('bash', 'started')]);
  assert.equal(decidePermission(state).blocked, true, 'permission must still be pending while the tool is only starting');
});

test('a completed tool is removed from the running set, leaving a DIFFERENT concurrently-running tool untouched', () => {
  // A single-tool scenario cannot tell "remove only this tool" apart from
  // "remove everything" or "remove nothing" - both convergently empty the
  // list. Two tools running at once is what makes the distinction real.
  const state = foldAcpEvents([toolStatus('bash', 'started'), toolStatus('grep', 'started'), toolStatus('bash', 'completed')]);
  assert.deepEqual(state.runningTools, ['grep']);
});

test("a DIFFERENT tool resolving does not clear another tool's pending permission", () => {
  const state = foldAcpEvents([permission('write_file'), toolStatus('bash', 'completed')]);
  assert.equal(decidePermission(state).blocked, true);
  assert.equal(decidePermission(state).tool, 'write_file');
});

test('the transcript accumulates in order, attributed to its speakers', () => {
  const state = foldAcpEvents([say('one'), say('two', 'user'), say('three', 'tool')]);
  assert.deepEqual(state.transcript, ['agent: one', 'user: two', 'tool: three']);
});

test('applyAcpEvent never mutates the state it is given', () => {
  const before = foldAcpEvents([say('one')]);
  const snapshotBefore = JSON.stringify(before);
  applyAcpEvent(before, turnEnded('end_turn'));
  assert.equal(JSON.stringify(before), snapshotBefore);
});

test('the snapshot the bb side reads is flat scalars in the protocol vocabulary', () => {
  const snap = snapshotForSeat('coder', foldAcpEvents([say('hi'), turnEnded('end_turn')]));
  assert.deepEqual(snap, {
    role: 'coder',
    acp: true,
    stopReason: 'end_turn',
    idle: true,
    idleFrom: 'stop_reason:end_turn',
    permissionPending: false,
    permissionTool: null,
    turnsEnded: 1,
  });
});

test('the snapshot reports a blocked seat as blocked and not idle', () => {
  const snap = snapshotForSeat('coder', foldAcpEvents([permission('write_file')]));
  assert.equal(snap.permissionPending, true);
  assert.equal(snap.permissionTool, 'write_file');
  assert.equal(snap.idle, false);
});

test('turnsEnded distinguishes "not started" from "finished a turn"', () => {
  assert.equal(snapshotForSeat('r', EMPTY_SEAT_STATE).turnsEnded, 0);
  assert.equal(snapshotForSeat('r', foldAcpEvents([turnEnded('end_turn'), turnEnded('end_turn')])).turnsEnded, 2);
});
