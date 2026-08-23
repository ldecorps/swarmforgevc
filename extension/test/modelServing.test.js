const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildNamedModelServePlan,
  buildNamedModelPullPlan,
  isNamedModelHealthy,
  formatNamedModelStatus,
} = require('../out/swarm/modelServing');

test('buildNamedModelPullPlan keeps model identity as a parameter', () => {
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct');
  assert.equal(plan.modelId, 'qwen2.5-coder:7b-instruct');
  assert.match(plan.command, /ollama pull .*qwen2\.5-coder:7b-instruct/);
});

test('buildNamedModelServePlan reuses an already healthy server', () => {
  const plan = buildNamedModelServePlan('qwen2.5-coder:7b-instruct', {
    endpointStatus: 'healthy',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.equal(plan.shouldStartServer, false);
  assert.equal(plan.endpointUrl, 'http://127.0.0.1:11434');
});

test('isNamedModelHealthy reports a missing endpoint as not ready with a reason', () => {
  const health = isNamedModelHealthy({ endpointStatus: 'missing', endpointUrl: 'http://127.0.0.1:11434' });
  assert.equal(health.ready, false);
  assert.equal(health.endpointUrl, 'http://127.0.0.1:11434');
});

test('formatNamedModelStatus names the endpoint it could not reach', () => {
  const message = formatNamedModelStatus({
    ready: false,
    endpointUrl: 'http://127.0.0.1:11434',
    reason: 'connection refused',
  });
  assert.match(message, /could not reach/i);
  assert.match(message, /127\.0\.0\.1:11434/);
});
