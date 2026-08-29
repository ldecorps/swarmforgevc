const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  contextUtilizationPct,
  deriveContextEventsFromUsageRecords,
  eventDedupeKey,
  filterNewContextEvents,
  isCompactionAfterPrior,
  readPersistedContextEvents,
  runContextTelemetryProducer,
} = require('../out/metrics/contextTelemetryProducer');
const { listTranscriptJsonlPaths, projectSlug } = require('../out/metrics/transcriptUsage');

function assistantLine(overrides = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: overrides.timestamp ?? '2026-07-09T11:38:10.165Z',
    message: {
      id: overrides.messageId ?? 'msg_1',
      model: 'claude-sonnet-5',
      usage: {
        input_tokens: overrides.inputTokens ?? 12000,
        output_tokens: overrides.outputTokens ?? 400,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

function writeFixtureTranscript(claudeProjectsDir, worktreePath, lines) {
  const dir = path.join(claudeProjectsDir, projectSlug(worktreePath));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.jsonl'), `${lines.join('\n')}\n`, 'utf8');
}

function writeRolesTsv(projectRoot, worktreePath, role = 'coder') {
  fs.mkdirSync(path.join(projectRoot, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.swarmforge', 'roles.tsv'),
    `${role}\t${role}\t${worktreePath}\t${role}\t${role}\tclaude\n`,
    'utf8'
  );
}

test('contextUtilizationPct derives utilisation from input tokens and default window', () => {
  assert.equal(contextUtilizationPct(100_000, 200_000), 50);
});

test('isCompactionAfterPrior detects a sharp drop after a high prior input', () => {
  assert.equal(isCompactionAfterPrior(180_000, 20_000), true);
  assert.equal(isCompactionAfterPrior(10_000, 9_000), false);
});

test('deriveContextEventsFromUsageRecords emits one event per unique message', () => {
  const events = deriveContextEventsFromUsageRecords('coder', 'coder', 'anthropic', [
    {
      messageId: 'm1',
      timestampMs: Date.parse('2026-07-09T11:38:10.165Z'),
      model: 'claude-sonnet-5',
      usage: { inputTokens: 12000, outputTokens: 400, cacheCreationTokens: 0, cacheReadTokens: 0 },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].agent, 'coder');
  assert.equal(events[0].input_tokens, 12000);
});

test('filterNewContextEvents drops already-persisted agent+session+timestamp keys', () => {
  const existing = [
    {
      agent: 'coder',
      role: 'coder',
      session_id: 'm1',
      timestamp: '2026-07-09T11:38:10.165Z',
      input_tokens: 1,
      output_tokens: 1,
      context_utilization_pct: 1,
      compaction: false,
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    },
  ];
  const derived = [...existing];
  assert.deepEqual(filterNewContextEvents(existing, derived), []);
  assert.equal(eventDedupeKey(existing[0]), 'coder:m1:2026-07-09T11:38:10.165Z');
});

test('runContextTelemetryProducer backfills transcript history and is idempotent on rerun', () => {
  const projectRoot = mkTmpDir('ctx-producer-');
  const worktreePath = path.join(projectRoot, '.worktrees', 'coder');
  const claudeProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-producer-projects-'));
  fs.mkdirSync(worktreePath, { recursive: true });
  writeRolesTsv(projectRoot, worktreePath);
  writeFixtureTranscript(claudeProjectsDir, worktreePath, [
    assistantLine({ messageId: 'historical-1', timestamp: '2026-01-01T00:00:00.000Z', inputTokens: 5000 }),
    assistantLine({ messageId: 'historical-2', timestamp: '2026-01-01T00:10:00.000Z', inputTokens: 6000 }),
  ]);
  assert.equal(listTranscriptJsonlPaths(worktreePath, claudeProjectsDir).length, 1);

  const recorded = [];
  const first = runContextTelemetryProducer({
    repoRoot: projectRoot,
    roleWorktrees: [{ role: 'coder', worktreePath }],
    providersByRole: new Map([['coder', 'claude']]),
    claudeProjectsDir,
    recordFn: (event) => recorded.push(event),
  });
  assert.equal(first.recorded, 2);
  assert.deepEqual(first.agents, ['coder']);

  const telemetryDir = path.join(projectRoot, '.swarmforge', 'telemetry');
  fs.mkdirSync(telemetryDir, { recursive: true });
  fs.writeFileSync(
    path.join(telemetryDir, 'context-events.jsonl'),
    `${recorded.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8'
  );
  assert.equal(readPersistedContextEvents(telemetryDir).length, 2);

  const second = runContextTelemetryProducer({
    repoRoot: projectRoot,
    roleWorktrees: [{ role: 'coder', worktreePath }],
    providersByRole: new Map([['coder', 'claude']]),
    claudeProjectsDir,
    recordFn: () => {
      throw new Error('recordFn must not run when everything is already ingested');
    },
  });
  assert.equal(second.recorded, 0);
  assert.equal(second.skippedDuplicates, 2);
});
