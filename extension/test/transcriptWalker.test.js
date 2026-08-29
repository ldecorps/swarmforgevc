const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  profileIntervalKind,
  walkTranscriptFiles,
  transcriptsUnchanged,
  snapshotTranscriptFiles,
} = require('../out/metrics/transcriptWalker');
const { buildTurnProfileSeries } = require('../out/metrics/turnProfile');

// BL-664: deterministic transcript walker taxonomy and read-only walk.

test('profileIntervalKind maps fixture taxonomy to categories', () => {
  assert.equal(profileIntervalKind('a trivial git fast-forward'), 'git-mechanical');
  assert.equal(profileIntervalKind('boot before first action'), 'turn-overhead');
  assert.equal(profileIntervalKind('a provider retry storm'), 'provider-outage');
});

test('walkTranscriptFiles classifies Shell git and Read tools without modifying files', () => {
  const root = mkTmpDir('transcript-walker-');
  const file = path.join(root, 'session.jsonl');
  const at = 1_700_000_001_000;
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      type: 'assistant',
      timestamp: new Date(at).toISOString(),
      message: {
        content: [{ type: 'tool_use', name: 'Shell', input: { command: 'git fetch origin' } }],
      },
    })}\n`,
    'utf8'
  );
  const before = snapshotTranscriptFiles([file]);
  const trail = [
    { ticketId: 'BL-664', stage: 'coder', startMs: at - 1000, endMs: at + 5000 },
  ];
  const result = walkTranscriptFiles([file], trail);
  assert.ok(transcriptsUnchanged(before, [file]));
  assert.equal(result.intervals.some((row) => row.category === 'git-mechanical'), true);
  assert.equal(result.intervals.some((row) => row.stage === 'coder'), true);
  assert.equal(result.intervals.some((row) => row.ticketId === 'BL-664'), true);
  assert.equal(result.extrapolated, false);
  assert.ok(result.coverageWindow);
  const profile = buildTurnProfileSeries(result.intervals, result.coverageWindow);
  assert.ok(profile.stages.length > 0);
  assert.ok(profile.stages[0].mechanicalShare.trend);
});

test('walkTranscriptFiles records turn-overhead between user message and first tool', () => {
  const root = mkTmpDir('transcript-walker-overhead-');
  const file = path.join(root, 'overhead.jsonl');
  const userMs = 1_700_000_000_000;
  const toolMs = 1_700_000_005_000;
  fs.writeFileSync(
    file,
  `${JSON.stringify({ type: 'user', timestamp: new Date(userMs).toISOString() })}\n${JSON.stringify({
      type: 'assistant',
      timestamp: new Date(toolMs).toISOString(),
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { path: 'foo.txt' } }],
      },
    })}\n`,
    'utf8'
  );
  const result = walkTranscriptFiles([file], []);
  const overhead = result.intervals.find((row) => row.category === 'turn-overhead');
  assert.ok(overhead);
  assert.equal(overhead.startMs, userMs);
  assert.equal(overhead.endMs, toolMs);
});
