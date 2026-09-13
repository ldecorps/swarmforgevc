'use strict';

// BL-1498: step handlers for "the supervisor test is green under the
// operator's zsh startup files and the startup grace". Scenario 01 stages a
// HOSTILE zsh startup file of its own (the fixture-must-isolate assertion:
// a fixture that does not export ZDOTDIR fails this exactly as main did on
// 2026-09-08). Scenario 02 drives the real --check-once path directly over
// a mkdtemp root with the daemon's pid file aged per outline row (the
// bl977 fixture shape). Scenario 03 runs the real shell file with the
// process environment untouched - the operator's own ~/.zshenv in place -
// and asserts it exits zero.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SUPERVISOR_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_handoffd_supervisor.sh');
const SUPERVISOR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd_supervisor.bb');

const FEATURE = "BL-1498 The supervisor test is green under the operator's zsh startup files and the startup grace";

const STALL_MS = 500;

const KNOWN_AGES = new Set(['younger', 'older']);
const KNOWN_STATES = new Set(['healthy', 'halted']);
const KNOWN_FATES = new Set(['still alive', 'terminated']);

let trackedRoots = [];
let trackedPids = [];
let trackedZdotdirs = [];

function baseEnv() {
  const env = { ...process.env };
  delete env.RESEND_API_KEY;
  return env;
}

function cleanup() {
  while (trackedPids.length) {
    const pid = trackedPids.pop();
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
  while (trackedZdotdirs.length) {
    fs.rmSync(trackedZdotdirs.pop(), { recursive: true, force: true });
  }
}

// ── Scenario 01: hostile ZDOTDIR ────────────────────────────────────────────
function stageHostileZdotdir() {
  const zdotdir = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'bl1498-zdotdir-')));
  trackedZdotdirs.push(zdotdir);
  const hostileBin = path.join(zdotdir, 'bin');
  fs.mkdirSync(hostileBin, { recursive: true });
  const hostileTmux = path.join(hostileBin, 'tmux');
  // Logs nowhere - the whole point is that the fixture's own ZDOTDIR must
  // win before this one is ever reached.
  fs.writeFileSync(hostileTmux, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(hostileTmux, 0o755);
  fs.writeFileSync(path.join(zdotdir, '.zshenv'), `export PATH="${hostileBin}:$PATH"\n`);
  return zdotdir;
}

function runSupervisorTest(env) {
  const res = spawnSync('bash', [SUPERVISOR_TEST], { encoding: 'utf8', env, timeout: 180000 });
  return { status: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
}

// ── Scenario 02: real --check-once over a mkdtemp fixture ──────────────────
function mkSupervisorFixture(ctx) {
  ctx.root = fs.realpathSync(mkSocketFixtureRoot('bl1498-'));
  trackedRoots.push(ctx.root);
  ctx.daemonDir = path.join(ctx.root, '.swarmforge', 'daemon');
  const coderWt = path.join(ctx.root, '.worktrees', 'coder');
  ctx.outboxDir = path.join(coderWt, '.swarmforge', 'handoffs', 'outbox');
  fs.mkdirSync(ctx.daemonDir, { recursive: true });
  fs.mkdirSync(ctx.outboxDir, { recursive: true });
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'tmux-socket'), `${ctx.root}/fake.sock\n`);
  fs.writeFileSync(path.join(ctx.root, 'fake.sock'), '');
  fs.writeFileSync(
    path.join(ctx.root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  const fakeBin = path.join(ctx.root, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeTmux = path.join(fakeBin, 'tmux');
  fs.writeFileSync(fakeTmux, `#!/usr/bin/env bash\nexit 0\n`);
  fs.chmodSync(fakeTmux, 0o755);
  spawnSync(fakeTmux, [], { encoding: 'utf8' });
  ctx.fakeBin = fakeBin;

  // A live placeholder "daemon" - alive, but not the tracked daemon.
  const child = spawn('sleep', ['300'], { detached: false, stdio: 'ignore' });
  trackedPids.push(child.pid);
  ctx.hungPid = child.pid;
  fs.writeFileSync(path.join(ctx.daemonDir, 'handoffd.pid'), `${child.pid}\n`);

  const outboxFile = path.join(ctx.outboxDir, '50_bl1498.handoff');
  fs.writeFileSync(outboxFile, 'id: t\nfrom: coder\nto: coder\npriority: 50\ntype: note\nmessage: hello\n\nhello\n');
  const stalledSec = (Date.now() - (STALL_MS + 30000)) / 1000;
  fs.utimesSync(outboxFile, stalledSec, stalledSec);
  const hb = path.join(ctx.daemonDir, 'handoffd.heartbeat');
  fs.writeFileSync(hb, '');
  fs.utimesSync(hb, stalledSec, stalledSec);
}

function ageOrRefreshPidFile(ctx, ageToken) {
  const pidFile = path.join(ctx.daemonDir, 'handoffd.pid');
  if (ageToken === 'older') {
    const oldSec = new Date('2026-01-01T00:00:00Z').getTime() / 1000;
    fs.utimesSync(pidFile, oldSec, oldSec);
  }
  // "younger": leave the pid file at its just-written mtime.
}

function runCheckOnce(ctx) {
  const env = baseEnv();
  env.SUPERVISOR_STALL_MS = String(STALL_MS);
  env.SWARMFORGE_TERMINAL_BACKEND = 'none';
  env.SWARMFORGE_ALLOW_TMP_DAEMON = '1';
  env.SUPERVISOR_RESTART_BUDGET_COUNT = '0';
  env.PATH = `${ctx.fakeBin}:${env.PATH}`;
  const res = spawnSync('bb', [SUPERVISOR, ctx.root, '--check-once'], { encoding: 'utf8', env });
  return { status: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
}

function statusState(ctx) {
  const p = path.join(ctx.daemonDir, 'handoffd.status.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')).state;
}

function pidAlive(pid) {
  // kill(pid, 0) reports true for a ZOMBIE - the kernel still carries the
  // pid until this process (its parent) reaps it, which a synchronous
  // spawnSync call blocks from happening on Node's own event loop. The
  // supervisor confirms the kill by waiting on the pid itself (any
  // process, not just its own children) via ProcessHandle, so a zombie
  // here means the supervisor's SIGTERM/SIGKILL already succeeded - `ps`
  // reads the kernel's real state instead of relying on this process
  // having reaped its own child yet.
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const res = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  const stat = (res.stdout || '').trim();
  return stat.length > 0 && !stat.startsWith('Z');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ────────────────────────────────────────────────────────
  scoped(
    /^a zsh startup directory in the harness environment whose startup file prepends a directory holding a tmux that logs nowhere$/,
    (ctx) => {
      ctx.hostileZdotdir = stageHostileZdotdir();
    }
  );

  scoped(/^the supervisor test runs under that environment$/, (ctx) => {
    const env = baseEnv();
    env.ZDOTDIR = ctx.hostileZdotdir;
    ctx.testResult = runSupervisorTest(env);
  });

  scoped(/^it reports the dead-daemon halt case as passed$/, (ctx) => {
    assert.ok(/^PASS: 01:/m.test(ctx.testResult.output), `case 01 did not pass:\n${ctx.testResult.output}`);
  });

  scoped(/^it reports the messy-death halt case as passed$/, (ctx) => {
    assert.ok(/^PASS: 05:/m.test(ctx.testResult.output), `case 05 did not pass:\n${ctx.testResult.output}`);
  });

  // ── Scenario 02 (outline) ────────────────────────────────────────────────
  scoped(
    /^a supervisor fixture whose delivery is stalled past the window and whose pid names a live process that is not the daemon$/,
    (ctx) => {
      mkSupervisorFixture(ctx);
    }
  );

  scoped(/^the pid file is (younger|older) than one stall window$/, (ctx, ageToken) => {
    if (!KNOWN_AGES.has(ageToken)) {
      throw new Error(`unknown <pid_file_age> token: ${ageToken}`);
    }
    ageOrRefreshPidFile(ctx, ageToken);
  });

  scoped(/^the supervisor checks once$/, (ctx) => {
    ctx.checkResult = runCheckOnce(ctx);
  });

  scoped(/^the status reads (healthy|halted)$/, (ctx, state) => {
    if (!KNOWN_STATES.has(state)) {
      throw new Error(`unknown <state> token: ${state}`);
    }
    assert.equal(statusState(ctx), state, ctx.checkResult.output);
  });

  scoped(/^the lingering process is (still alive|terminated)$/, (ctx, fate) => {
    if (!KNOWN_FATES.has(fate)) {
      throw new Error(`unknown <fate> token: ${fate}`);
    }
    const alive = pidAlive(ctx.hungPid);
    assert.equal(alive, fate === 'still alive', `hung pid ${ctx.hungPid} alive=${alive}`);
  });

  // ── Scenario 03 ────────────────────────────────────────────────────────
  scoped(/^the process environment as the acceptance run inherits it$/, (ctx) => {
    ctx.inheritedEnv = baseEnv();
  });

  scoped(/^the supervisor test runs$/, (ctx) => {
    ctx.testResult = runSupervisorTest(ctx.inheritedEnv);
  });

  scoped(/^it exits zero$/, (ctx) => {
    assert.equal(ctx.testResult.status, 0, ctx.testResult.output);
  });

  scoped(/^it reports every case as passed$/, (ctx) => {
    assert.ok(/^ALL PASS$/m.test(ctx.testResult.output), `no final ALL PASS line:\n${ctx.testResult.output}`);
    assert.ok(!/^FAIL:/m.test(ctx.testResult.output), `a case failed:\n${ctx.testResult.output}`);
  });
}

process.on('exit', cleanup);

module.exports = { registerSteps };
