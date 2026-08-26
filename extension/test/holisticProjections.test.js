const assert = require('node:assert/strict');
const {
  parseSwarmName,
  computeAssignments,
  computeCurrentHolders,
  groupDoneByMilestone,
  computeRecentActivity,
} = require('../out/bridge/holisticProjections');

// ── parseSwarmName ────────────────────────────────────────────────────────

test('parseSwarmName reads the configured swarm_name', () => {
  assert.equal(parseSwarmName('config active_backlog_max_depth 3\nconfig swarm_name secondary-1\n'), 'secondary-1');
});

test('parseSwarmName defaults to "primary" when swarm_name is not configured (BL-090 default)', () => {
  assert.equal(parseSwarmName('config active_backlog_max_depth 3\n'), 'primary');
});

test('parseSwarmName defaults to "primary" for empty content', () => {
  assert.equal(parseSwarmName(''), 'primary');
});

// ── computeAssignments (holistic-ui-02) ─────────────────────────────────

function item(overrides = {}) {
  return { id: 'BL-100', title: 't', status: 'active', ...overrides };
}

test('a ticket without a swarm field is treated as the local (primary) swarm\'s, per BL-090\'s default', () => {
  const [assignment] = computeAssignments([item()], [], 'primary', new Map());
  assert.equal(assignment.swarm, 'primary');
  assert.equal(assignment.isLocal, true);
});

test('a ticket with an explicit swarm field matching the local swarm is local', () => {
  const [assignment] = computeAssignments([item({ swarm: 'primary' })], [], 'primary', new Map());
  assert.equal(assignment.isLocal, true);
});

test('a ticket assigned to a different swarm is not local (holistic-ui-03)', () => {
  const [assignment] = computeAssignments([item({ swarm: 'secondary-1' })], [], 'primary', new Map());
  assert.equal(assignment.swarm, 'secondary-1');
  assert.equal(assignment.isLocal, false);
});

test('a local ticket currently held by a role reports that role as its stage', () => {
  const holders = new Map([['BL-100', 'coder']]);
  const [assignment] = computeAssignments([item()], [], 'primary', holders);
  assert.equal(assignment.stageRole, 'coder');
});

test('a local ticket not currently held by any role reports a null stage', () => {
  const [assignment] = computeAssignments([item()], [], 'primary', new Map());
  assert.equal(assignment.stageRole, null);
});

test('a remote ticket never reports a stage, even if the local holder map happens to have that id (no live data for remote swarms)', () => {
  const holders = new Map([['BL-100', 'coder']]);
  const [assignment] = computeAssignments([item({ swarm: 'secondary-1' })], [], 'primary', holders);
  assert.equal(assignment.stageRole, null);
});

test('active and paused items are tagged with their folder status', () => {
  const results = computeAssignments([item({ id: 'BL-100' })], [item({ id: 'BL-101' })], 'primary', new Map());
  assert.equal(results.find((r) => r.ticketId === 'BL-100').folderStatus, 'active');
  assert.equal(results.find((r) => r.ticketId === 'BL-101').folderStatus, 'paused');
});

test('milestone and priority pass through when present', () => {
  const [assignment] = computeAssignments([item({ milestone: 'M4', priority: 2 })], [], 'primary', new Map());
  assert.equal(assignment.milestone, 'M4');
  assert.equal(assignment.priority, 2);
});

test('computeAssignments over no items at all returns an empty array (holistic-ui degrades to nothing, not an error)', () => {
  assert.deepEqual(computeAssignments([], [], 'primary', new Map()), []);
});

// ── computeCurrentHolders ────────────────────────────────────────────────

test('computeCurrentHolders maps a ticket to the role whose window is currently open (endMs null)', () => {
  const windowsByRole = {
    coder: [{ ticketId: 'BL-100', startMs: 1000, endMs: null }],
    cleaner: [{ ticketId: 'BL-099', startMs: 500, endMs: 900 }], // already closed - not a current holder
  };
  const holders = computeCurrentHolders(windowsByRole);
  assert.equal(holders.get('BL-100'), 'coder');
  assert.equal(holders.has('BL-099'), false);
});

test('computeCurrentHolders with no open windows anywhere returns an empty map', () => {
  const holders = computeCurrentHolders({ coder: [{ ticketId: 'BL-100', startMs: 1000, endMs: 2000 }] });
  assert.equal(holders.size, 0);
});

// ── groupDoneByMilestone ─────────────────────────────────────────────────

test('groupDoneByMilestone groups items under their milestone key', () => {
  const grouped = groupDoneByMilestone([
    { id: 'BL-001', title: 't', status: 'done', milestone: 'M1' },
    { id: 'BL-002', title: 't', status: 'done', milestone: 'M1' },
    { id: 'BL-003', title: 't', status: 'done', milestone: 'M2' },
  ]);
  assert.equal(grouped.M1.length, 2);
  assert.equal(grouped.M2.length, 1);
});

test('groupDoneByMilestone buckets a milestone-less item under "unspecified"', () => {
  const grouped = groupDoneByMilestone([{ id: 'BL-001', title: 't', status: 'done' }]);
  assert.equal(grouped.unspecified.length, 1);
});

test('groupDoneByMilestone on an empty list returns an empty object', () => {
  assert.deepEqual(groupDoneByMilestone([]), {});
});

// ── computeRecentActivity ────────────────────────────────────────────────

function lifecycle(ticketId, specDateIso, closeDateIso) {
  return { ticketId, specDateIso, closeDateIso };
}

test('computeRecentActivity lists closed tickets most-recent-first', () => {
  const lifecycles = [
    lifecycle('BL-001', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z'),
    lifecycle('BL-002', '2026-01-01T00:00:00Z', '2026-01-10T00:00:00Z'),
    lifecycle('BL-003', '2026-01-01T00:00:00Z', null),
  ];
  const activity = computeRecentActivity(lifecycles, [], [], '/target', 10);
  assert.deepEqual(activity.recentCloses.map((c) => c.ticketId), ['BL-002', 'BL-001']);
});

test('computeRecentActivity caps recent closes and merges at the given limit', () => {
  const lifecycles = [1, 2, 3].map((d) => lifecycle(`BL-00${d}`, '2026-01-01T00:00:00Z', `2026-01-0${d}T00:00:00Z`));
  const merges = [1, 2, 3].map((d) => ({ commit: `c${d}`, dateIso: `2026-01-0${d}T00:00:00Z`, subject: `m${d}` }));
  const activity = computeRecentActivity(lifecycles, merges, [], '/target', 2);
  assert.equal(activity.recentCloses.length, 2);
  assert.equal(activity.recentMerges.length, 2);
});

test('computeRecentActivity reports the most recent run for the given target path, ignoring other targets', () => {
  const runs = [
    { name: 'a', targetPath: '/other', startedAt: '2026-01-05T00:00:00Z' },
    { name: 'b', targetPath: '/target', startedAt: '2026-01-01T00:00:00Z' },
    { name: 'c', targetPath: '/target', startedAt: '2026-01-03T00:00:00Z' },
  ];
  const activity = computeRecentActivity([], [], runs, '/target', 10);
  assert.equal(activity.currentRun.name, 'c');
});

test('computeRecentActivity reports a null current run when none exist for the target path (cost-07-style graceful zero)', () => {
  const activity = computeRecentActivity([], [], [{ name: 'a', targetPath: '/other', startedAt: '2026-01-01T00:00:00Z' }], '/target', 10);
  assert.equal(activity.currentRun, null);
});

test('computeRecentActivity with no data at all returns empty arrays and a null run, not an error', () => {
  const activity = computeRecentActivity([], [], [], '/target', 10);
  assert.deepEqual(activity, { recentCloses: [], recentMerges: [], currentRun: null });
});
