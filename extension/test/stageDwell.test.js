const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  deriveDwellRecords,
  computeDwellStats,
  splitOutliers,
  buildStageDwellReport,
  nameBottleneck,
  readRoleStageDwellRecords,
  computeStageDwellReportForRoles,
} = require('../out/metrics/stageDwell');

// BL-102: one command reports where the pipeline's time goes. Header parsing
// is pure over fabricated header records (dwell-01/02/03); only the fs
// adapter tests below touch a real directory tree (dwell-04).

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stage-dwell-'));
}

function writeHandoff(dir, filename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), lines.join('\n') + '\n\nbody\n');
}

// ── deriveDwellRecords (pure) ────────────────────────────────────────────

test('deriveDwellRecords computes queue wait and processing from enqueued/dequeued/completed headers', () => {
  const { records, unparseableCount } = deriveDwellRecords(
    [
      {
        task: 'BL-102-stage-dwell',
        enqueued_at: '2026-07-09T08:00:00Z',
        dequeued_at: '2026-07-09T08:05:00Z',
        completed_at: '2026-07-09T09:05:00Z',
      },
    ],
    'coder'
  );
  assert.equal(unparseableCount, 0);
  assert.equal(records.length, 1);
  assert.equal(records[0].role, 'coder');
  assert.equal(records[0].ticketId, 'BL-102');
  assert.equal(records[0].queueWaitMs, 5 * 60 * 1000);
  assert.equal(records[0].processingMs, 60 * 60 * 1000);
});

test('deriveDwellRecords reports queueWaitMs null when enqueued_at is absent, keeping processing', () => {
  const { records, unparseableCount } = deriveDwellRecords(
    [{ task: 'BL-102-x', dequeued_at: '2026-07-09T08:00:00Z', completed_at: '2026-07-09T08:30:00Z' }],
    'coder'
  );
  assert.equal(unparseableCount, 0);
  assert.equal(records[0].queueWaitMs, null);
  assert.equal(records[0].processingMs, 30 * 60 * 1000);
});

test('deriveDwellRecords counts a record with missing dequeued_at as unparseable, never crashing', () => {
  const { records, unparseableCount } = deriveDwellRecords(
    [{ task: 'BL-102-x', completed_at: '2026-07-09T08:30:00Z' }],
    'coder'
  );
  assert.equal(records.length, 0);
  assert.equal(unparseableCount, 1);
});

test('deriveDwellRecords counts a record with an unparsable timestamp as unparseable', () => {
  const { records, unparseableCount } = deriveDwellRecords(
    [{ task: 'BL-102-x', dequeued_at: 'not-a-date', completed_at: '2026-07-09T08:30:00Z' }],
    'coder'
  );
  assert.equal(records.length, 0);
  assert.equal(unparseableCount, 1);
});

test('deriveDwellRecords tallies unparseable and valid records independently across a mixed batch', () => {
  const { records, unparseableCount } = deriveDwellRecords(
    [
      { task: 'BL-1', dequeued_at: '2026-07-09T08:00:00Z', completed_at: '2026-07-09T08:10:00Z' },
      { task: 'BL-2' },
      { task: 'BL-3', dequeued_at: '2026-07-09T08:00:00Z', completed_at: '2026-07-09T08:20:00Z' },
    ],
    'coder'
  );
  assert.equal(records.length, 2);
  assert.equal(unparseableCount, 1);
});

// ── splitOutliers / computeDwellStats (pure, dwell-03) ──────────────────

test('splitOutliers leaves a small sample untouched (too few points to fence)', () => {
  const { normal, outliers } = splitOutliers([10, 500, 20]);
  assert.deepEqual(outliers, []);
  assert.equal(normal.length, 3);
});

test('splitOutliers flags a single extreme value beyond the upper IQR fence, leaving the rest as normal', () => {
  const { normal, outliers } = splitOutliers([9, 10, 11, 12, 61200000]);
  assert.deepEqual(outliers, [61200000]);
  assert.deepEqual(normal.sort((a, b) => a - b), [9, 10, 11, 12]);
});

test('computeDwellStats reports median/p90/max over the normal subset, listing the outlier separately', () => {
  const stats = computeDwellStats([9, 10, 11, 12, 61200000]);
  assert.equal(stats.medianMs, 10.5);
  assert.equal(stats.maxMs, 12);
  assert.deepEqual(stats.outliersMs, [61200000]);
});

test('computeDwellStats on an empty series reports all nulls and no outliers', () => {
  const stats = computeDwellStats([]);
  assert.deepEqual(stats, { medianMs: null, p90Ms: null, maxMs: null, outliersMs: [] });
});

// ── buildStageDwellReport (pure, dwell-01) ───────────────────────────────

function record(role, queueWaitMs, processingMs, completedAtMs = 0) {
  return { role, ticketId: 'BL-1', queueWaitMs, processingMs, completedAtMs };
}

test('buildStageDwellReport reports parcel count and queue-wait/processing median/p90/max for a stage', () => {
  const current = [
    record('coder', 60000, 120000),
    record('coder', 120000, 180000),
    record('coder', 180000, 240000),
  ];
  const report = buildStageDwellReport('coder', current, [], '2026-07-09T00:00:00Z', '2026-07-08T00:00:00Z');
  assert.equal(report.role, 'coder');
  assert.equal(report.parcelsProcessed, 3);
  assert.equal(report.queueWait.medianMs, 120000);
  assert.equal(report.processing.medianMs, 180000);
});

test('buildStageDwellReport trend is unknown with no prior-window data', () => {
  const report = buildStageDwellReport('coder', [record('coder', 60000, 120000)], [], '2026-07-09T00:00:00Z', '2026-07-08T00:00:00Z');
  assert.equal(report.trend.direction, 'unknown');
});

test('buildStageDwellReport trend compares current vs prior window total median dwell', () => {
  const prior = [record('coder', 60000, 60000)]; // total 120000
  const current = [record('coder', 60000, 240000)]; // total 300000
  const report = buildStageDwellReport('coder', current, prior, '2026-07-09T00:00:00Z', '2026-07-08T00:00:00Z');
  assert.equal(report.trend.direction, 'up');
  assert.equal(report.trend.delta, 180000);
});

// ── nameBottleneck (pure, dwell-02) ──────────────────────────────────────

test('nameBottleneck names the stage whose total median dwell dominates, with its multiple over the next slowest', () => {
  const stages = [
    buildStageDwellReport('coder', [record('coder', 0, 100)], [], 'now', 'prior'),
    buildStageDwellReport('cleaner', [record('cleaner', 0, 1000)], [], 'now', 'prior'),
    buildStageDwellReport('architect', [record('architect', 0, 300)], [], 'now', 'prior'),
  ];
  const bottleneck = nameBottleneck(stages);
  assert.equal(bottleneck.role, 'cleaner');
  assert.equal(bottleneck.multipleOverNext, 1000 / 300);
});

test('nameBottleneck returns null when no stage has processed a parcel', () => {
  const stages = [buildStageDwellReport('coder', [], [], 'now', 'prior')];
  assert.equal(nameBottleneck(stages), null);
});

test('nameBottleneck reports a null multiple when only one stage has data', () => {
  const stages = [buildStageDwellReport('coder', [record('coder', 0, 100)], [], 'now', 'prior')];
  const bottleneck = nameBottleneck(stages);
  assert.equal(bottleneck.role, 'coder');
  assert.equal(bottleneck.multipleOverNext, null);
});

// ── readRoleStageDwellRecords (fs adapter, dwell-04) ─────────────────────

test('readRoleStageDwellRecords reads direct completed handoff files', () => {
  const worktree = mkTmp();
  const entry = { role: 'coder', worktreeName: 'coder', worktreePath: worktree };
  writeHandoff(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed'), '00_a.handoff', {
    task: 'BL-1-a',
    dequeued_at: '2026-07-09T08:00:00Z',
    completed_at: '2026-07-09T08:10:00Z',
  });
  const { records } = readRoleStageDwellRecords(entry, 0, Date.parse('2026-07-10T00:00:00Z'));
  assert.equal(records.length, 1);
  assert.equal(records[0].ticketId, 'BL-1');
});

test('readRoleStageDwellRecords includes completed handoffs nested inside a batch_* directory', () => {
  const worktree = mkTmp();
  const entry = { role: 'hardender', worktreeName: 'hardender', worktreePath: worktree };
  const batchDir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed', 'batch_20260709T080000Z_01');
  writeHandoff(batchDir, '00_a.handoff', {
    task: 'BL-2-batched',
    dequeued_at: '2026-07-09T08:00:00Z',
    completed_at: '2026-07-09T08:10:00Z',
  });
  const { records } = readRoleStageDwellRecords(entry, 0, Date.parse('2026-07-10T00:00:00Z'));
  assert.equal(records.length, 1);
  assert.equal(records[0].ticketId, 'BL-2');
});

test('readRoleStageDwellRecords filters to the given window by completed_at', () => {
  const worktree = mkTmp();
  const entry = { role: 'coder', worktreeName: 'coder', worktreePath: worktree };
  const completedDir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed');
  writeHandoff(completedDir, '00_old.handoff', {
    task: 'BL-1-old',
    dequeued_at: '2026-07-01T08:00:00Z',
    completed_at: '2026-07-01T08:10:00Z',
  });
  writeHandoff(completedDir, '00_new.handoff', {
    task: 'BL-2-new',
    dequeued_at: '2026-07-09T08:00:00Z',
    completed_at: '2026-07-09T08:10:00Z',
  });
  const { records } = readRoleStageDwellRecords(entry, Date.parse('2026-07-08T00:00:00Z'), Date.parse('2026-07-10T00:00:00Z'));
  assert.equal(records.length, 1);
  assert.equal(records[0].ticketId, 'BL-2');
});

test('readRoleStageDwellRecords returns an empty array for a role with no completed handoffs at all', () => {
  const worktree = mkTmp();
  const entry = { role: 'coder', worktreeName: 'coder', worktreePath: worktree };
  assert.doesNotThrow(() => readRoleStageDwellRecords(entry, 0, Date.now()));
  assert.deepEqual(readRoleStageDwellRecords(entry, 0, Date.now()).records, []);
});

test('readRoleStageDwellRecords resolves a master-resident role (coordinator/specifier) to its nested mailbox subdirectory', () => {
  const worktree = mkTmp();
  const entry = { role: 'specifier', worktreeName: 'master', worktreePath: worktree };
  writeHandoff(path.join(worktree, '.swarmforge', 'handoffs', 'specifier', 'inbox', 'completed'), '00_a.handoff', {
    task: 'BL-3-spec',
    dequeued_at: '2026-07-09T08:00:00Z',
    completed_at: '2026-07-09T08:10:00Z',
  });
  const { records } = readRoleStageDwellRecords(entry, 0, Date.parse('2026-07-10T00:00:00Z'));
  assert.equal(records.length, 1);
  assert.equal(records[0].ticketId, 'BL-3');
});

// ── computeStageDwellReportForRoles (full orchestration, dwell-01/04/05) ─

test('computeStageDwellReportForRoles reports only pipeline stages, excluding the coordinator', () => {
  const worktree = mkTmp();
  const roles = [
    { role: 'coordinator', worktreeName: 'master', worktreePath: worktree },
    { role: 'coder', worktreeName: 'coder', worktreePath: worktree },
  ];
  const result = computeStageDwellReportForRoles(roles, Date.now(), 24);
  assert.deepEqual(result.stages.map((s) => s.role), ['coder']);
});

test('computeStageDwellReportForRoles surfaces the total unparseable count across all stages', () => {
  const worktree = mkTmp();
  writeHandoff(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed'), '00_bad.handoff', {
    task: 'BL-9-bad',
    completed_at: '2026-07-09T08:10:00Z',
  });
  const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: worktree }];
  const result = computeStageDwellReportForRoles(roles, Date.now(), 24);
  assert.equal(result.unparseableCount, 1);
});
