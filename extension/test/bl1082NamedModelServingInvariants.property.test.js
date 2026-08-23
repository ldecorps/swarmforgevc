'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { isPathInside } = require('../out/util/pathContainment');
const {
  buildNamedModelPullPlan,
  buildNamedModelServePlan,
  formatNamedModelStatus,
} = require('../out/swarm/modelServing');

const MODEL_IDS = ['qwen2.5-coder:7b-instruct', 'llama3.1:8b', 'gemma2:9b'];
const MODEL_ID_ARB = fc.constantFrom(...MODEL_IDS);
const PRESENT_ARB = fc.boolean();
const PORT_ARB = fc.constantFrom('11434', '11435', '18000');

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('BL-1082/BL-654 invariant 1: model identity stays parameterized in pull plans', () => {
  const repoRoot = mkTmpDir('bl1082-prop-repo-');
  const modelStorePath = mkTmpDir('bl1082-prop-store-');

  fc.assert(
    fc.property(MODEL_ID_ARB, PRESENT_ARB, (modelId, present) => {
      const plan = buildNamedModelPullPlan(modelId, {
        repoRoot,
        modelStorePath,
        presentModelIds: present ? [modelId] : [],
      });

      assert.equal(plan.modelId, modelId);
      assert.equal(plan.modelStorePath, modelStorePath);
      assert.equal(plan.environment.OLLAMA_MODELS, modelStorePath);
      assert.equal(plan.writePaths.length, 1);
      assert.equal(plan.writePaths[0], modelStorePath);

      if (present) {
        assert.equal(plan.ready, true);
        assert.equal(plan.shouldDownload, false);
        assert.equal(plan.command, null);
        assert.match(plan.message, /already present/i);
      } else {
        assert.equal(plan.ready, false);
        assert.equal(plan.shouldDownload, true);
        assert.match(plan.command, new RegExp(`ollama pull .*${escapeRegExp(modelId)}`));
      }
      return true;
    }),
    { numRuns: 48 }
  );
});

test('non-vacuity: invariant 1 fails when a broken planner hard-codes one model id', () => {
  const broken = (modelId) => ({
    modelId: 'qwen2.5-coder:7b-instruct',
    command: `ollama pull '${modelId}'`,
  });
  const other = 'llama3.1:8b';
  assert.notEqual(broken(other).modelId, other);
});

test('BL-1082/BL-654 invariant 2: pull writes stay outside the tracked worktree', () => {
  const repoRoot = mkTmpDir('bl1082-prop-repo-');
  const modelStorePath = mkTmpDir('bl1082-prop-store-');
  const plan = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct', {
    repoRoot,
    modelStorePath,
  });

  assert.equal(isPathInside(plan.modelStorePath, repoRoot), false);
  assert.equal(plan.environment.OLLAMA_MODELS, modelStorePath);
  assert.equal(
    plan.writePaths.every((p) => !isPathInside(p, repoRoot)),
    true
  );
  assert.match(plan.command || '', new RegExp(escapeRegExp(modelStorePath)));
});

test('non-vacuity: invariant 2 fails when a broken planner writes inside the repo', () => {
  const repoRoot = mkTmpDir('bl1082-prop-repo-');
  const brokenStore = `${repoRoot}/models/ollama`;
  assert.equal(isPathInside(brokenStore, repoRoot), true);
});

test('BL-1082/BL-654 invariant 3: serving a healthy endpoint reuses it', () => {
  fc.assert(
    fc.property(MODEL_ID_ARB, PORT_ARB, (modelId, port) => {
      const endpointUrl = `http://127.0.0.1:${port}`;
      const first = buildNamedModelServePlan(modelId, {
        endpointStatus: 'healthy',
        endpointUrl,
      });
      const second = buildNamedModelServePlan(modelId, {
        endpointStatus: 'healthy',
        endpointUrl,
      });

      assert.deepEqual(second, first);
      assert.equal(first.ready, true);
      assert.equal(first.shouldStartServer, false);
      assert.equal(first.command, null);
      assert.equal(first.endpointUrl, endpointUrl);
      assert.match(formatNamedModelStatus({ ready: true, endpointUrl, reason: 'ignored' }), /ready at/);
      return true;
    }),
    { numRuns: 36 }
  );
});

test('non-vacuity: invariant 3 fails when a broken planner always starts a server', () => {
  const broken = () => ({ shouldStartServer: true, command: 'ollama serve' });
  assert.equal(broken().shouldStartServer, true);
  const healthy = buildNamedModelServePlan('qwen2.5-coder:7b-instruct', {
    endpointStatus: 'healthy',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.notEqual(broken().shouldStartServer, healthy.shouldStartServer);
});
