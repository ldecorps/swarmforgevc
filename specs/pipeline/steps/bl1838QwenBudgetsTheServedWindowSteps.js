'use strict';

// BL-1838: step handlers for "A local-model seat's qwen budgets the window
// its model is served with". Drives the REAL write_local_model_qwen_settings
// shell function (sourced straight from swarmforge.sh, exactly as BL-1801's
// own step handler sources it for its no-local-model-seat scenario - the
// ZSH_EVAL_CONTEXT toplevel guard at the file's end means sourcing it never
// launches anything) against a fake Ollama - a real node http server on
// loopback, never the live one, never port 11434, never the live ~/.qwen.
//
// ASYNC spawn only (never spawnSync): the fake server runs in this SAME
// node process, so a synchronous spawn would block the event loop for the
// whole child's lifetime and the server could never actually answer the
// curl request the child shells out to - the exact reason BL-1801's own
// handler spawns its CLI async too.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1838 A local-model seat's qwen budgets the window its model is served with";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

// BL-1829's own six-tool/twelve-exclude lists (test_bl1829_local_model_qwen_settings.sh's
// own CORE_EXPECTED/EXCLUDE_EXPECTED) - the entry this ticket adds must
// leave these exactly as they are (scenario 03).
const CORE_TOOLS = ['run_shell_command', 'read_file', 'write_file', 'edit', 'glob', 'grep_search'];

function ensure(ctx) {
  if (!ctx.bl1838) {
    ctx.bl1838 = { role: 'coder', requestCount: 0 };
  }
  return ctx.bl1838;
}

function startFakeOllama(ctx, numCtx) {
  const st = ensure(ctx);
  const server = http.createServer((req, res) => {
    st.requestCount += 1;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parameters =
        numCtx === undefined
          ? 'stop                            "</s>"'
          : `num_ctx                        ${numCtx}\nstop                            "</s>"`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ parameters }));
    });
  });
  st.server = server;
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      st.port = server.address().port;
      st.endpointUrl = `http://127.0.0.1:${st.port}/v1`;
      resolve();
    });
  });
}

function writeSettings(ctx) {
  const st = ensure(ctx);
  const worktree = trackedTmpRoot('bl1838-worktree-');
  const script = `source '${SWARMFORGE_SH}'; write_local_model_qwen_settings '${worktree}' '${st.model}' '${st.endpointUrl}' '${st.contextLength || ''}' '${st.role}'`;
  st.settingsPath = path.join(worktree, '.qwen', 'settings.json');
  return new Promise((resolve) => {
    const child = spawn('zsh', ['-f', '-c', script], { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => {
      st.writeExitCode = code;
      st.writeOutput = `${stdout}${stderr}`;
      resolve();
    });
  });
}

function readSettings(ctx) {
  const st = ensure(ctx);
  return JSON.parse(fs.readFileSync(st.settingsPath, 'utf8'));
}

function providerEntry(ctx, model) {
  const settings = readSettings(ctx);
  const providers = (settings.modelProviders && settings.modelProviders.openai) || [];
  return providers.find((p) => p.id === model);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a local-model seat whose model "([^"]+)" Ollama serves with num_ctx (\d+)$/, async (ctx, model, servedNumCtx) => {
    const st = ensure(ctx);
    st.model = model;
    await startFakeOllama(ctx, Number(servedNumCtx));
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => st.server && st.server.close());
  });

  scoped(/^a local-model seat whose model "([^"]+)" Ollama reports no num_ctx for$/, async (ctx, model) => {
    const st = ensure(ctx);
    st.model = model;
    await startFakeOllama(ctx, undefined);
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => st.server && st.server.close());
  });

  scoped(/^the swarm's context length is (\d+)$/, (ctx, contextLength) => {
    ensure(ctx).contextLength = contextLength;
  });

  scoped(/^the swarm writes the seat's qwen settings$/, async (ctx) => {
    await writeSettings(ctx);
  });

  scoped(/^the worktree's qwen settings give "([^"]+)" a context window of (\d+)$/, (ctx, model, window) => {
    const st = ensure(ctx);
    assert.equal(st.writeExitCode, 0, `expected write_local_model_qwen_settings to exit 0, got ${st.writeExitCode}: ${st.writeOutput}`);
    const entry = providerEntry(ctx, model);
    assert.ok(entry, `expected a modelProviders.openai entry for "${model}", got: ${st.writeOutput}`);
    assert.equal(
      entry.generationConfig.contextWindowSize,
      Number(window),
      `expected contextWindowSize ${window}, got ${entry.generationConfig.contextWindowSize}`
    );
  });

  scoped(/^the entry for "([^"]+)" sends think false to the loopback endpoint$/, (ctx, model) => {
    const st = ensure(ctx);
    const entry = providerEntry(ctx, model);
    assert.ok(entry, `expected a modelProviders.openai entry for "${model}"`);
    assert.equal(entry.generationConfig.extra_body && entry.generationConfig.extra_body.think, false);
    assert.equal(entry.baseUrl, st.endpointUrl, `expected baseUrl to be the loopback endpoint ${st.endpointUrl}, got ${entry.baseUrl}`);
  });

  scoped(/^the core tool list is exactly the six BL-1829 tools$/, (ctx) => {
    const settings = readSettings(ctx);
    assert.deepEqual(settings.coreTools, CORE_TOOLS, `expected coreTools ${JSON.stringify(CORE_TOOLS)}, got ${JSON.stringify(settings.coreTools)}`);
    assert.deepEqual(settings.tools && settings.tools.core, CORE_TOOLS, `expected tools.core ${JSON.stringify(CORE_TOOLS)}, got ${JSON.stringify(settings.tools && settings.tools.core)}`);
  });
}

module.exports = { registerSteps };
