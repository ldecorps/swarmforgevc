const assert = require('node:assert/strict');
const { buildNarrationSnapshot } = require('../out/notify/telegramNarrationSnapshot');

const TARGET = '/home/user/swarm';

function bridgeState(overrides = {}) {
  return {
    pipeline: [{ role: 'coder', status: 'active' }],
    runLog: [],
    ...overrides,
  };
}

test('buildNarrationSnapshot returns null when no run is recorded for this target', () => {
  const result = buildNarrationSnapshot(TARGET, bridgeState(), [], []);
  assert.equal(result, null);
});

test('buildNarrationSnapshot picks the most recently started run for this target, ignoring other targets', () => {
  const state = bridgeState({
    runLog: [
      { name: 'swarm-old', targetPath: TARGET, startedAt: '2026-07-01T00:00:00Z' },
      { name: 'swarm-other-target', targetPath: '/somewhere/else', startedAt: '2026-07-09T00:00:00Z' },
      { name: 'swarm-new', targetPath: TARGET, startedAt: '2026-07-08T00:00:00Z', prUrl: 'https://example.com/pr/9' },
    ],
  });

  const result = buildNarrationSnapshot(TARGET, state, [], []);

  assert.equal(result.runName, 'swarm-new');
  assert.equal(result.prUrl, 'https://example.com/pr/9');
});

test('buildNarrationSnapshot reports prUrl null (not undefined) when the current run has none yet', () => {
  const state = bridgeState({
    runLog: [{ name: 'swarm-new', targetPath: TARGET, startedAt: '2026-07-08T00:00:00Z' }],
  });

  const result = buildNarrationSnapshot(TARGET, state, [], []);

  assert.equal(result.prUrl, null);
});

test('buildNarrationSnapshot carries pipeline, gates, and deadLetters through unchanged', () => {
  const state = bridgeState({
    pipeline: [
      { role: 'coder', status: 'active' },
      { role: 'cleaner', status: 'idle' },
    ],
    runLog: [{ name: 'swarm-new', targetPath: TARGET, startedAt: '2026-07-08T00:00:00Z' }],
  });
  const gates = [{ role: 'coder', gated: true, snippet: 'Allow this action? (y/n)' }];
  const deadLetters = [{ role: 'cleaner', filePath: '/x/y.handoff.dead', chaseCount: 3 }];

  const result = buildNarrationSnapshot(TARGET, state, gates, deadLetters);

  assert.deepEqual(result.pipeline, [
    { role: 'coder', status: 'active' },
    { role: 'cleaner', status: 'idle' },
  ]);
  assert.deepEqual(result.gates, gates);
  assert.deepEqual(result.deadLetters, deadLetters);
});
