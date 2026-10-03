'use strict';

// BL-1848: step handlers for "A local model's served window is watched
// against its work and the GPU". Drives the REAL gather-local-window-facts
// and check-local-window-fit (and, for scenario 05, assemble-findings)
// through swarmforge/scripts/test/bl1848_local_window_runner.bb against a
// fake Ollama - a real node http server in this process, never the live
// one - and a fixture usage dir, never the operator's ~/.qwen.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1848 A local model's served window is watched against its work and the GPU";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl1848_local_window_runner.bb');
const MIB = 1048576;

function ensure(ctx) {
  if (!ctx.bl1848) {
    const root = trackedTmpRoot('bl1848-window-');
    const usageDir = path.join(root, 'usage');
    fs.mkdirSync(usageDir, { recursive: true });
    ctx.bl1848 = { root, usageDir, models: [], answering: true, usageRows: 0 };
  }
  return ctx.bl1848;
}

function startFakeOllama(ctx) {
  const st = ensure(ctx);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: st.models }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      st.baseUrl = `http://127.0.0.1:${port}`;
      if (st.answering) {
        ctx.__disposables = ctx.__disposables || [];
        ctx.__disposables.push(() => server.close());
        resolve();
      } else {
        // A port that was free a moment ago and is closed now: refused.
        server.close(() => resolve());
      }
    });
  });
}

function recordUsage(ctx, model, input, output, minutesAgo) {
  const st = ensure(ctx);
  const ts = new Date(Date.now() - minutesAgo * 60000);
  const month = ts.toISOString().slice(0, 7);
  st.usageRows += 1;
  const row = {
    sessionId: `bl1848-${st.usageRows}`,
    model,
    inputTokens: input,
    outputTokens: output,
    timestamp: ts.toISOString(),
  };
  fs.appendFileSync(path.join(st.usageDir, `token-usage-${month}.jsonl`), `${JSON.stringify(row)}\n`);
}

async function runRunner(ctx, subcommand) {
  const st = ensure(ctx);
  await startFakeOllama(ctx);
  const payload = JSON.stringify({ base_url: st.baseUrl, usage_dir: st.usageDir });
  // Async spawn: the fake Ollama lives in this process's event loop.
  await new Promise((resolve) => {
    const child = spawn('bb', [RUNNER, st.root, subcommand, payload]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => {
      assert.equal(code, 0, `runner exited ${code}: ${stdout}${stderr}`);
      st.findings = JSON.parse(stdout.trim().split('\n').pop()).findings;
      resolve();
    });
  });
}

function onlyFinding(st) {
  assert.equal(st.findings.length, 1, `expected one finding, got ${JSON.stringify(st.findings)}`);
  return st.findings[0];
}

const OUTCOMES = new Map([
  ['no finding', (st) => assert.deepEqual(st.findings, [])],
  ['window too small', (st) => assert.match(onlyFinding(st).key, /^local-window-size-/)],
  ['window outgrew GPU memory', (st) => assert.match(onlyFinding(st).key, /^local-window-vram-/)],
]);

const OLLAMA_STATES = new Map([
  ['not answering', (st) => { st.answering = false; }],
  ['answering with no model loaded', (st) => { st.models = []; }],
]);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^Ollama has "([^"]+)" loaded with (\d+) MiB of its (\d+) MiB in VRAM and a (\d+)-token context$/,
    (ctx, name, vram, size, contextLength) => {
      ensure(ctx).models.push({
        name,
        model: name,
        size: Number(size) * MIB,
        size_vram: Number(vram) * MIB,
        context_length: Number(contextLength),
      });
    });

  scoped(/^Ollama is (.+)$/, (ctx, state) => {
    const apply = OLLAMA_STATES.get(state);
    assert.ok(apply, `unrecognized Ollama state: ${state}`);
    apply(ensure(ctx));
  });

  scoped(/^qwen recorded a request of (\d+) tokens for "([^"]+)" (\d+) minutes ago$/, (ctx, tokens, model, minutes) => {
    recordUsage(ctx, model, Number(tokens), 0, Number(minutes));
  });

  scoped(/^qwen recorded a request of (\d+) input and (\d+) output tokens for "([^"]+)" (\d+) minutes ago$/,
    (ctx, input, output, model, minutes) => {
      recordUsage(ctx, model, Number(input), Number(output), Number(minutes));
    });

  scoped(/^the local window check runs$/, (ctx) => runRunner(ctx, 'check'));

  scoped(/^the babysitter sweep assembles its findings from that snapshot$/, (ctx) => runRunner(ctx, 'sweep'));

  scoped(/^the window check reports "([^"]+)"$/, (ctx, outcome) => {
    const check = OUTCOMES.get(outcome);
    assert.ok(check, `unrecognized outcome: ${outcome}`);
    check(ensure(ctx));
  });

  scoped(/^the finding is a CRIT keyed "([^"]+)"$/, (ctx, key) => {
    const f = onlyFinding(ensure(ctx));
    assert.equal(f.key, key);
    assert.equal(f.severity, 'CRIT');
  });

  scoped(/^its message names (\d+) of (\d+) MiB in VRAM and the (\d+) context$/, (ctx, vram, size, contextLength) => {
    const msg = onlyFinding(ensure(ctx)).message;
    assert.ok(msg.includes(`${vram} of ${size} MiB in VRAM`), msg);
    assert.ok(msg.includes(`${contextLength}-token context`), msg);
  });

  scoped(/^its message names the (\d+)-token peak, (\d+) in and (\d+) out, and the (\d+) context$/,
    (ctx, peak, input, output, contextLength) => {
      const msg = onlyFinding(ensure(ctx)).message;
      assert.ok(msg.includes(`${peak}-token request`), msg);
      assert.ok(msg.includes(`(${input} in, ${output} out)`), msg);
      assert.ok(msg.includes(`${contextLength}-token context`), msg);
    });

  scoped(/^the sweep's findings include a CRIT keyed "([^"]+)"$/, (ctx, key) => {
    const st = ensure(ctx);
    const f = st.findings.find((x) => x.key === key);
    assert.ok(f, `no finding keyed ${key} in ${JSON.stringify(st.findings)}`);
    assert.equal(f.severity, 'CRIT');
  });
}

module.exports = { registerSteps };
