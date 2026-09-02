const { mkTmpDir } = require('./helpers/tmpDir');
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
  computeSeatDwellDetail,
} = require('../out/metrics/stageDwell');

// BL-102: one command reports where the pipeline's time goes. Header parsing
// is pure over fabricated header records (dwell-01/02/03); only the fs
// adapter tests below touch a real directory tree (dwell-04).

function mkTmp() {
  return mkTmpDir('sfvc-stage-dwell-');
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

test('deriveDwellRecords resolves a no-hyphen task header to its canonical ticketId (BL-504 ts-metrics-ticket-id-02)', () => {
  const { records } = deriveDwellRecords(
    [
      {
        task: 'bl493-fold-ticket-events',
        enqueued_at: '2026-07-09T08:00:00Z',
        dequeued_at: '2026-07-09T08:05:00Z',
        completed_at: '2026-07-09T09:05:00Z',
      },
    ],
    'coder'
  );
  assert.equal(records[0].ticketId, 'BL-493');
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

// ── nameBottleneck (pure, dwell-02, BL-909 processing-only ranking) ─────

test('nameBottleneck names the stage whose median PROCESSING dominates, with its multiple over the next slowest', () => {
  const stages = [
    buildStageDwellReport('coder', [record('coder', 0, 100)], [], 'now', 'prior'),
    buildStageDwellReport('cleaner', [record('cleaner', 0, 1000)], [], 'now', 'prior'),
    buildStageDwellReport('architect', [record('architect', 0, 300)], [], 'now', 'prior'),
  ];
  const bottleneck = nameBottleneck(stages);
  assert.equal(bottleneck.role, 'cleaner');
  assert.equal(bottleneck.processingDwellMs, 1000);
  assert.equal(bottleneck.multipleOverNext, 1000 / 300);
});

// BL-909 regression: the exact human-reported shape - a dormant stage with
// a huge queue wait but a tiny processing median must never outrank a
// stage that genuinely takes longer to do the work, even though its
// queue-wait-inclusive TOTAL is far larger.
test('nameBottleneck never lets queue wait make a dormant stage the bottleneck (BL-909)', () => {
  const stages = [
    // specifier: total 6,660,000ms (huge), processing only 60,000ms
    buildStageDwellReport('specifier', [record('specifier', 6600000, 60000)], [], 'now', 'prior'),
    // hardender: total 1,560,000ms (far smaller), processing 1,500,000ms (dominant)
    buildStageDwellReport('hardender', [record('hardender', 60000, 1500000)], [], 'now', 'prior'),
  ];
  const bottleneck = nameBottleneck(stages);
  assert.equal(bottleneck.role, 'hardender');
  assert.notEqual(bottleneck.role, 'specifier');
  assert.equal(bottleneck.processingDwellMs, 1500000);
  assert.equal(bottleneck.multipleOverNext, 1500000 / 60000);
});

// BL-909 invariant 2: totalDwellMs keeps its pre-existing meaning
// (wait + processing for the NAMED stage) - a distinct field from
// processingDwellMs, never silently collapsed into the same value.
test('nameBottleneck reports totalDwellMs as wait+processing for the named stage, distinct from processingDwellMs', () => {
  const stages = [
    buildStageDwellReport('hardender', [record('hardender', 60000, 1500000)], [], 'now', 'prior'),
    buildStageDwellReport('QA', [record('QA', 43000 * 60, 14000 * 60)], [], 'now', 'prior'),
  ];
  const bottleneck = nameBottleneck(stages);
  assert.equal(bottleneck.role, 'hardender');
  assert.equal(bottleneck.totalDwellMs, 60000 + 1500000);
  assert.equal(bottleneck.processingDwellMs, 1500000);
  assert.notEqual(bottleneck.totalDwellMs, bottleneck.processingDwellMs);
});

test('nameBottleneck returns null when no stage has processed a parcel', () => {
  const stages = [buildStageDwellReport('coder', [], [], 'now', 'prior')];
  assert.equal(nameBottleneck(stages), null);
});

test('nameBottleneck reports a null multiple when only one stage has data', () => {
  const stages = [buildStageDwellReport('coder', [record('coder', 0, 100)], [], 'now', 'prior')];
  const bottleneck = nameBottleneck(stages);
  assert.equal(bottleneck.role, 'coder');
  assert.equal(bottleneck.processingDwellMs, 100);
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

// ── BL-1319: the dwell instrument names the STAGE, never a seat ───────────
// BL-983 declared that seat identity never escapes the mailbox layer;
// BL-1040 closed the board and stage map. The optimizer's own instrument was
// still open, and the live shape is WORSE than the split the ticket
// describes: `computeStageDwellReportForRoles` filters on PIPELINE_ORDER,
// which holds bare stage names only, so a non-bare seat's row is not merely
// keyed separately - it is DROPPED, and the stage is reported as though the
// seat's parcels never happened. An understated stage can then be ranked
// below a single-seat stage that is actually faster, which makes this a
// wrong optimizer answer rather than a mislabelled one.

function seatFixture() {
  const root = mkTmp();
  const stamp = (dequeued, completed) => ({ dequeued_at: dequeued, completed_at: completed });
  // Bare coder seat: two FAST parcels.
  writeHandoff(path.join(root, 'wt-coder', '.swarmforge', 'handoffs', 'inbox', 'completed'), '00_a.handoff', {
    task: 'BL-901-a', ...stamp('2026-07-09T08:00:00Z', '2026-07-09T08:01:00Z'),
  });
  writeHandoff(path.join(root, 'wt-coder', '.swarmforge', 'handoffs', 'inbox', 'completed'), '00_b.handoff', {
    task: 'BL-902-b', ...stamp('2026-07-09T08:00:00Z', '2026-07-09T08:01:00Z'),
  });
  // Second coder seat: two SLOW parcels. Neither seat alone is the slowest;
  // together the stage is.
  writeHandoff(path.join(root, 'wt-coder2', '.swarmforge', 'handoffs', 'inbox', 'completed'), '00_c.handoff', {
    task: 'BL-903-c', ...stamp('2026-07-09T08:00:00Z', '2026-07-09T08:30:00Z'),
  });
  writeHandoff(path.join(root, 'wt-coder2', '.swarmforge', 'handoffs', 'inbox', 'completed'), '00_d.handoff', {
    task: 'BL-904-d', ...stamp('2026-07-09T08:00:00Z', '2026-07-09T08:30:00Z'),
  });
  // A single-seat stage that outranks the coder stage while the second
  // seat's parcels are dropped, and loses to it once the stage is whole.
  // (15 min vs the folded coder median of 15.5 - the fold decides it.)
  writeHandoff(path.join(root, 'wt-cleaner', '.swarmforge', 'handoffs', 'inbox', 'completed'), '00_e.handoff', {
    task: 'BL-905-e', ...stamp('2026-07-09T08:00:00Z', '2026-07-09T08:15:00Z'),
  });
  const roles = [
    { role: 'coder', worktreeName: 'coder', worktreePath: path.join(root, 'wt-coder') },
    { role: 'coder@sonnet2', worktreeName: 'coder2', worktreePath: path.join(root, 'wt-coder2') },
    { role: 'cleaner', worktreeName: 'cleaner', worktreePath: path.join(root, 'wt-cleaner') },
  ];
  return { root, roles, nowMs: Date.parse('2026-07-09T12:00:00Z') };
}

test('BL-1319: the two seats of one stage report as a single stage row carrying both seats parcels', () => {
  const { roles, nowMs } = seatFixture();
  const result = computeStageDwellReportForRoles(roles, nowMs, 24);
  const coder = result.stages.filter((s) => s.role === 'coder');
  assert.equal(coder.length, 1, 'exactly one coder row');
  assert.equal(coder[0].parcelsProcessed, 4, "the seat's parcels must not be dropped");
});

test('BL-1319: no stage name emitted by the dwell instrument contains a seat id', () => {
  const { roles, nowMs } = seatFixture();
  const result = computeStageDwellReportForRoles(roles, nowMs, 24);
  for (const s of result.stages) {
    assert.ok(!s.role.includes('@'), `stage row leaked a seat id: ${s.role}`);
  }
  assert.ok(!JSON.stringify(result).includes('@'), 'the served payload must carry no seat id');
});

// The wrong-ANSWER consequence, not the wrong-label one. Before the fold the
// second seat's slow parcels were dropped, so the coder stage reported only
// its bare seat's fast work and cleaner was named the bottleneck. Whole, the
// coder stage is slower and is named. The feature file's scenario 03 was
// AMENDED 2026-09-02 (35d7e4076d) after this gap was raised: its original
// "neither seat alone slower than X" clause was unsatisfiable under median
// ranking, since a median over the union of two sets each with median <= X
// is itself <= X. The amended scenario asserts the satisfiable form this
// test already encoded - fast bare seat, slow dropped seat, and only reading
// both moves the stage to the top.
test('BL-1319: a stage understated by dropping a seat is no longer ranked below a faster one', () => {
  const { roles, nowMs } = seatFixture();
  const result = computeStageDwellReportForRoles(roles, nowMs, 24);
  assert.equal(result.bottleneck.role, 'coder');
  const bareOnly = roles.filter((r) => r.role !== 'coder@sonnet2');
  assert.equal(
    computeStageDwellReportForRoles(bareOnly, nowMs, 24).bottleneck.role,
    'cleaner',
    'without the second seat cleaner genuinely is the bottleneck - the fixture is honest'
  );
});

test('BL-1319: nameBottleneck folds a seat-keyed row rather than naming a seat', () => {
  const stats = (ms) => ({ medianMs: ms, p90Ms: ms, maxMs: ms, outliersMs: [] });
  const empty = { medianMs: null, p90Ms: null, maxMs: null, outliersMs: [] };
  const rows = [
    { role: 'coder@sonnet2', parcelsProcessed: 1, queueWait: empty, processing: stats(60000), trend: null },
    { role: 'cleaner', parcelsProcessed: 1, queueWait: empty, processing: stats(1000), trend: null },
  ];
  assert.equal(nameBottleneck(rows).role, 'coder');
});

test('BL-1319: per-seat attribution survives the fold in the underlying dwell records', () => {
  const { roles } = seatFixture();
  const seat = roles.find((r) => r.role === 'coder@sonnet2');
  const { records } = readRoleStageDwellRecords(seat, 0, Date.parse('2026-07-10T00:00:00Z'));
  assert.equal(records.length, 2);
  for (const r of records) {
    assert.equal(r.role, 'coder@sonnet2', 'records keep the seat that worked the parcel');
  }
});

test('BL-1319: the fold is lossless for a single-seat swarm - identical output for the same parcels', () => {
  const { roles, nowMs } = seatFixture();
  const bareOnly = roles.filter((r) => r.role !== 'coder@sonnet2');
  const before = computeStageDwellReportForRoles(bareOnly, nowMs, 24);
  const again = computeStageDwellReportForRoles(bareOnly, nowMs, 24);
  assert.deepEqual(before, again);
  assert.deepEqual(before.stages.map((s) => s.role), ['coder', 'cleaner']);
  assert.equal(before.stages.find((s) => s.role === 'coder').parcelsProcessed, 2);
});

// ── BL-1319: the ops seat-and-model view (human_ruling: "Fold plus ops
//    seat-detail - build the seat-and-model view in this same slice") ─────
// The fold makes the OPTIMIZER answer correct; it also makes per-seat work
// invisible on every surface. This is the sanctioned seat-level view, and it
// reads the per-seat attribution the fold deliberately preserved. It is an
// OPS surface only: the bridge's /stage-dwell payload stays seat-free, which
// is what the ticket's qa_e2e requires of it.

test('BL-1319 ops view: one row per seat, naming the seat, its stage and its model', () => {
  const { roles, nowMs } = seatFixture();
  const withAgents = roles.map((r) => ({ ...r, agent: r.role === 'coder@sonnet2' ? 'aider' : 'claude' }));
  const seats = computeSeatDwellDetail(withAgents, nowMs, 24);
  assert.deepEqual(
    seats.map((s) => `${s.stage}/${s.seat}/${s.agent}/${s.parcelsProcessed}`),
    ['coder/coder/claude/2', 'coder/coder@sonnet2/aider/2', 'cleaner/cleaner/claude/1']
  );
});

test('BL-1319 ops view: a seat row keeps its own dwell, never the folded stage total', () => {
  const { roles, nowMs } = seatFixture();
  const seats = computeSeatDwellDetail(roles, nowMs, 24);
  const bare = seats.find((s) => s.seat === 'coder');
  const second = seats.find((s) => s.seat === 'coder@sonnet2');
  assert.equal(bare.processing.medianMs, 60000, 'the bare seat is fast on its own');
  assert.equal(second.processing.medianMs, 1800000, 'the second seat is slow on its own');
});

test('BL-1319 ops view: an unconfigured model reports as unknown rather than crashing or inventing one', () => {
  const { roles, nowMs } = seatFixture();
  const seats = computeSeatDwellDetail(roles, nowMs, 24);
  assert.ok(seats.every((s) => typeof s.agent === 'string' && s.agent.length > 0));
  assert.equal(seats.find((s) => s.seat === 'coder').agent, 'unknown');
});

test('BL-1319 ops view: a single-seat swarm still gets one row per stage, so the view is not multi-seat-only', () => {
  const { roles, nowMs } = seatFixture();
  const bareOnly = roles.filter((r) => r.role !== 'coder@sonnet2');
  const seats = computeSeatDwellDetail(bareOnly, nowMs, 24);
  assert.deepEqual(seats.map((s) => s.seat), ['coder', 'cleaner']);
});
