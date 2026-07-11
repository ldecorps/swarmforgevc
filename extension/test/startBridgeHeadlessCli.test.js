const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const { parseCliArgs, runLogPath } = require('../out/tools/start-bridge-headless');

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

// ── subprocess: main() wiring ─────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'start-bridge-headless.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-start-bridge-headless-'));
}

test('no args: exits non-zero and prints usage to stderr', () => {
  assert.throws(() => execFileSync('node', [CLI_PATH], { encoding: 'utf8' }), /Usage: start-bridge-headless\.js/);
});

test('a missing BRIDGE_TOKEN exits non-zero with a clear message, never a raw network error', () => {
  const target = mkTmp();
  let threw = false;
  try {
    execFileSync('node', [CLI_PATH, target, '8765'], { encoding: 'utf8', env: { ...process.env, BRIDGE_TOKEN: '' }, timeout: 5000 });
  } catch (err) {
    threw = true;
    assert.match(err.stderr, /BRIDGE_TOKEN is not set/);
  }
  assert.equal(threw, true);
});

test('given a real BRIDGE_TOKEN and a free port, the CLI actually starts listening and serves an authorized route', async () => {
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
