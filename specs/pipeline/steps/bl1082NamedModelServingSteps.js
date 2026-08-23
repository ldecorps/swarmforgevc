'use strict';

// BL-1082: step handlers for named-model pull/serve composition.
// Every step drives extension/out/swarm/modelServing.js — never a reimplementation.

const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const {
  buildNamedModelPullPlan,
  buildNamedModelServePlan,
  isNamedModelHealthy,
  formatNamedModelStatus,
} = require(path.join(OUT, 'swarm', 'modelServing'));
const { isPathInside } = require(path.join(OUT, 'util', 'pathContainment'));

const FEATURE = 'The swarm can pull and serve a named model on this host';

function registerSteps(registry) {
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  define(/^a host model store configured outside the tracked worktree$/, (ctx) => {
    ctx.repoRoot = '/tmp/bl1082-worktree';
    ctx.modelStorePath = '/tmp/bl1082-models/ollama';
    ctx.availableModelIds = ['qwen2.5-coder:7b-instruct', 'llama3.1:8b'];
    assert.equal(isPathInside(ctx.modelStorePath, ctx.repoRoot), false);
  });

  define(/^a pull is requested for model "([^"]+)"$/, (ctx, modelId) => {
    ctx.pullModelId = modelId;
    try {
      ctx.pullPlan = buildNamedModelPullPlan(modelId, {
        repoRoot: ctx.repoRoot,
        modelStorePath: ctx.modelStorePath,
        presentModelIds: ctx.presentModelIds,
        availableModelIds: ctx.availableModelIds,
      });
      ctx.pullFailure = null;
    } catch (err) {
      ctx.pullFailure = err;
      ctx.pullPlan = null;
    }
  });

  define(/^the composed pull names model "([^"]+)"$/, (ctx, modelId) => {
    assert.ok(ctx.pullPlan, 'expected a composed pull plan');
    assert.equal(ctx.pullPlan.modelId, modelId);
    assert.match(
      ctx.pullPlan.command || '',
      new RegExp(`ollama pull .*${modelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );
  });

  define(/^the pull targets the host model store$/, (ctx) => {
    assert.ok(ctx.pullPlan, 'expected a pull plan');
    assert.equal(ctx.pullPlan.modelStorePath, ctx.modelStorePath);
    assert.equal(ctx.pullPlan.environment.OLLAMA_MODELS, ctx.modelStorePath);
  });

  define(/^model "([^"]+)" is already present in the host model store$/, (ctx, modelId) => {
    ctx.presentModelIds = [modelId];
  });

  define(/^no download is started$/, (ctx) => {
    assert.ok(ctx.pullPlan, 'expected a pull plan');
    assert.equal(ctx.pullPlan.shouldDownload, false);
    assert.equal(ctx.pullPlan.command, null);
  });

  define(/^the model is reported as ready$/, (ctx) => {
    assert.ok(ctx.pullPlan, 'expected a pull plan');
    assert.equal(ctx.pullPlan.ready, true);
    assert.match(ctx.pullPlan.message, /already present/i);
  });

  define(/^the local inference server is serving model "([^"]+)"$/, (ctx, modelId) => {
    ctx.serverModelId = modelId;
    ctx.health = isNamedModelHealthy({
      endpointStatus: 'healthy',
      endpointUrl: 'http://127.0.0.1:11434',
    });
  });

  define(/^the endpoint health is checked$/, (ctx) => {
    if (!ctx.health) {
      ctx.health = isNamedModelHealthy({
        endpointStatus: ctx.serverModelId ? 'healthy' : 'missing',
        endpointUrl: 'http://127.0.0.1:11434',
      });
    }
    ctx.healthMessage = formatNamedModelStatus(ctx.health);
  });

  define(/^the health check reports ready$/, (ctx) => {
    assert.equal(ctx.health.ready, true);
    assert.equal(ctx.healthMessage ?? formatNamedModelStatus(ctx.health), `ready at ${ctx.health.endpointUrl}`);
  });

  define(/^it names an OpenAI-compatible base URL on the loopback interface$/, (ctx) => {
    assert.match(ctx.health.endpointUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  define(/^no local inference server is running$/, (ctx) => {
    ctx.health = isNamedModelHealthy({
      endpointStatus: 'missing',
      endpointUrl: 'http://127.0.0.1:11434',
    });
    ctx.healthMessage = formatNamedModelStatus(ctx.health);
  });

  define(/^the health check reports not ready$/, (ctx) => {
    assert.equal(ctx.health.ready, false);
  });

  define(/^it names the endpoint it could not reach$/, (ctx) => {
    assert.match(ctx.healthMessage, /could not reach/i);
    assert.match(ctx.healthMessage, /127\.0\.0\.1:11434/);
  });

  define(/^a serve is requested for model "([^"]+)"$/, (ctx, modelId) => {
    ctx.servePlan = buildNamedModelServePlan(modelId, {
      endpointStatus: ctx.health?.ready ? 'healthy' : 'missing',
      endpointUrl: ctx.health?.endpointUrl ?? 'http://127.0.0.1:11434',
      reason: ctx.health?.reason,
    });
  });

  define(/^no second server is started$/, (ctx) => {
    assert.equal(ctx.servePlan.shouldStartServer, false);
    assert.equal(ctx.servePlan.command, null);
  });

  define(/^the pull fails$/, (ctx) => {
    assert.ok(ctx.pullFailure, 'expected the pull request to fail');
    assert.equal(ctx.pullPlan, null);
  });

  define(/^the failure names model "([^"]+)"$/, (ctx, modelId) => {
    assert.match(
      String(ctx.pullFailure?.message || ctx.pullFailure || ''),
      new RegExp(modelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  });

  define(/^no path the pull wrote is tracked by git$/, (ctx) => {
    assert.ok(ctx.pullPlan, 'expected a pull plan');
    assert.equal(isPathInside(ctx.pullPlan.modelStorePath, ctx.repoRoot), false);
    assert.equal(
      ctx.pullPlan.writePaths.every((p) => !isPathInside(p, ctx.repoRoot)),
      true
    );
  });
}

module.exports = { registerSteps };
