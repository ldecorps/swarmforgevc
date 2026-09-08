const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  computeTranscriptSummary,
  readTranscriptSummaryStore,
  statOrNull,
  summaryIsCurrent,
  turnProfileSummaryStorePath,
  writeTranscriptSummaryStore,
} = require('../out/metrics/transcriptSummaryStore');

// BL-1476 hardening: readTranscriptSummaryStore's `parsed && typeof parsed
// === 'object'` guard is real - a store file whose top-level JSON value is
// valid but not a map (a bare number, string, boolean, or null) must never
// be handed back as-is (a caller indexing it by path would then read
// properties off a primitive/null instead of undefined-for-missing).
for (const [label, json] of [
  ['a bare number', '42'],
  ['a bare string', '"oops"'],
  ['a bare boolean', 'true'],
  ['JSON null', 'null'],
]) {
  test(`readTranscriptSummaryStore treats ${label} at the top level as no store, not the raw value`, () => {
    const telemetryDir = mkTmpDir('sfvc-transcript-summary-store-');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(turnProfileSummaryStorePath(telemetryDir), json, 'utf8');
    assert.deepEqual(readTranscriptSummaryStore(telemetryDir), {});
  });
}

test('readTranscriptSummaryStore returns a genuine object store unchanged', () => {
  const telemetryDir = mkTmpDir('sfvc-transcript-summary-store-');
  fs.mkdirSync(telemetryDir, { recursive: true });
  const store = { '/a/b.jsonl': { size: 3, mtimeMs: 5, unreadable: false, truncatedTail: false, intervals: [] } };
  fs.writeFileSync(turnProfileSummaryStorePath(telemetryDir), JSON.stringify(store), 'utf8');
  assert.deepEqual(readTranscriptSummaryStore(telemetryDir), store);
});

test('writeTranscriptSummaryStore then readTranscriptSummaryStore round-trips the exact store, including unicode content', () => {
  const telemetryDir = mkTmpDir('sfvc-transcript-summary-store-');
  const store = {
    '/a/héllo.jsonl': { size: 7, mtimeMs: 12.5, unreadable: false, truncatedTail: true, intervals: [] },
  };
  writeTranscriptSummaryStore(telemetryDir, store);
  assert.deepEqual(readTranscriptSummaryStore(telemetryDir), store);
});

test('statOrNull returns null for a path that does not exist, never throws', () => {
  const telemetryDir = mkTmpDir('sfvc-transcript-summary-store-');
  assert.equal(statOrNull(path.join(telemetryDir, 'nope.jsonl')), null);
});

test('statOrNull returns the real size and mtimeMs for an existing file', () => {
  const telemetryDir = mkTmpDir('sfvc-transcript-summary-store-');
  const filePath = path.join(telemetryDir, 'f.jsonl');
  fs.writeFileSync(filePath, 'hello');
  const stat = statOrNull(filePath);
  assert.equal(stat.size, 5);
  assert.equal(typeof stat.mtimeMs, 'number');
});

// BL-1476 hardening: summaryIsCurrent must check BOTH size AND mtimeMs -
// a mutant collapsing the mtimeMs comparison to `true` survives any test
// that only varies size, so this pins the mtimeMs-alone divergence.
test('summaryIsCurrent is false when size matches but mtimeMs differs', () => {
  const summary = { size: 10, mtimeMs: 1000, unreadable: false, truncatedTail: false, intervals: [] };
  assert.equal(summaryIsCurrent(summary, { size: 10, mtimeMs: 2000 }), false);
});

test('summaryIsCurrent is false when mtimeMs matches but size differs', () => {
  const summary = { size: 10, mtimeMs: 1000, unreadable: false, truncatedTail: false, intervals: [] };
  assert.equal(summaryIsCurrent(summary, { size: 20, mtimeMs: 1000 }), false);
});

test('summaryIsCurrent is true only when both size and mtimeMs match', () => {
  const summary = { size: 10, mtimeMs: 1000, unreadable: false, truncatedTail: false, intervals: [] };
  assert.equal(summaryIsCurrent(summary, { size: 10, mtimeMs: 1000 }), true);
});

test('summaryIsCurrent is false for an undefined summary (no prior entry)', () => {
  assert.equal(summaryIsCurrent(undefined, { size: 10, mtimeMs: 1000 }), false);
});

// BL-1476 hardening: computeTranscriptSummary's readFn-throws branch had no
// test at all (3 NoCoverage mutants) - a file that stats fine but cannot
// actually be read (permission race, deleted between stat and read) must
// summarise as unreadable with no intervals, never throw.
test('computeTranscriptSummary summarises as unreadable with no intervals when readFn throws', () => {
  const stat = { size: 123, mtimeMs: 456 };
  const readFn = () => {
    throw new Error('EACCES');
  };
  const summary = computeTranscriptSummary('/some/path.jsonl', stat, readFn);
  assert.deepEqual(summary, { size: 123, mtimeMs: 456, unreadable: true, truncatedTail: false, intervals: [] });
});

// BL-1476 hardening: an unreadable (bad-content) transcript's summary must
// carry an EMPTY intervals array - a mutant that instead walks (or
// fabricates) intervals for unreadable content survives unless this is
// checked directly (the producer-level test only checks that a cached
// unreadable file is not re-read, never what its cached intervals are).
test('computeTranscriptSummary records empty intervals for content that classifies as unreadable', () => {
  const stat = { size: 30, mtimeMs: 1 };
  const badText = 'not json\nnot json either\n';
  const summary = computeTranscriptSummary('/some/bad.jsonl', stat, () => badText);
  assert.equal(summary.unreadable, true);
  assert.deepEqual(summary.intervals, []);
});

test('computeTranscriptSummary records real intervals for readable content', () => {
  const stat = { size: 30, mtimeMs: 1 };
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: new Date(1_700_000_000_000).toISOString(),
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }] },
  });
  const summary = computeTranscriptSummary('/some/good.jsonl', stat, () => line);
  assert.equal(summary.unreadable, false);
  assert.ok(summary.intervals.length > 0, 'expected at least one classified interval');
});
