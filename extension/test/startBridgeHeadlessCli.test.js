const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const { parseCliArgs, runLogPath, main } = require('../out/tools/start-bridge-headless');

// ── parseCliArgs (pure) ───────────────────────────────────────────────────

test('parseCliArgs returns the target path and a parsed port when both are given', () => {
  assert.deepEqual(parseCliArgs(['/some/target', '8765']), { targetPath: '/some/target', port: 8765 });
});

test('parseCliArgs returns null when no arguments are given', () => {
  assert.equal(parseCliArgs([]), null);
});

test('parseCliArgs returns null when only the target path is given', () => {
  assert.equal(parseCliArgs(['/some/target']), null);
});

test('parseCliArgs returns null for a non-numeric port', () => {
  assert.equal(parseCliArgs(['/some/target', 'not-a-port']), null);
});

test('parseCliArgs returns null for a zero or negative port', () => {
  assert.equal(parseCliArgs(['/some/target', '0']), null);
  assert.equal(parseCliArgs(['/some/target', '-1']), null);
});

// ── runLogPath (pure) ─────────────────────────────────────────────────────

test('runLogPath resolves under the user home, matching extension.ts\'s own swarmforge.startBridge command', () => {
  assert.equal(runLogPath(), path.join(os.homedir(), '.swarmforge', 'runs.jsonl'));
});

// ── main() wiring ────────────────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'start-bridge-headless.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-start-bridge-headless-'));
}

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see the argv/env guard branches a subprocess-only smoke test
// cannot (the engineering article's CLI main()-thin-wrapper rule). main()
// reads process.argv/BRIDGE_TOKEN directly (no parameters) and writes via
// process.stdout.write/process.stderr.write directly (not console.log, so
// no Vitest console-interception gap here) - both are intercepted and
// restored in a finally, along with process.argv, BRIDGE_TOKEN, and
// process.exitCode (main() sets process.exitCode rather than calling
// process.exit(), so it never throws on the usage-guard path; a thrown
// error, e.g. a missing BRIDGE_TOKEN, is caught here and folded into the
// SAME "Fatal error: <message>" shape runCliMain's own reportFatalAndExit
// would have produced on stderr for a real standalone run). Never called
// with args that would let this reach the real startBridge() network path -
// that stays behind the one subprocess smoke test below.
async function runCli(target, port, overrides = {}) {
  const previousArgv = process.argv;
  const previousToken = process.env.BRIDGE_TOKEN;
  const previousExitCode = process.exitCode;
  const stdoutChunks = [];
  const stderrChunks = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    stdoutChunks.push(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    stderrChunks.push(chunk);
    return true;
  };
  const args = [target, port].filter((v) => v !== undefined).map(String);
  process.argv = ['node', CLI_PATH, ...args];
  if (overrides.BRIDGE_TOKEN === undefined) delete process.env.BRIDGE_TOKEN;
  else process.env.BRIDGE_TOKEN = overrides.BRIDGE_TOKEN;
  process.exitCode = undefined;

  let exitCode = 0;
  try {
    await main();
    exitCode = process.exitCode ?? 0;
  } catch (error) {
    stderrChunks.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
    exitCode = 1;
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    if (previousToken === undefined) delete process.env.BRIDGE_TOKEN;
    else process.env.BRIDGE_TOKEN = previousToken;
  }
  return { exitCode, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

test('no args: exits non-zero and prints usage to stderr', async () => {
  const result = await runCli();
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Usage: start-bridge-headless\.js/);
});

test('a missing BRIDGE_TOKEN exits non-zero with a clear message, never a raw network error', async () => {
  const target = mkTmp();
  const result = await runCli(target, 8765, { BRIDGE_TOKEN: '' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /BRIDGE_TOKEN is not set/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary, and the ONLY safe place
// to actually bind a real port and serve a real HTTP request) - an ADDITION
// to the in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result: given a real BRIDGE_TOKEN and a free port, the CLI actually starts listening and serves an authorized route', async () => {
  const target = mkTmp();
  const port = 20000 + Math.floor(Math.random() * 10000);
  const token = 'fake-headless-bridge-token';
  const child = spawn('node', [CLI_PATH, target, String(port)], { env: { ...process.env, BRIDGE_TOKEN: token } });
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  try {
    // Poll briefly for the CLI's own "listening" line rather than a fixed
    // sleep - bounded, no real indefinite wait.
    const deadline = Date.now() + 5000;
    while (!stdout.includes('BRIDGE_LISTENING') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(stdout, new RegExp(`BRIDGE_LISTENING port=${port}`));

    const res = await fetch(`http://127.0.0.1:${port}/pipeline`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);

    const unauthorized = await fetch(`http://127.0.0.1:${port}/pipeline`);
    assert.equal(unauthorized.status, 401);
  } finally {
    child.kill();
  }
});
