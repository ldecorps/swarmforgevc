/**
 * trace-hop CLI entry point (main) — main() takes argv directly (no
 * process.argv reading) but calls process.exit() on every error path, with
 * no `return` after the call (it relies on process.exit() actually
 * terminating the process). Running that in-process unmocked would kill the
 * Vitest worker outright - every other test file shares this one worker
 * process. Instead, process.exit is stubbed to THROW a recognizable signal
 * rather than terminate: the throw unwinds the call stack immediately, the
 * same way a real process exit would (no fallthrough to the next line), and
 * main()'s own top-level try/catch may see it too (a catch block catches
 * ANY thrown value, including this one) - harmless here since every
 * assertion below is a stderr SUBSTRING match, not exact-equality, so an
 * extra "Fatal error: process.exit(1)" tail line from that re-catch never
 * breaks an assertion. Genuinely thrown errors (e.g. a real fs failure)
 * still produce the CLI's own real "Fatal error: <message>" text exactly as
 * before. Only ONE test at the end keeps the real subprocess spawn, locking
 * the compiled CLI's own argv/env/exit-code wiring end to end.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');
const { main } = require('../out/tools/trace-hop');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'trace-hop.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-tracehop-cli-'));
}

function runCliSubprocess(args, envOverrides) {
  const tracesDir = envOverrides.SWARMFORGE_TRACES_DIR ?? mkTmp();
  const env = {
    ...process.env,
    SWARMFORGE_TRACES_DIR: tracesDir,
    ...envOverrides,
  };
  delete env.SWARMFORGE_ROLE;
  if (envOverrides.SWARMFORGE_ROLE) {
    env.SWARMFORGE_ROLE = envOverrides.SWARMFORGE_ROLE;
  }
  const result = spawnSync('node', [CLI_PATH, ...args], { encoding: 'utf8', env });
  return { ...result, tracesDir };
}

class ProcessExitSignal extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

// Runs the REAL main(argv) in-process against a real fixture traces dir, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot. main() writes every message via
// console.error (never process.stdout/stderr.write directly) - under
// Vitest, console.error does NOT route through process.stderr.write (it is
// intercepted separately for the runner's own reporting), so console.error
// itself must be stubbed here or the capture would silently see nothing.
// SWARMFORGE_ROLE/SWARMFORGE_TRACES_DIR and cwd (git-common-dir resolution
// reads process.cwd() when SWARMFORGE_TRACES_DIR is unset) are all saved
// and restored in the finally - non-negotiable, since Vitest runs every
// test file in one shared worker process.
function runMainInProcess(args, { role, tracesDir, cwd } = {}) {
  const previousCwd = process.cwd();
  const previousRole = process.env.SWARMFORGE_ROLE;
  const previousTracesDir = process.env.SWARMFORGE_TRACES_DIR;
  const previousExit = process.exit;
  const previousConsoleError = console.error;
  const stderrChunks = [];

  if (role === undefined) delete process.env.SWARMFORGE_ROLE;
  else process.env.SWARMFORGE_ROLE = role;
  if (tracesDir === undefined) delete process.env.SWARMFORGE_TRACES_DIR;
  else process.env.SWARMFORGE_TRACES_DIR = tracesDir;

  console.error = (...args2) => {
    stderrChunks.push(args2.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  process.exit = (code) => {
    throw new ProcessExitSignal(code ?? 0);
  };

  let status = 0;
  try {
    if (cwd) {
      process.chdir(cwd);
    }
    main(args);
  } catch (error) {
    if (error instanceof ProcessExitSignal) {
      status = error.code;
    } else {
      throw error;
    }
  } finally {
    console.error = previousConsoleError;
    process.exit = previousExit;
    process.chdir(previousCwd);
    if (previousRole === undefined) delete process.env.SWARMFORGE_ROLE;
    else process.env.SWARMFORGE_ROLE = previousRole;
    if (previousTracesDir === undefined) delete process.env.SWARMFORGE_TRACES_DIR;
    else process.env.SWARMFORGE_TRACES_DIR = previousTracesDir;
  }

  return { status, stderr: stderrChunks.join('\n') };
}

// Matches runCliSubprocess's own signature/shape (args, envOverrides) so
// the tests below barely change beyond the helper name: SWARMFORGE_TRACES_DIR
// is auto-provisioned via mkTmp() unless overridden, and the returned shape
// mirrors spawnSync's own {status, stderr, tracesDir}.
function runCli(args, envOverrides) {
  const tracesDir = envOverrides.SWARMFORGE_TRACES_DIR ?? mkTmp();
  const result = runMainInProcess(args, { role: envOverrides.SWARMFORGE_ROLE, tracesDir });
  return { ...result, tracesDir };
}

test('main exits 1 when SWARMFORGE_ROLE is not set', () => {
  const result = runCli(['abc123', 'receive'], {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SWARMFORGE_ROLE is not set/);
});

test('main exits 1 when traceId or command is missing', () => {
  const result = runCli(['abc123'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: trace-hop\.js/);
});

test('main rejects a traceId with path traversal', () => {
  const result = runCli(['../etc/passwd', 'receive'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid traceId/);
});

test('main rejects a traceId with a path separator', () => {
  const result = runCli(['foo/bar', 'receive'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid traceId/);
});

test('main rejects an unknown command', () => {
  const result = runCli(['abc123', 'bogus'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command "bogus"/);
});

test('main requires a decision argument for decide', () => {
  const result = runCli(['abc123', 'decide'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: trace-hop\.js <traceId> decide/);
});

test('main requires a reason argument for retry', () => {
  const result = runCli(['abc123', 'retry'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: trace-hop\.js <traceId> retry/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary, a real process.exit())
// - an ADDITION to the in-process tests around it, never the only cover for
// the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result: main writes HOP and STATE_CHANGE lines for receive', () => {
  const result = runCliSubprocess(['trace-1', 'receive'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 0);
  const logPath = path.join(result.tracesDir, 'trace-1.log');
  const content = fs.readFileSync(logPath, 'utf8');
  assert.match(content, /^HOP coder .+ action=receive state=received$/m);
  assert.match(content, /^STATE_CHANGE coder .+ received->coding$/m);
});

test('main writes a DECISION line for decide with detail', () => {
  const result = runCli(['trace-2', 'decide', 'forward_to_cleaner', 'looks good'], {
    SWARMFORGE_ROLE: 'coder',
  });
  assert.equal(result.status, 0);
  const content = fs.readFileSync(path.join(result.tracesDir, 'trace-2.log'), 'utf8');
  assert.match(content, /^DECISION coder .+ decision=forward_to_cleaner details="looks good"$/m);
});

test('main writes an incrementing attempt number across repeated retries', () => {
  const tracesDir = mkTmp();
  const first = runCli(['trace-3', 'retry', 'flaky test'], {
    SWARMFORGE_ROLE: 'coder',
    SWARMFORGE_TRACES_DIR: tracesDir,
  });
  assert.equal(first.status, 0);
  const second = runCli(['trace-3', 'retry', 'flaky test again'], {
    SWARMFORGE_ROLE: 'coder',
    SWARMFORGE_TRACES_DIR: tracesDir,
  });
  assert.equal(second.status, 0);

  const content = fs.readFileSync(path.join(tracesDir, 'trace-3.log'), 'utf8');
  assert.match(content, /^RETRY coder .+ attempt=1 reason="flaky test"$/m);
  assert.match(content, /^RETRY coder .+ attempt=2 reason="flaky test again"$/m);
});

// ── BL-133: resolveTracesDir over a real git checkout, end to end ──────────
// Every test above pins SWARMFORGE_TRACES_DIR, which bypasses the exact git
// resolution path production runs with the env var unset - none of them
// would have caught BL-133 (the master/coordinator checkout landing traces
// one directory ABOVE the real repo root). SWARMFORGE_TRACES_DIR is
// deliberately left unset (tracesDir: undefined) so resolveTracesDir falls
// back to its real git-common-dir resolution against the given cwd, exactly
// as the subprocess's own cwd option did.

test('BL-133 master-checkout-01: a hop from the master checkout lands in the pre-seeded repo-rooted trace log, not one level above the repo', () => {
  const repoRoot = fs.realpathSync(mkTmp());
  execSync('git init -q', { cwd: repoRoot });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: repoRoot });

  const tracesDir = path.join(repoRoot, '.swarmforge', 'traces');
  fs.mkdirSync(tracesDir, { recursive: true });
  const logPath = path.join(tracesDir, 'trace-133.log');
  fs.writeFileSync(logPath, 'SEED trace-133\n');

  const result = runMainInProcess(['trace-133', 'receive'], { role: 'coordinator', tracesDir: undefined, cwd: repoRoot });

  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(logPath, 'utf8');
  assert.match(content, /^HOP coordinator .+ action=receive state=received$/m);

  // The literal historical symptom (BL-133): a stray .swarmforge one level
  // above the repo root instead of inside it.
  const strayDir = path.join(path.dirname(repoRoot), '.swarmforge');
  assert.equal(fs.existsSync(strayDir), false, 'no .swarmforge directory must be created outside the repository');
});

test('BL-133 worktree-still-works-02: a hop from a linked worktree still lands in the main repo-rooted trace log', () => {
  const mainRepo = fs.realpathSync(mkTmp());
  execSync('git init -q', { cwd: mainRepo });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: mainRepo });
  const worktreePath = path.join(fs.realpathSync(mkTmp()), 'linked-worktree');
  execSync(`git worktree add -q -b sfvc-test-bl133 "${worktreePath}"`, { cwd: mainRepo });

  const tracesDir = path.join(mainRepo, '.swarmforge', 'traces');
  fs.mkdirSync(tracesDir, { recursive: true });
  const logPath = path.join(tracesDir, 'trace-133b.log');
  fs.writeFileSync(logPath, 'SEED trace-133b\n');

  const result = runMainInProcess(['trace-133b', 'receive'], { role: 'coder', tracesDir: undefined, cwd: worktreePath });

  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(logPath, 'utf8');
  assert.match(content, /^HOP coder .+ action=receive state=received$/m);
});

test('main reports a fatal error when the trace log cannot be written', () => {
  const tracesDir = mkTmp();
  fs.chmodSync(tracesDir, 0o555);
  try {
    const result = runCli(['trace-4', 'receive'], {
      SWARMFORGE_ROLE: 'coder',
      SWARMFORGE_TRACES_DIR: tracesDir,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Fatal error: Failed to append to trace log/);
  } finally {
    fs.chmodSync(tracesDir, 0o755);
  }
});
