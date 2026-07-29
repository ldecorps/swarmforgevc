const assert = require('node:assert/strict');
const {
  selectAutopilotQueue,
  selectLandQueue,
  formatDryRunList,
  isAlreadySpecced,
} = require('../out/tools/telegramCursorOperatorQueue');
const {
  buildLivenessSnapshot,
  isSwarmLive,
  fullPackPipelineRolesUp,
} = require('../out/tools/telegramCursorOperatorLiveness');
const {
  parseHolidayAddArgs,
  isDateInHoliday,
  applyHolidayAdd,
  applyShiftStart,
  formatHolidayList,
  formatShiftStatus,
  emptyOperatorPolicy,
  isHolidayBlockedVerb,
} = require('../out/tools/telegramCursorOperatorPolicy');
const {
  operatorDangerTier,
  decideOperatorSpecialCallback,
  decideOperatorVerbConfirm,
} = require('../out/tools/telegramCursorOperatorCore');

test('BL-703: autopilot selects high + defect, skips pending and epics', () => {
  const queue = selectAutopilotQueue([
    {
      id: 'BL-1',
      title: 'high',
      severity: 'high',
      humanApproval: 'approved',
      acceptance: 'specs/a.feature',
      priority: 2,
      folder: 'paused',
    },
    {
      id: 'BL-2',
      title: 'defect',
      type: 'defect',
      humanApproval: 'approved',
      acceptance: 'specs/b.feature',
      priority: 1,
      folder: 'active',
    },
    {
      id: 'BL-3',
      title: 'pending',
      severity: 'critical',
      humanApproval: 'pending',
      acceptance: 'specs/c.feature',
      folder: 'paused',
    },
    {
      id: 'BL-4',
      title: 'epic',
      type: 'epic',
      severity: 'high',
      humanApproval: 'approved',
      acceptance: 'specs/d.feature',
      folder: 'paused',
    },
  ]);
  assert.deepEqual(
    queue.map((t) => t.id),
    ['BL-2', 'BL-1']
  );
});

test('BL-703: land selects active only, not paused-only', () => {
  const queue = selectLandQueue(
    [
      { id: 'BL-10', folder: 'active', title: 'live' },
      { id: 'BL-11', folder: 'paused', title: 'parked' },
    ],
    []
  );
  assert.deepEqual(
    queue.map((t) => t.id),
    ['BL-10']
  );
});

test('BL-703: dry list formatting', () => {
  const text = formatDryRunList('autopilot dry', [
    { id: 'BL-1', title: 'One', priority: 1, folder: 'active' },
  ]);
  assert.match(text, /autopilot dry \(1\)/);
  assert.match(text, /BL-1/);
});

test('BL-703: already-specced requires acceptance and non-pending', () => {
  assert.equal(isAlreadySpecced({ id: 'BL-1', folder: 'active', acceptance: 'x.feature' }), true);
  assert.equal(
    isAlreadySpecced({ id: 'BL-1', folder: 'active', acceptance: 'x.feature', humanApproval: 'pending' }),
    false
  );
});

test('BL-703: liveness and full-pack roles', () => {
  const snap = buildLivenessSnapshot([
    { role: 'specifier', session: 's1' },
    { role: 'coder', session: 's2' },
  ]);
  assert.equal(isSwarmLive(snap), true);
  assert.deepEqual(fullPackPipelineRolesUp(snap), ['coder']);
  assert.equal(isSwarmLive(buildLivenessSnapshot([])), false);
});

test('BL-703: autopilot dry is read tier', () => {
  assert.equal(operatorDangerTier('/autopilot dry'), 'read');
  assert.equal(operatorDangerTier('/land dry'), 'read');
  assert.equal(operatorDangerTier('/autopilot'), 'hard');
  const d = decideOperatorVerbConfirm('/autopilot dry', undefined);
  assert.equal(d.action, 'execute');
});

test('BL-703: stop-and-run callback parse', () => {
  const d = decideOperatorSpecialCallback('op:stop-and-run:/pilot BL-698');
  assert.deepEqual(d, { action: 'stop-and-run', verb: '/pilot', args: 'BL-698' });
});

test('BL-698: stop-mode callback parse', () => {
  assert.deepEqual(decideOperatorSpecialCallback('op:stop-drain'), { action: 'stop-mode', mode: 'drain' });
  assert.deepEqual(decideOperatorSpecialCallback('op:stop-emergency'), { action: 'stop-mode', mode: 'emergency' });
});

test('BL-704: holiday add parse and quiet check', () => {
  const parsed = parseHolidayAddArgs('2099-01-01 2099-01-02 maintenance');
  assert.deepEqual(parsed, { start: '2099-01-01', end: '2099-01-02', reason: 'maintenance' });
  let state = emptyOperatorPolicy();
  state = applyHolidayAdd(state, parsed);
  assert.ok(isDateInHoliday('2099-01-01', state.holidays));
  assert.match(formatHolidayList(state), /2099-01-01/);
  assert.equal(isHolidayBlockedVerb('/pilot'), true);
});

test('BL-704: shift start/status', () => {
  let state = emptyOperatorPolicy();
  state = applyShiftStart(state, 'evening', undefined, 1);
  assert.match(formatShiftStatus(state), /evening/);
});

test('BL-704: run-anyway callback', () => {
  const d = decideOperatorSpecialCallback('op:run-anyway:/hydrate INTAKE-x.md');
  assert.deepEqual(d, { action: 'run-anyway', verb: '/hydrate', args: 'INTAKE-x.md' });
});

test('BL-703: batch lock advances and completes land-sleep', () => {
  const {
    writeOperatorBatch,
    advanceOperatorBatch,
    isOperatorBatchInFlight,
    isBatchExclusiveVerb,
  } = require('../out/tools/telegramCursorOperatorBatch');
  const root = require('./helpers/tmpDir').mkTmpDir('bl703-batch-');
  writeOperatorBatch(root, {
    mode: 'land',
    queue: ['BL-1', 'BL-2'],
    index: 0,
    askLandSleep: true,
    startedAtMs: 1,
  });
  assert.equal(isOperatorBatchInFlight(root), true);
  assert.equal(isBatchExclusiveVerb('/pilot'), true);
  const mid = advanceOperatorBatch(root);
  assert.equal(mid.nextTicket, 'BL-2');
  assert.equal(mid.completed, false);
  const done = advanceOperatorBatch(root);
  assert.equal(done.completed, true);
  assert.equal(done.askLandSleep, true);
  assert.equal(isOperatorBatchInFlight(root), false);
});

test('BL-703: awaitSwarmDrain clears when probe goes empty', async () => {
  const { awaitSwarmDrain } = require('../out/tools/telegramCursorOperatorLiveness');
  let calls = 0;
  const result = await awaitSwarmDrain('/tmp', {
    timeoutMs: 5_000,
    pollMs: 1,
    probe: () => {
      calls += 1;
      return { roles: calls < 3 ? [{ role: 'coder', session: 's' }] : [] };
    },
    sleep: async () => {},
    nowMs: (() => {
      let t = 0;
      return () => {
        t += 10;
        return t;
      };
    })(),
  });
  assert.equal(result.cleared, true);
  assert.ok(calls >= 3);
});

test('BL-704: oncall alert target resolution', () => {
  const {
    resolveOncallAlertTarget,
    formatOncallAlertLine,
    applyOncall,
    emptyOperatorPolicy,
  } = require('../out/tools/telegramCursorOperatorPolicy');
  let state = emptyOperatorPolicy();
  assert.equal(resolveOncallAlertTarget(state, '42'), '42');
  state = applyOncall(state, '99');
  assert.equal(resolveOncallAlertTarget(state, '42'), '99');
  assert.match(formatOncallAlertLine(state), /oncall 99/);
});
