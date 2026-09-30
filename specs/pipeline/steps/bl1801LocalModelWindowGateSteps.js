'use strict';

// BL-1801: step handlers for "A local-model seat never launches past its
// served window". Drives the REAL local_model_window_gate_cli.bb (and,
// for the no-local-model-seat scenario, the REAL check_local_model_seat_windows
// shell function sourced from swarmforge.sh) against a fake Ollama - a
// real node http server, never the live one, never port 11434.
//
// prompt_engine_lib.bb's repo-root is derived from ITS OWN file location,
// never overridable to a fixture root (verified: no --target/env seam
// exists), so a fixture cannot make the real prompt_engine_cli.bb compose
// produce an EXACT character count without editing this repo's own
// swarmforge/roles/local-model/coder.note - which no test may do. Scenarios
// 01-04 (about the decision over a stated composed-character count) drive
// the CLI directly with a synthetic fixture prompt file of that exact
// size, per the ticket's own scenario note ("fixture prompt files").
// Scenario 05 (about the LOOP over AGENTS[] finding no local-model seat)
// drives the real shell function instead, since that is the one behaviour
// the CLI alone cannot demonstrate.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1801 A local-model seat never launches past its served window';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_model_window_gate_cli.bb');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const OVERHEAD_CHARS = 3000; // fixed per the ticket's own scenario note

function ensure(ctx) {
  if (!ctx.bl1801) {
    ctx.bl1801 = { role: 'coder', model: 'ista-iq3s-coder:latest', requestCount: 0 };
  }
  return ctx.bl1801;
}

function startFakeOllama(ctx) {
  const st = ensure(ctx);
  const server = http.createServer((req, res) => {
    st.requestCount += 1;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const numCtx = st.numCtx;
      const parameters =
        numCtx === undefined || numCtx === 'none' ? 'stop                            "</s>"' : `num_ctx                        ${numCtx}`;
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

function writePrompt(ctx, chars) {
  const st = ensure(ctx);
  const dir = trackedTmpRoot('bl1801-prompt-');
  const p = path.join(dir, 'prompt.txt');
  fs.writeFileSync(p, 'x'.repeat(chars));
  st.promptPath = p;
}

function runCli(ctx) {
  const st = ensure(ctx);
  const args = [
    CLI, 'check',
    '--role', st.role,
    '--model', st.model,
    '--prompt-file', st.promptPath,
    '--endpoint-url', st.endpointUrl,
    '--overhead-chars', String(OVERHEAD_CHARS),
  ];
  if (st.contextLength !== undefined) {
    args.push('--context-length', st.contextLength);
  }
  if (st.override) {
    args.push('--override', '1');
  }
  // BL-1801: spawnSync would block THIS process's own event loop, and the
  // fake Ollama server above runs in this same process - a synchronous
  // spawn can never let the server accept the CLI's incoming curl
  // request, so the request times out and the window reads as unknown no
  // matter what num_ctx was configured. Async spawn, awaited, keeps the
  // event loop free to service the fake server while the CLI runs.
  return new Promise((resolve) => {
    const child = spawn('bb', args, { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => {
      st.exitCode = code;
      st.out = `${stdout}${stderr}`;
      resolve();
    });
  });
}

// ── Scenario 05: the real shell function, no local-model seat at all ────
function mkNoLocalModelFixtureRoot() {
  const root = trackedTmpRoot('bl1801-nolm-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['coder', 'QA', 'coordinator', 'specifier']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'window coder claude coder\n');
  return root;
}

const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function runNoLocalModelCheck(ctx) {
  const st = ensure(ctx);
  const root = mkNoLocalModelFixtureRoot();
  const r = spawnSync(
    'zsh',
    ['-f', '-c', `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${INDEX_OF_ROLE} check_local_model_seat_windows`],
    {
      encoding: 'utf8',
      env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1', SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL: st.endpointUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  st.exitCode = r.status;
  st.out = `${r.stdout || ''}${r.stderr || ''}`;
}

const OUTCOME_CHECKS = new Map([
  [
    'proceeds with no window message',
    (ctx) => {
      const st = ensure(ctx);
      assert.equal(st.exitCode, 0, `expected exit 0, got ${st.exitCode}: ${st.out}`);
      assert.equal(st.out.trim(), '', `expected no output, got: ${st.out}`);
    },
  ],
  [
    'warns and proceeds',
    (ctx) => {
      const st = ensure(ctx);
      assert.equal(st.exitCode, 0, `expected exit 0, got ${st.exitCode}: ${st.out}`);
      assert.match(st.out, /^WARN:/, `expected a WARN line, got: ${st.out}`);
    },
  ],
  [
    'refuses the launch before any pane starts',
    (ctx) => {
      const st = ensure(ctx);
      assert.equal(st.exitCode, 1, `expected exit 1, got ${st.exitCode}: ${st.out}`);
      assert.match(st.out, /^REFUSE:/, `expected a REFUSE line, got: ${st.out}`);
    },
  ],
  [
    'warns that the window is unknown and proceeds',
    (ctx) => {
      const st = ensure(ctx);
      assert.equal(st.exitCode, 0, `expected exit 0, got ${st.exitCode}: ${st.out}`);
      assert.match(st.out, /^WARN:/, `expected a WARN line, got: ${st.out}`);
      assert.match(st.out, /unknown/, `expected the warning to say unknown, got: ${st.out}`);
    },
  ],
  [
    'warns that the override let an over-window seat start, and proceeds',
    (ctx) => {
      const st = ensure(ctx);
      assert.equal(st.exitCode, 0, `expected exit 0, got ${st.exitCode}: ${st.out}`);
      assert.match(st.out, /^WARN:/, `expected a WARN line, got: ${st.out}`);
      assert.match(st.out, /SWARMFORGE_LOCAL_WINDOW_OVERRIDE/, `expected the override to be named, got: ${st.out}`);
    },
  ],
]);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pack whose coder seat runs the "local-model" agent against a fake Ollama$/, async (ctx) => {
    ensure(ctx);
    await startFakeOllama(ctx);
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => stopFakeOllama(ctx));
  });

  scoped(/^the fake Ollama reports num_ctx "([^"]+)" for the coder's model$/, (ctx, numCtx) => {
    ensure(ctx).numCtx = numCtx;
  });

  scoped(/^the coder's composed first turn is (\d+) characters and the recorded CLI overhead is 3000 characters$/, (ctx, chars) => {
    writePrompt(ctx, Number(chars));
  });

  scoped(/^the swarm started Ollama with context length "([^"]+)"$/, (ctx, len) => {
    ensure(ctx).contextLength = len;
  });

  scoped(/^SWARMFORGE_LOCAL_WINDOW_OVERRIDE is 1$/, (ctx) => {
    ensure(ctx).override = true;
  });

  scoped(/^a pack whose seats all run the "claude" agent$/, (ctx) => {
    ensure(ctx).noLocalModelSeat = true;
  });

  scoped(/^the launch checks the local-model seats' windows$/, async (ctx) => {
    const st = ensure(ctx);
    if (st.noLocalModelSeat) {
      runNoLocalModelCheck(ctx);
    } else {
      await runCli(ctx);
    }
  });

  scoped(/^it "([^"]+)"$/, (ctx, outcome) => {
    const check = OUTCOME_CHECKS.get(outcome);
    assert.ok(check, `unrecognized outcome: ${outcome}`);
    check(ctx);
  });

  scoped(/^the fake Ollama received no request$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.requestCount, 0, `expected no request to the fake Ollama, got ${st.requestCount}`);
  });
}

module.exports = { registerSteps };
