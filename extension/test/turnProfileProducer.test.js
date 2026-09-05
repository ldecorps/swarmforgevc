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
  turnProfileStorePath,
  TURN_PROFILE_STORE_FILE,
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

// BL-1364: a blank/whitespace-only line (a trailing newline, an accidental
// blank between records) must not be mistaken for a bad line - filtering on
// `line.trim()` rather than the bare truthy `line` is what excludes it before
// JSON.parse ever sees it.
test('assessTranscriptReadability ignores blank lines rather than treating them as damage', () => {
  const root = mkTmpDir('sfvc-bl1364-blank-');
  const file = path.join(root, 'blank.jsonl');
  fs.writeFileSync(file, `${gitLine(BASE_MS)}\n   \n${gitLine(BASE_MS + 1_000)}\n\n`, 'utf8');

  const result = assessTranscriptReadability([file]);

  assert.deepEqual(result.readable, [file]);
  assert.deepEqual(result.unreadable, []);
  assert.deepEqual(result.truncatedTail, []);
});

// BL-1364: two DISTINCT bad lines where the LAST one happens to sit at the
// final position must still be interior damage, not a tolerated torn tail -
// the tolerance is for EXACTLY one bad line at the end, not "the last bad
// line found is at the end regardless of how many came before it".
test('assessTranscriptReadability refuses a transcript with interior damage even when the last bad line is also final', () => {
  const root = mkTmpDir('sfvc-bl1364-multibad-');
  const file = path.join(root, 'multibad.jsonl');
  fs.writeFileSync(file, `not json\n${gitLine(BASE_MS)}\nalso not json`, 'utf8');

  const result = assessTranscriptReadability([file]);

  assert.deepEqual(result.unreadable, [file], 'an interior bad line must refuse the file even with a torn tail too');
  assert.deepEqual(result.readable, []);
  assert.deepEqual(result.truncatedTail, []);
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
  assert.deepEqual(record.unreadable_transcripts, [], 'a complete window must report no unreadable transcripts');
  // window_day is a DATE (10 chars, YYYY-MM-DD), not the full window_end
  // timestamp - the store's whole idempotency key depends on this being a
  // day, not a moment (windowDedupeKey below).
  assert.equal(record.window_day, record.window_end.slice(0, 10));
  assert.equal(record.window_day.length, 10);
  const coder = record.stages.find((entry) => entry.stage === 'coder');
  assert.ok(coder, `expected a coder stage, got ${JSON.stringify(record.stages)}`);
  // Both kinds are represented: a mechanical share strictly between 0 and 1 is
  // only possible if the thinking interval landed in the same denominator.
  assert.ok(coder.mechanical_share > 0, 'mechanical work was not counted');
  assert.ok(coder.mechanical_share < 1, 'the thinking interval did not dilute the share');
  assert.ok(coder.category_shares['thinking-writing'] > 0, 'the thinking interval is missing');
});

// BL-1364: every OTHER call in this file passes a handoffTrail, so the `??
// []` fallback for an omitted one was never once exercised - buildTurnProfileWindowRecord's
// handoffTrail parameter is documented optional (TypeScript `?`).
test('buildTurnProfileWindowRecord tolerates an omitted handoffTrail, attributing to unknown', () => {
  const root = mkTmpDir('sfvc-bl1364-notrail-');
  const file = writeTranscript(root, 'coder.jsonl', [gitLine(BASE_MS + 1_000)]);

  const record = buildTurnProfileWindowRecord({ transcriptPaths: [file] });

  assert.equal(record.complete, true);
  assert.deepEqual(record.stages.map((entry) => entry.stage), ['unknown']);
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

// BL-1364/BL-897: comparing the record's category set only against
// `[...INTERVAL_CATEGORIES].sort()` is vacuous against a mutant that corrupts
// INTERVAL_CATEGORIES itself - the record's own category_shares are seeded
// FROM that same export (turnProfile.ts's `for (const category of
// INTERVAL_CATEGORIES)`), so an emptied export makes both sides of the
// comparison collapse to `[]` together. Pin the six real names literally so a
// corrupted export is caught independently of what it also seeded downstream.
const KNOWN_INTERVAL_CATEGORIES = [
  'git-mechanical',
  'test-run',
  'file-read',
  'thinking-writing',
  'turn-overhead',
  'provider-outage',
].sort();

test('INTERVAL_CATEGORIES is exactly the six known walker categories', () => {
  assert.deepEqual([...INTERVAL_CATEGORIES].sort(), KNOWN_INTERVAL_CATEGORIES);
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
    KNOWN_INTERVAL_CATEGORIES,
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

// BL-1364: TURN_PROFILE_STORE_FILE and turnProfileStorePath are exported but
// nothing before this test checked the actual on-disk name they produce -
// every other test reaches the store only through readPersistedTurnProfileWindows,
// which derives its own path from the same constant, so a corrupted constant
// would never surface as a read/write mismatch. Pin the real path a sibling
// consumer (the briefing, the ceremony packet) would need to hardcode.
test('the store path is exactly telemetryDir/turn-profile-series.jsonl', () => {
  assert.equal(TURN_PROFILE_STORE_FILE, 'turn-profile-series.jsonl');
  assert.equal(turnProfileStorePath('/some/telemetry/dir'), path.join('/some/telemetry/dir', 'turn-profile-series.jsonl'));
});

test('upsertWindowRecord actually writes to the literal turn-profile-series.jsonl file', () => {
  const repoRoot = mkTmpDir('sfvc-bl1364-storefile-');
  const claudeProjectsDir = mkTmpDir('sfvc-bl1364-storefile-projects-');
  const coderPath = path.join(repoRoot, '.worktrees', 'coder');
  fs.mkdirSync(coderPath, { recursive: true });
  writeTranscript(path.join(claudeProjectsDir, projectSlug(coderPath)), 'session.jsonl', [gitLine(BASE_MS + 1_000)]);

  runTurnProfileProducer({ repoRoot, roleWorktrees: [{ role: 'coder', worktreePath: coderPath }], claudeProjectsDir });

  const literalPath = path.join(repoRoot, '.swarmforge', 'telemetry', 'turn-profile-series.jsonl');
  assert.ok(fs.existsSync(literalPath), `expected a file at the literal path ${literalPath}`);
});

// BL-1364: readPersistedTurnProfileWindows filters on `line.trim()` before
// JSON.parse - a bare truthy `line` filter would let a whitespace-only line
// (a stray blank between rows, or one produced by hand-editing the store)
// reach JSON.parse and throw instead of being skipped.
test('readPersistedTurnProfileWindows tolerates blank lines in the store file', () => {
  const telemetryDir = mkTmpDir('sfvc-bl1364-blankstore-');
  fs.mkdirSync(telemetryDir, { recursive: true });
  const record = { window_day: '2026-09-05', complete: true, stages: [] };
  fs.writeFileSync(turnProfileStorePath(telemetryDir), `${JSON.stringify(record)}\n   \n\n`, 'utf8');

  assert.deepEqual(readPersistedTurnProfileWindows(telemetryDir), [record]);
});

test('windowDedupeKey keys a day, so a widening window is the same row', () => {
  const a = { window_day: '2026-09-05', complete: true };
  assert.equal(windowDedupeKey(a), windowDedupeKey({ ...a }));
  assert.notEqual(windowDedupeKey(a), windowDedupeKey({ ...a, complete: false }));
  assert.notEqual(windowDedupeKey(a), windowDedupeKey({ ...a, window_day: '2026-09-06' }));
});

// BL-1364: TurnProfileWindowRecord.window_day is `string | null` - an
// incomplete window has none (assembleWindowRecord's early-return sets it to
// null). No test above exercises that null; windowDedupeKey's own `?? 'none'`
// fallback was consequently never reached.
test('windowDedupeKey falls back to a stable key for an incomplete window\'s null day', () => {
  const incomplete = { window_day: null, complete: false };
  assert.equal(windowDedupeKey(incomplete), windowDedupeKey({ ...incomplete }));
  assert.notEqual(windowDedupeKey(incomplete), windowDedupeKey({ window_day: '2026-09-05', complete: false }));
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

// BL-1364: the prior test only ever has ONE persisted day, so an upsert that
// (by mutant) drops EVERY existing row before appending the new one still
// leaves the store at length 1 and passes undetected. This fixture seeds a
// SECOND, unrelated day directly (upsertWindowRecord itself is not exported -
// this is the one path that reaches it) so the assertion can tell "replaced
// the matching day" apart from "wiped the whole store".
test('upserting one day leaves an unrelated day untouched, both readable back with join separators intact', () => {
  const repoRoot = mkTmpDir('sfvc-bl1364-otherday-');
  const claudeProjectsDir = mkTmpDir('sfvc-bl1364-otherday-projects-');
  const coderPath = path.join(repoRoot, '.worktrees', 'coder');
  fs.mkdirSync(coderPath, { recursive: true });
  writeTranscript(path.join(claudeProjectsDir, projectSlug(coderPath)), 'session.jsonl', [
    gitLine(BASE_MS + 1_000),
  ]);
  const roleWorktrees = [{ role: 'coder', worktreePath: coderPath }];

  runTurnProfileProducer({ repoRoot, roleWorktrees, claudeProjectsDir });
  const telemetryDir = path.join(repoRoot, '.swarmforge', 'telemetry');
  const todayKey = readPersistedTurnProfileWindows(telemetryDir)[0].window_day;
  assert.ok(todayKey, 'the first run must have produced a window_day to seed against');

  const otherDayRecord = {
    window_day: '1999-01-01',
    window_start: '1999-01-01T00:00:00.000Z',
    window_end: '1999-01-01T00:00:01.000Z',
    complete: true,
    unreadable_transcripts: [],
    truncated_tail_transcripts: [],
    stages: [],
  };
  // Written directly (upsertWindowRecord is private) - append behind the
  // producer's own real first row, exactly the join('\n') shape it writes.
  fs.appendFileSync(turnProfileStorePath(telemetryDir), `${JSON.stringify(otherDayRecord)}\n`, 'utf8');
  assert.equal(readPersistedTurnProfileWindows(telemetryDir).length, 2, 'seed must have landed as its own row');

  runTurnProfileProducer({ repoRoot, roleWorktrees, claudeProjectsDir });

  const persisted = readPersistedTurnProfileWindows(telemetryDir);
  assert.equal(persisted.length, 2, 'the unrelated day must not have been dropped by the upsert');
  const other = persisted.find((row) => row.window_day === '1999-01-01');
  assert.ok(other, 'the seeded 1999-01-01 row must still be readable back, unmangled');
  assert.deepEqual(other, otherDayRecord);
  const today = persisted.find((row) => row.window_day === todayKey);
  assert.ok(today, 'the real day must also still be present');
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

// BL-1364: the 300_000-interval fold test above is monotonically increasing
// by construction (startMs/endMs both rise with i), so the true min/max are
// always the first/last element - the hand-rolled fold's per-row `<`/`>`
// comparison is only ever evaluated in the direction that already matches the
// running value, and is never actually EXERCISED for a later row that must
// overrule an earlier one. This fixture is deliberately out of order: the
// true minimum startMs sits in the MIDDLE interval, not the first, and the
// true maximum endMs is followed by a LATER, smaller endMs that must NOT
// shrink the running max.
test('the coverage window folds the true min/max out of an unordered walk, not just first/last', () => {
  const intervals = [
    { category: 'test-run', startMs: 500, endMs: 600 },
    { category: 'test-run', startMs: 100, endMs: 2_000 },
    { category: 'test-run', startMs: 300, endMs: 150 },
  ];
  assert.deepEqual(coverageFromIntervals(intervals), { startMs: 100, endMs: 2_000 });
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
  assert.deepEqual(record.truncated_tail_transcripts, [], 'a fully clean multi-group window must report no tails');
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
