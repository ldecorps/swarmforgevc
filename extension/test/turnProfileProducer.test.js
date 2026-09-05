const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  assessTranscriptReadability,
  buildTurnProfileWindowForGroups,
  buildTurnProfileWindowRecord,
  filterNewTurnProfileWindows,
  readPersistedTurnProfileWindows,
  runTurnProfileProducer,
  windowDedupeKey,
} = require('../out/metrics/turnProfileProducer');
const { INTERVAL_CATEGORIES, coverageFromIntervals } = require('../out/metrics/transcriptWalker');
const { projectSlug } = require('../out/metrics/transcriptUsage');

const BASE_MS = 1_700_000_000_000;

// A transcript line the walker classifies into a known category, so a test can
// say "this stage's turns were entirely test-run" without restating the
// classifier's own rules.
function toolLine(atMs, toolName, input) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(atMs).toISOString(),
    message: { content: [{ type: 'tool_use', name: toolName, input }] },
  });
}

function gitLine(atMs) {
  return toolLine(atMs, 'Shell', { command: 'git merge --ff-only origin/main' });
}

function testRunLine(atMs) {
  return toolLine(atMs, 'Shell', { command: 'npm run test' });
}

function writingLine(atMs) {
  return toolLine(atMs, 'Write', { file_path: '/tmp/notes.md', content: 'prose' });
}

function writeTranscript(dir, name, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

function trailFor(stage, startMs, endMs) {
  return { ticketId: 'BL-1364-FIXTURE', stage, startMs, endMs };
}

test('assessTranscriptReadability tolerates a torn final line but not interior damage', () => {
  const root = mkTmpDir('sfvc-bl1364-read-');
  const good = writeTranscript(root, 'good.jsonl', [gitLine(BASE_MS)]);
  // Torn FINAL line: a transcript its agent is still appending to. Every
  // record before it is whole, so the file is readable and the torn line is
  // simply not yet part of the window.
  const tail = path.join(root, 'tail.jsonl');
  fs.writeFileSync(tail, `${gitLine(BASE_MS)}\n{"type":"assis`, 'utf8');
  // Interior damage: a bad line with a COMPLETE line after it. Nothing about
  // an in-progress append produces this shape.
  const interior = path.join(root, 'interior.jsonl');
  fs.writeFileSync(interior, `not json\n${gitLine(BASE_MS + 1_000)}\n`, 'utf8');
  const missing = path.join(root, 'gone.jsonl');

  const result = assessTranscriptReadability([good, tail, interior, missing]);

  assert.deepEqual(result.readable.sort(), [good, tail].sort());
  assert.deepEqual(result.truncatedTail, [tail]);
  assert.deepEqual(result.unreadable.sort(), [interior, missing].sort());
});

test('a worked stage reports a mechanical share reflecting both kinds of interval', () => {
  const root = mkTmpDir('sfvc-bl1364-worked-');
  const file = writeTranscript(root, 'coder.jsonl', [
    gitLine(BASE_MS + 1_000),
    writingLine(BASE_MS + 3_000),
  ]);

  const record = buildTurnProfileWindowRecord({
    transcriptPaths: [file],
    handoffTrail: [trailFor('coder', BASE_MS, BASE_MS + 10_000)],
  });

  assert.equal(record.complete, true);
  const coder = record.stages.find((entry) => entry.stage === 'coder');
  assert.ok(coder, `expected a coder stage, got ${JSON.stringify(record.stages)}`);
  // Both kinds are represented: a mechanical share strictly between 0 and 1 is
  // only possible if the thinking interval landed in the same denominator.
  assert.ok(coder.mechanical_share > 0, 'mechanical work was not counted');
  assert.ok(coder.mechanical_share < 1, 'the thinking interval did not dilute the share');
  assert.ok(coder.category_shares['thinking-writing'] > 0, 'the thinking interval is missing');
});

test('a stage with no classified turns is absent from the series, never zero', () => {
  const root = mkTmpDir('sfvc-bl1364-absent-');
  const file = writeTranscript(root, 'coder.jsonl', [gitLine(BASE_MS + 1_000)]);

  const record = buildTurnProfileWindowRecord({
    transcriptPaths: [file],
    // 'documenter' is declared in the trail but owns no interval in the window.
    handoffTrail: [
      trailFor('coder', BASE_MS, BASE_MS + 10_000),
      trailFor('documenter', BASE_MS + 500_000, BASE_MS + 510_000),
    ],
  });

  const stageNames = record.stages.map((entry) => entry.stage);
  assert.ok(stageNames.includes('coder'), 'the worked stage should be present');
  assert.ok(
    !stageNames.includes('documenter'),
    `a stage nobody worked must be absent, not zero: ${JSON.stringify(record.stages)}`
  );
});

test('an unreadable transcript makes the window incomplete and yields no shares', () => {
  const root = mkTmpDir('sfvc-bl1364-incomplete-');
  const good = writeTranscript(root, 'coder.jsonl', [gitLine(BASE_MS + 1_000)]);
  const damaged = path.join(root, 'qa.jsonl');
  fs.writeFileSync(damaged, `garbage\n${gitLine(BASE_MS + 2_000)}\n`, 'utf8');

  const record = buildTurnProfileWindowRecord({
    transcriptPaths: [good, damaged],
    handoffTrail: [trailFor('coder', BASE_MS, BASE_MS + 10_000)],
  });

  assert.equal(record.complete, false);
  assert.deepEqual(record.stages, [], 'no stage may report a share from a damaged window');
  assert.deepEqual(record.unreadable_transcripts, [damaged]);
});

test('a transcript still being appended to does not sink the whole window', () => {
  const root = mkTmpDir('sfvc-bl1364-tail-');
  const good = writeTranscript(root, 'coder.jsonl', [gitLine(BASE_MS + 1_000)]);
  const live = path.join(root, 'qa-live.jsonl');
  fs.writeFileSync(live, `${testRunLine(BASE_MS + 2_000)}\n{"type":"assis`, 'utf8');

  const record = buildTurnProfileWindowRecord({
    transcriptPaths: [good, live],
    handoffTrail: [trailFor('coder', BASE_MS, BASE_MS + 10_000)],
  });

  assert.equal(record.complete, true, 'a torn final line is a sampling artifact, not damage');
  assert.deepEqual(record.truncated_tail_transcripts, [live], 'the condition must still be recorded');
  assert.ok(record.stages.length > 0, 'the whole window was refused over one in-progress append');
});

test('every walker category survives into the stored record', () => {
  const root = mkTmpDir('sfvc-bl1364-categories-');
  const file = writeTranscript(root, 'coder.jsonl', [gitLine(BASE_MS + 1_000)]);

  const record = buildTurnProfileWindowRecord({
    transcriptPaths: [file],
    handoffTrail: [trailFor('coder', BASE_MS, BASE_MS + 10_000)],
  });

  const coder = record.stages.find((entry) => entry.stage === 'coder');
  assert.deepEqual(
    Object.keys(coder.category_shares).sort(),
    [...INTERVAL_CATEGORIES].sort(),
    'the stored category set must be exactly the walker\'s own'
  );
});

test('a stage whose turns are entirely one category reports its whole share there', () => {
  const root = mkTmpDir('sfvc-bl1364-whole-');
  const file = writeTranscript(root, 'hardender.jsonl', [
    testRunLine(BASE_MS + 1_000),
    testRunLine(BASE_MS + 2_000),
  ]);

  const record = buildTurnProfileWindowRecord({
    transcriptPaths: [file],
    handoffTrail: [trailFor('hardender', BASE_MS + 900, BASE_MS + 10_000)],
  });

  const stage = record.stages.find((entry) => entry.stage === 'hardender');
  assert.ok(stage, `expected a hardender stage, got ${JSON.stringify(record.stages)}`);
  assert.equal(stage.category_shares['test-run'], 1);
});

test('windowDedupeKey keys a day, so a widening window is the same row', () => {
  const a = { window_day: '2026-09-05', complete: true };
  assert.equal(windowDedupeKey(a), windowDedupeKey({ ...a }));
  assert.notEqual(windowDedupeKey(a), windowDedupeKey({ ...a, complete: false }));
  assert.notEqual(windowDedupeKey(a), windowDedupeKey({ ...a, window_day: '2026-09-06' }));
});

test('filterNewTurnProfileWindows drops a window already persisted', () => {
  const record = {
    window_day: '2026-09-05',
    window_start: 'A',
    window_end: 'B',
    complete: true,
    unreadable_transcripts: [],
    truncated_tail_transcripts: [],
    stages: [],
  };
  assert.deepEqual(filterNewTurnProfileWindows([], [record]), [record]);
  assert.deepEqual(filterNewTurnProfileWindows([record], [record]), []);
});

test('the producer attributes each stage from its own worktree and upserts one row per day', () => {
  const repoRoot = mkTmpDir('sfvc-bl1364-producer-');
  const claudeProjectsDir = mkTmpDir('sfvc-bl1364-projects-');
  const coderPath = path.join(repoRoot, '.worktrees', 'coder');
  const qaPath = path.join(repoRoot, '.worktrees', 'QA');
  fs.mkdirSync(coderPath, { recursive: true });
  fs.mkdirSync(qaPath, { recursive: true });
  writeTranscript(path.join(claudeProjectsDir, projectSlug(coderPath)), 'session.jsonl', [
    gitLine(BASE_MS + 1_000),
    writingLine(BASE_MS + 3_000),
  ]);
  writeTranscript(path.join(claudeProjectsDir, projectSlug(qaPath)), 'session.jsonl', [
    testRunLine(BASE_MS + 5_000),
  ]);
  const roleWorktrees = [
    { role: 'coder', worktreePath: coderPath },
    { role: 'QA', worktreePath: qaPath },
  ];
  const telemetryDir = path.join(repoRoot, '.swarmforge', 'telemetry');

  const first = runTurnProfileProducer({ repoRoot, roleWorktrees, claudeProjectsDir });
  assert.equal(first.complete, true);
  assert.equal(first.recorded, 1, 'the first run must record the window');
  // The stage comes from the worktree the transcript lives in - the whole
  // reason the first live run of this producer reported a single 'unknown'.
  assert.deepEqual([...first.stages].sort(), ['QA', 'coder']);

  const persisted = readPersistedTurnProfileWindows(telemetryDir);
  assert.equal(persisted.length, 1);
  const qa = persisted[0].stages.find((entry) => entry.stage === 'QA');
  assert.equal(qa.category_shares['test-run'], 1, 'QA\'s transcript was entirely a test run');

  const second = runTurnProfileProducer({ repoRoot, roleWorktrees, claudeProjectsDir });
  assert.equal(second.recorded, 0, 'a second run on the same day is an update, not a new row');
  assert.equal(second.updated, 1);
  assert.equal(
    readPersistedTurnProfileWindows(telemetryDir).length,
    1,
    'the store must not have grown on the rerun'
  );
});

// BL-1364: the walk this producer performs is the first to cover every role's
// transcripts in one pass. coverageFromIntervals folded its window with
// Math.min(...intervals.map(...)), which passes one ARGUMENT per interval and
// throws RangeError once the walk is big enough. Every earlier caller walked a
// single worktree group and stayed under the limit, so the ceiling was latent
// until this consumer existed. Asserted on the fold directly - building a
// quarter of a million intervals out of real files would be a slow test of the
// same one line.
test('the coverage window folds without a per-interval argument spread', () => {
  const intervals = [];
  for (let i = 0; i < 300_000; i += 1) {
    intervals.push({ category: 'test-run', startMs: 1_000 + i, endMs: 2_000 + i });
  }
  const window = coverageFromIntervals(intervals);
  assert.deepEqual(window, { startMs: 1_000, endMs: 301_999 });
});

test('the coverage window of an empty walk is null, not a zero-width window', () => {
  assert.equal(coverageFromIntervals([]), null);
});

test('one damaged transcript in ANY group refuses the whole multi-stage window', () => {
  const root = mkTmpDir('sfvc-bl1364-groupfail-');
  const coder = writeTranscript(root, 'coder.jsonl', [gitLine(BASE_MS + 1_000)]);
  const damaged = path.join(root, 'qa.jsonl');
  fs.writeFileSync(damaged, `garbage\n${testRunLine(BASE_MS + 2_000)}\n`, 'utf8');

  const record = buildTurnProfileWindowForGroups([
    { stage: 'coder', transcriptPaths: [coder] },
    { stage: 'QA', transcriptPaths: [damaged] },
  ]);

  // A per-stage share is only comparable when every stage was measured over
  // the same window, so a healthy group must not report while a sibling is
  // unmeasurable.
  assert.equal(record.complete, false);
  assert.deepEqual(record.stages, []);
  assert.deepEqual(record.unreadable_transcripts, [damaged]);
});

test('groups attribute each stage from its own worktree, not from a handoff trail', () => {
  const root = mkTmpDir('sfvc-bl1364-groupstage-');
  const coder = writeTranscript(root, 'coder.jsonl', [gitLine(BASE_MS + 1_000)]);
  const qa = writeTranscript(root, 'qa.jsonl', [testRunLine(BASE_MS + 2_000)]);

  const record = buildTurnProfileWindowForGroups([
    { stage: 'coder', transcriptPaths: [coder] },
    { stage: 'QA', transcriptPaths: [qa] },
  ]);

  assert.deepEqual(record.stages.map((entry) => entry.stage).sort(), ['QA', 'coder']);
  assert.equal(record.stages.find((e) => e.stage === 'QA').category_shares['test-run'], 1);
  assert.equal(record.stages.find((e) => e.stage === 'coder').category_shares['git-mechanical'], 1);
});

test('a role with no transcripts at all is absent from the multi-stage window', () => {
  const root = mkTmpDir('sfvc-bl1364-emptygroup-');
  const coder = writeTranscript(root, 'coder.jsonl', [gitLine(BASE_MS + 1_000)]);

  const record = buildTurnProfileWindowForGroups([
    { stage: 'coder', transcriptPaths: [coder] },
    // The live shape of a role that has not worked in the window: its
    // worktree exists, it simply has no transcripts. It must not appear at
    // zero, which would read as "this role did no mechanical work".
    { stage: 'documenter', transcriptPaths: [] },
  ]);

  assert.equal(record.complete, true);
  assert.deepEqual(record.stages.map((entry) => entry.stage), ['coder']);
});
