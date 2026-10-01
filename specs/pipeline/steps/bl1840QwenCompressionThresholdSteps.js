'use strict';

// BL-1840 (amended 2026-10-01): step handlers for "a local-model seat's
// qwen compresses its chat only when the history nears the served window".
// The ticket's first premise (a written context.autoCompactThreshold)
// could not work - proven false against the pinned qwen's own --debug log
// (backlog/evidence/BL-1840-hardener-bounce-20261001.md). The amended fix
// is the launch's window gate (local_model_window_gate_lib.bb), which
// flags a served window whose qwen compaction trigger falls below the
// trigger a 32768-token window gives.
//
// Scenarios 01/02 drive the REAL local_model_window_gate_cli.bb's new
// `dead-zone` subcommand against a fake Ollama (the same /api/show fixture
// BL-1801's own step handler already uses). Scenario 03 drives the REAL
// pinned qwen binary (never a reimplementation of its own compaction
// decision) against a combined fake endpoint, reusing the hardener's own
// method (backlog/evidence/BL-1840-hardener-bounce-20261001.md): a
// throwaway HOME, a loopback fake endpoint whose /api/show reports
// num_ctx, and qwen's own `[compaction] cheap-gate ... auto=<n>` --debug
// line - never the live Ollama, never the operator's own ~/.qwen.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1840 A local-model seat is never served a window in qwen's compaction dead zone";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_model_window_gate_cli.bb');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

function ensure(ctx) {
  if (!ctx.bl1840) {
    ctx.bl1840 = { role: 'coder', model: 'ista-iq3s-coder:latest', requests: [] };
  }
  return ctx.bl1840;
}

// ── scenarios 01/02: the gate CLI against a fake Ollama (/api/show only) ──

function startFakeOllama(ctx, numCtx) {
  const st = ensure(ctx);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parameters =
        numCtx === undefined ? 'stop                            "</s>"' : `num_ctx                        ${numCtx}`;
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

function stopFakeOllama(ctx) {
  const st = ensure(ctx);
  if (st.server) {
    st.server.close();
  }
}

function runDeadZoneCheck(ctx) {
  const st = ensure(ctx);
  const args = [CLI, 'dead-zone', '--role', st.role, '--model', st.model, '--endpoint-url', st.endpointUrl];
  return new Promise((resolve) => {
    const child = spawn('bb', args, { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => {
      st.exitCode = code;
      st.stdout = stdout;
      st.out = `${stdout}${stderr}`;
      resolve();
    });
  });
}

// ── scenario 03: the real pinned qwen against a combined fake endpoint ──

const PADDING_CHARS = 200;

function startCombinedFakeEndpoint(ctx, numCtx) {
  const st = ensure(ctx);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/api/show') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ parameters: `num_ctx                        ${numCtx}\nstop                            "</s>"` }));
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
      st.port = server.address().port;
      st.endpointUrl = `http://127.0.0.1:${st.port}/v1`;
      resolve();
    });
  });
}

// qwen reads its own contextWindowSize from the project-level settings
// file's modelProviders.openai entry, written AHEAD of time by
// write_local_model_qwen_settings/local_model_qwen_provider_cli.bb (BL-1838)
// - never by live-querying /api/show itself at runtime (confirmed: without
// this write, qwen falls back to a built-in default of 200000 regardless
// of what the fake endpoint's /api/show reports). Sourced from the real
// swarmforge.sh and eval'd, same posture as BL-1801's own step handler for
// check_local_model_seat_windows.
function writeQwenSettings(ctx, cwd) {
  const st = ensure(ctx);
  const script = `source '${SWARMFORGE_SH}'; write_local_model_qwen_settings '${cwd}' '${st.model}' '${st.endpointUrl}' '' '${st.role}'`;
  // A SYNCHRONOUS spawn would block this process's own event loop, and the
  // combined fake endpoint above runs in this same process - the write's
  // own served-window probe (a curl call from a child this spawnSync would
  // have blocked on) could then never reach it (BL-1801's own step
  // handler documents the identical gotcha for its CLI spawn). Async,
  // awaited, keeps the event loop free to service the fake endpoint.
  return new Promise((resolve, reject) => {
    const child = spawn('zsh', ['-f', '-c', script], { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`writeQwenSettings failed: ${stdout}${stderr}`));
      } else {
        resolve();
      }
    });
    child.on('error', reject);
  });
}

// Runs the REAL pinned qwen binary with --debug, HOME scoped to a
// throwaway fixture dir (never the operator's own ~/.qwen), against the
// combined fake endpoint above - never the live Ollama. The history is
// short on purpose (the feature's own wording): qwen's cheap-gate debug
// line reports its trigger even on a tiny history (the hardener's own
// evidence: "effectiveTokens=2689 ... auto=16152" for a ~200-char prompt).
async function runQwenCompactionCheck(ctx) {
  const st = ensure(ctx);
  const home = trackedTmpRoot('bl1840-home-');
  const cwd = trackedTmpRoot('bl1840-cwd-');
  st.home = home;
  await writeQwenSettings(ctx, cwd);
  const prompt = `MARKER-ONLY ${'x'.repeat(PADDING_CHARS)}`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      'qwen',
      ['--debug', '--auth-type', 'openai', '-y', '-m', st.model, '--openai-base-url', st.endpointUrl, '--openai-api-key', 'fixture', '-p', prompt],
      { cwd, env: { ...process.env, HOME: home, OPENAI_API_KEY: 'fixture' }, timeout: 60000 }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => {
      st.qwenExitCode = code;
      st.qwenOutput = `${stdout}${stderr}`;
      // qwen's --debug writes to a file under HOME's own .qwen/debug/, not
      // to stdout/stderr ("Logging to: <path>" is the only trace of it on
      // the console) - the [compaction] cheap-gate line lives there.
      const debugDir = path.join(home, '.qwen', 'debug');
      let debugLog = '';
      try {
        const files = fs.readdirSync(debugDir).map((f) => path.join(debugDir, f));
        for (const f of files) {
          debugLog += fs.readFileSync(f, 'utf8');
        }
      } catch {
        // no debug dir at all - debugLog stays empty, the assertion step
        // reports it plainly.
      }
      st.qwenDebugLog = debugLog;
      resolve();
    });
    child.on('error', reject);
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── 01/02 ──────────────────────────────────────────────────────────────
  scoped(/^a local-model seat whose model Ollama serves with num_ctx (\d+)$/, async (ctx, numCtx) => {
    ensure(ctx);
    await startFakeOllama(ctx, Number(numCtx));
  });

  scoped(/^the launch's window gate checks the seat$/, async (ctx) => {
    await runDeadZoneCheck(ctx);
    stopFakeOllama(ctx);
  });

  scoped(/^the gate reports a compaction trigger of (\d+) tokens$/, (ctx, trigger) => {
    const st = ensure(ctx);
    assert.equal(st.stdout.trim(), `TRIGGER: ${trigger}`, `expected TRIGGER: ${trigger}, got: ${st.out}`);
  });

  scoped(/^the gate (flags|does not flag) the window as in qwen's compaction dead zone$/, (ctx, verdict) => {
    const st = ensure(ctx);
    if (verdict === 'flags') {
      assert.equal(st.exitCode, 1, `expected exit 1 (flagged, refused), got ${st.exitCode}: ${st.out}`);
      assert.match(st.out, /^REFUSE:/m, `expected a REFUSE line, got: ${st.out}`);
    } else {
      assert.equal(st.exitCode, 0, `expected exit 0 (not flagged), got ${st.exitCode}: ${st.out}`);
      assert.doesNotMatch(st.out, /^REFUSE:/m, `expected no REFUSE line, got: ${st.out}`);
    }
  });

  scoped(/^the launch is refused$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.exitCode, 1, `expected exit 1, got ${st.exitCode}: ${st.out}`);
    assert.match(st.out, /^REFUSE:/m, `expected a REFUSE line, got: ${st.out}`);
  });

  scoped(/^the refusal names the window (\d+), the trigger (\d+), and the windows (\d+) and (\d+)$/, (ctx, window, trigger, lo, hi) => {
    const st = ensure(ctx);
    for (const n of [window, trigger, lo, hi]) {
      assert.ok(st.out.includes(n), `expected the refusal to name ${n}, got: ${st.out}`);
    }
  });

  // ── 03 ─────────────────────────────────────────────────────────────────
  scoped(/^the pinned qwen running against a loopback fake endpoint that serves num_ctx (\d+)$/, async (ctx, numCtx) => {
    ensure(ctx);
    await startCombinedFakeEndpoint(ctx, Number(numCtx));
  });

  scoped(/^qwen logs its compaction check for a short history$/, async (ctx) => {
    await runQwenCompactionCheck(ctx);
    stopFakeOllama(ctx);
  });

  scoped(/^qwen's own logged trigger is (\d+) tokens$/, (ctx, trigger) => {
    const st = ensure(ctx);
    const m = /\[compaction\] cheap-gate[^\n]*auto=(\d+)/.exec(st.qwenDebugLog);
    assert.ok(m, `expected a [compaction] cheap-gate ... auto=<n> debug line, got debug log: ${st.qwenDebugLog}\nconsole: ${st.qwenOutput}`);
    assert.equal(m[1], trigger, `expected qwen's own logged trigger to be ${trigger}, got ${m[1]}`);
  });
}

module.exports = { registerSteps };
