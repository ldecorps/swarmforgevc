'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  buildNamedModelPullPlan,
  buildNamedModelServePlan,
  isNamedModelHealthy,
  formatNamedModelStatus,
  DEFAULT_NAMED_MODEL_ENDPOINT_URL,
  NAMED_MODEL_STORE_ENV,
} = require('../out/swarm/modelServing');

test('buildNamedModelPullPlan keeps model identity as a parameter', () => {
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct');
  assert.equal(plan.modelId, 'qwen2.5-coder:7b-instruct');
  assert.match(plan.command, /ollama pull .*qwen2\.5-coder:7b-instruct/);
  assert.equal(plan.shouldDownload, true);
  assert.equal(plan.ready, false);
});

test('buildNamedModelPullPlan targets a second model id without a second adapter path', () => {
  const first = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct');
  const second = buildNamedModelPullPlan('llama3.1:8b');
  assert.equal(second.modelId, 'llama3.1:8b');
  assert.match(second.command, /ollama pull .*llama3\.1:8b/);
  assert.equal(first.modelStorePath, second.modelStorePath);
  assert.equal(Object.keys(first.environment).join(','), Object.keys(second.environment).join(','));
});

test('buildNamedModelPullPlan targets the host model store via OLLAMA_MODELS', () => {
  const modelStorePath = mkTmpDir('bl1082-store-');
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct', { modelStorePath });
  assert.equal(plan.modelStorePath, modelStorePath);
  assert.equal(plan.environment[NAMED_MODEL_STORE_ENV], modelStorePath);
  assert.equal(plan.writePaths[0], modelStorePath);
});

test('buildNamedModelPullPlan downloads nothing when the model is already present', () => {
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct', {
    presentModelIds: ['qwen2.5-coder:7b-instruct'],
  });
  assert.equal(plan.shouldDownload, false);
  assert.equal(plan.command, null);
  assert.equal(plan.ready, true);
  assert.match(plan.message, /already present/i);
});

test('buildNamedModelPullPlan fails loudly for an unknown model id', () => {
  assert.throws(
    () =>
      buildNamedModelPullPlan('not-a-real-model:0b', {
        availableModelIds: ['qwen2.5-coder:7b-instruct', 'llama3.1:8b'],
      }),
    /not-a-real-model:0b/
  );
});

test('buildNamedModelPullPlan refuses a store path inside the tracked worktree', () => {
  const repoRoot = mkTmpDir('bl1082-repo-');
  const inside = path.join(repoRoot, 'models', 'ollama');
  assert.throws(
    () =>
      buildNamedModelPullPlan('qwen2.5-coder:7b-instruct', {
        repoRoot,
        modelStorePath: inside,
      }),
    /outside the tracked worktree/
  );
});

test('isNamedModelHealthy reports a missing endpoint as not ready with a reason', () => {
  const health = isNamedModelHealthy({
    endpointStatus: 'missing',
    endpointUrl: DEFAULT_NAMED_MODEL_ENDPOINT_URL,
  });
  assert.equal(health.ready, false);
  assert.equal(health.endpointUrl, DEFAULT_NAMED_MODEL_ENDPOINT_URL);
  assert.match(health.reason, /could not reach/);
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

test('isNamedModelHealthy reports a healthy loopback OpenAI-compatible endpoint as ready', () => {
  const health = isNamedModelHealthy({
    endpointStatus: 'healthy',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.equal(health.ready, true);
  assert.match(health.endpointUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(formatNamedModelStatus(health), /^ready at /);
});

test('buildNamedModelServePlan reuses an already healthy server', () => {
  const plan = buildNamedModelServePlan('qwen2.5-coder:7b-instruct', {
    endpointStatus: 'healthy',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.equal(plan.shouldStartServer, false);
  assert.equal(plan.command, null);
  assert.equal(plan.ready, true);
  assert.equal(plan.endpointUrl, 'http://127.0.0.1:11434');
});

test('buildNamedModelServePlan starts ollama serve when the endpoint is missing', () => {
  const plan = buildNamedModelServePlan('qwen2.5-coder:7b-instruct', {
    endpointStatus: 'missing',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.equal(plan.shouldStartServer, true);
  assert.match(plan.command, /ollama serve/);
  assert.equal(plan.ready, false);
});

test('buildNamedModelPullPlan refuses a blank model id', () => {
  assert.throws(() => buildNamedModelPullPlan('   '), /must not be blank/);
});

test('isNamedModelHealthy prefers an explicit probe reason for unhealthy', () => {
  const health = isNamedModelHealthy({
    endpointStatus: 'unhealthy',
    endpointUrl: 'http://127.0.0.1:11434',
    reason: 'bad status',
  });
  assert.equal(health.ready, false);
  assert.equal(health.reason, 'bad status');
});

test('isNamedModelHealthy defaults the unhealthy reason when none is given', () => {
  const health = isNamedModelHealthy({
    endpointStatus: 'unhealthy',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.match(health.reason, /not healthy/);
});

test('buildNamedModelServePlan quotes a non-URL endpoint host as-is', () => {
  const plan = buildNamedModelServePlan(
    'qwen2.5-coder:7b-instruct',
    { endpointStatus: 'missing', endpointUrl: 'not a url' },
    { endpointUrl: 'not a url' }
  );
  assert.match(plan.command, /OLLAMA_HOST='not a url'/);
});
