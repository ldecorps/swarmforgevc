'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const os = require('node:os');

const {
  buildNamedModelPullPlan,
  buildNamedModelServePlan,
  isNamedModelHealthy,
  formatNamedModelStatus,
  DEFAULT_NAMED_MODEL_ENDPOINT_URL,
  NAMED_MODEL_STORE_ENV,
  NAMED_MODEL_HOST_ENV,
} = require('../out/swarm/modelServing');

test('buildNamedModelPullPlan keeps model identity as a parameter', () => {
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct');
  assert.equal(plan.modelId, 'qwen2.5-coder:7b-instruct');
  assert.match(plan.command, /ollama pull .*qwen2\.5-coder:7b-instruct/);
  assert.equal(plan.shouldDownload, true);
  assert.equal(plan.ready, false);
  assert.match(plan.message, /qwen2\.5-coder:7b-instruct/);
  assert.match(plan.message, /Pull model/);
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
  const modelStorePath = mkTmpDir('bl1082-present-');
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct', {
    presentModelIds: ['qwen2.5-coder:7b-instruct'],
    modelStorePath,
  });
  assert.equal(plan.shouldDownload, false);
  assert.equal(plan.command, null);
  assert.equal(plan.ready, true);
  assert.match(plan.message, /already present/i);
  assert.deepEqual(plan.writePaths, [modelStorePath]);
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

test('buildNamedModelPullPlan allows a store path outside the tracked worktree', () => {
  const repoRoot = mkTmpDir('bl1082-repo-out-');
  const outside = mkTmpDir('bl1082-store-out-');
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct', {
    repoRoot,
    modelStorePath: outside,
  });
  assert.equal(plan.modelStorePath, outside);
  assert.equal(plan.shouldDownload, true);
});

test('buildNamedModelPullPlan defaults store under ~/.swarmforge/models/ollama', () => {
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct');
  const expected = path.join(os.homedir(), '.swarmforge', 'models', 'ollama');
  assert.equal(plan.modelStorePath, expected);
  assert.equal(NAMED_MODEL_STORE_ENV, 'OLLAMA_MODELS');
  assert.equal(plan.environment.OLLAMA_MODELS, expected);
});

test('buildNamedModelPullPlan shell-quotes store paths that contain single quotes', () => {
  const modelStorePath = path.join(mkTmpDir('bl1082-quote-'), "o'llama");
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct', { modelStorePath });
  assert.match(plan.command, /OLLAMA_MODELS='.*'\\''llama'/);
});

test('isNamedModelHealthy reports a missing endpoint as not ready with a reason', () => {
  const health = isNamedModelHealthy({
    endpointStatus: 'missing',
    endpointUrl: DEFAULT_NAMED_MODEL_ENDPOINT_URL,
  });
  assert.equal(health.ready, false);
  assert.equal(health.endpointUrl, DEFAULT_NAMED_MODEL_ENDPOINT_URL);
  assert.equal(DEFAULT_NAMED_MODEL_ENDPOINT_URL, 'http://127.0.0.1:11434');
  assert.match(health.reason, /could not reach/);
});

test('isNamedModelHealthy trims whitespace around endpoint URLs', () => {
  const health = isNamedModelHealthy({
    endpointStatus: 'missing',
    endpointUrl: '  http://127.0.0.1:11434  ',
  });
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
  assert.match(message, /\(connection refused\)/);
});

test('isNamedModelHealthy reports a healthy loopback OpenAI-compatible endpoint as ready', () => {
  const health = isNamedModelHealthy({
    endpointStatus: 'healthy',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.equal(health.ready, true);
  assert.match(health.endpointUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(health.reason, 'OpenAI-compatible loopback endpoint is ready');
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

test('buildNamedModelServePlan prefers probe endpoint when options omit endpointUrl', () => {
  const plan = buildNamedModelServePlan(
    'qwen2.5-coder:7b-instruct',
    {
      endpointStatus: 'healthy',
      endpointUrl: 'http://127.0.0.1:9999',
    },
    {}
  );
  assert.equal(plan.endpointUrl, 'http://127.0.0.1:9999');
  assert.equal(plan.shouldStartServer, false);
});

test('buildNamedModelServePlan starts ollama serve when the endpoint is missing', () => {
  const plan = buildNamedModelServePlan('qwen2.5-coder:7b-instruct', {
    endpointStatus: 'missing',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.equal(plan.shouldStartServer, true);
  assert.match(plan.command, /ollama serve/);
  assert.match(plan.command, new RegExp(`${NAMED_MODEL_HOST_ENV}=`));
  assert.equal(plan.ready, false);
});

test('buildNamedModelPullPlan refuses a blank model id', () => {
  assert.throws(() => buildNamedModelPullPlan('   '), /must not be blank/);
  assert.throws(() => buildNamedModelPullPlan(null), /must not be blank/);
  assert.throws(() => buildNamedModelPullPlan(undefined), /must not be blank/);
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

test('formatNamedModelStatus omits empty reason parentheses', () => {
  const message = formatNamedModelStatus({
    ready: false,
    endpointUrl: 'http://127.0.0.1:11434',
    reason: '',
  });
  assert.equal(message, 'not ready: could not reach http://127.0.0.1:11434');
});

test('buildNamedModelServePlan quotes a non-URL endpoint host as-is', () => {
  const plan = buildNamedModelServePlan(
    'qwen2.5-coder:7b-instruct',
    { endpointStatus: 'missing', endpointUrl: 'not a url' },
    { endpointUrl: 'not a url' }
  );
  assert.match(plan.command, /OLLAMA_HOST='not a url'/);
});

test('buildNamedModelServePlan strips only a leading http(s) scheme from unparseable endpoints', () => {
  const mid = buildNamedModelServePlan(
    'qwen2.5-coder:7b-instruct',
    { endpointStatus: 'missing', endpointUrl: '%http://host:9' },
    { endpointUrl: '%http://host:9' }
  );
  // URL ctor rejects this; host extraction must keep a mid-string scheme
  // (anchored replace) — an unanchored replace would wipe `http://` and leave
  // `%host:9`.
  assert.match(mid.command, /OLLAMA_HOST='%http:\/\/host:9'/);

  const leading = buildNamedModelServePlan(
    'qwen2.5-coder:7b-instruct',
    { endpointStatus: 'missing', endpointUrl: 'http://[bad' },
    { endpointUrl: 'http://[bad' }
  );
  // Leading http:// must strip; an https-only pattern would leave the scheme.
  assert.match(leading.command, /OLLAMA_HOST='\[bad'/);
  assert.doesNotMatch(leading.command, /http:/);
});
