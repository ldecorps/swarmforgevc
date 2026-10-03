'use strict';

// BL-1841: step handler for "a local-model seat's requests reach Ollama
// with thinking off". Drives the REAL write_local_model_qwen_settings
// (sourced from swarmforge.sh) and the REAL pinned qwen binary, throwaway
// HOME, against a loopback fake endpoint that records each chat request
// body (BL-1829/BL-1840's method) - never the live Ollama. The field is
// asserted as a literal: the one measured to stop reasoning on the
// swarm's Ollama (backlog/evidence/BL-1841-thinking-off-field-measurement-coder.md);
// the live measurement is evidence, never an acceptance step.

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1841 A local-model seat's requests reach Ollama with thinking off";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

// Measured on Ollama 0.32.15 /v1/chat/completions: top-level think false
// left reasoning on; reasoning_effort "none" turned it off.
const HONOURED_FIELD = 'reasoning_effort';
const HONOURED_VALUE = 'none';

function ensure(ctx) {
  if (!ctx.bl1841) {
    ctx.bl1841 = { role: 'coder', requests: [] };
  }
  return ctx.bl1841;
}

function startFakeEndpoint(ctx, numCtx) {
  const st = ensure(ctx);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/api/show') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ parameters: `num_ctx                        ${numCtx}` }));
        return;
      }
      st.requests.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = {
        id: 'chatcmpl-fixture',
        object: 'chat.completion.chunk',
        created: 0,
        model: st.model,
        choices: [{ index: 0, delta: { role: 'assistant', content: 'ok.' }, finish_reason: 'stop' }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  st.server = server;
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      st.endpointUrl = `http://127.0.0.1:${server.address().port}/v1`;
      resolve();
    });
  });
}

// Async, never spawnSync: the write's served-window probe calls back into
// the fake endpoint running in this same process (BL-1801's gotcha).
function runChild(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', reject);
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a local-model seat whose model "([^"]+)" Ollama serves with num_ctx (\d+)$/, async (ctx, model, numCtx) => {
    const st = ensure(ctx);
    st.model = model;
    st.home = trackedTmpRoot('bl1841-home-');
    st.cwd = trackedTmpRoot('bl1841-cwd-');
    await startFakeEndpoint(ctx, Number(numCtx));
  });

  scoped(/^the swarm has written the seat's qwen settings$/, async (ctx) => {
    const st = ensure(ctx);
    const script = `source '${SWARMFORGE_SH}'; write_local_model_qwen_settings '${st.cwd}' '${st.model}' '${st.endpointUrl}' '' '${st.role}'`;
    const r = await runChild('zsh', ['-f', '-c', script], { env: { ...process.env, HOME: st.home } });
    assert.equal(r.code, 0, `write_local_model_qwen_settings failed: ${r.out}`);
  });

  scoped(/^qwen in the seat's worktree sends a chat request to a loopback fake endpoint$/, async (ctx) => {
    const st = ensure(ctx);
    const r = await runChild(
      'qwen',
      ['--auth-type', 'openai', '-y', '-m', st.model, '--openai-base-url', st.endpointUrl, '--openai-api-key', 'fixture', '-p', 'say ok'],
      { cwd: st.cwd, env: { ...process.env, HOME: st.home, OPENAI_API_KEY: 'fixture' }, timeout: 60000 }
    );
    st.qwenOutput = r.out;
    st.server.close();
  });

  scoped(/^the request body carries the thinking-off field the swarm's Ollama version honours$/, (ctx) => {
    const st = ensure(ctx);
    const chats = st.requests.map((b) => JSON.parse(b)).filter((b) => Array.isArray(b.messages));
    assert.ok(chats.length > 0, `expected qwen to send a chat request, got none; qwen: ${st.qwenOutput}`);
    for (const body of chats) {
      assert.equal(body[HONOURED_FIELD], HONOURED_VALUE, `expected top-level ${HONOURED_FIELD}=${HONOURED_VALUE}, got: ${JSON.stringify(body).slice(0, 400)}`);
    }
  });
}

module.exports = { registerSteps };
