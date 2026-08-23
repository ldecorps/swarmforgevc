const assert = require('node:assert/strict');
const { buildNamedModelPullPlan, buildNamedModelServePlan } = require('../out/swarm/modelServing');
const { mostRecentRunForTarget } = require('../out/runs/runLog');

test('launch planning keeps model identity parameterized', () => {
  const plan = buildNamedModelPullPlan('llama3.1:8b', {
    presentModelIds: [],
    availableModelIds: ['llama3.1:8b'],
  });

  assert.equal(plan.modelId, 'llama3.1:8b');
  assert.match(plan.command, /ollama pull .*llama3\.1:8b/);
});

test('serve planning reuses an already healthy endpoint', () => {
  const plan = buildNamedModelServePlan('qwen2.5-coder:7b-instruct', {
    endpointStatus: 'healthy',
    endpointUrl: 'http://127.0.0.1:11434',
  });

  assert.equal(plan.shouldStartServer, false);
  assert.equal(plan.command, null);
  assert.equal(plan.ready, true);
});

test('run history returns the latest run for a target', () => {
  const targetPath = '/tmp/target';
  const runs = [
    { name: 'old', targetPath, startedAt: '2026-08-23T10:00:00.000Z' },
    { name: 'new', targetPath, startedAt: '2026-08-23T11:00:00.000Z' },
  ];

  assert.equal(mostRecentRunForTarget(runs, targetPath).name, 'new');
});
