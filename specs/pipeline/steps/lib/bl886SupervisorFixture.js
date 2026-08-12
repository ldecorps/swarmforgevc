'use strict';

// BL-886: shared real-process fixture helpers for exercising
// handoffd_supervisor.bb's crash-orphan job reaper end to end (the landed
// hotfix under review, commit 602c7d014). handoffd_supervisor.bb
// self-executes (-main) on load, so it cannot be load-file'd for a JSON
// bridge the way orphan_janitor_sweep_lib.bb can (see
// bl886_vitest_orphan_reaper_acceptance_runner.bb's own header) - the only
// way to exercise its reap decision is the real `bb handoffd_supervisor.bb
// <root> --check-once` CLI against a real process, same pattern
// test_handoffd_supervisor_job_reaper.sh already established.
//
// Used by both bl886VitestOrphanReaperHotfixSteps.js (acceptance scenarios
// 01-03) and bl886_vitest_orphan_reaper_supervisor_property_runner.js (the
// BL-654 property test for invariants 1 and 2), so the fixture-spawning
// mechanics live in exactly one place.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SUPERVISOR_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd_supervisor.bb');

function mkTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// Mirrors test_handoffd_supervisor_job_reaper.sh's make_fixture(): a project
// root with a healthy tracked daemon (own pid + fresh heartbeat), so
// reap-orphaned-job-processes! is exercised independent of the dead/stalled
// restart-and-alarm path (BL-081 scenario 05's own precedent), and one
// registered worktree in roles.tsv so job-scope-paths has a real worktree to
// match against.
function makeFixtureRoot() {
  const root = mkTmp('bl886-supervisor-root-');
  const daemonDir = path.join(root, '.swarmforge', 'daemon');
  const coderWt = path.join(root, '.worktrees', 'coder');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.mkdirSync(path.join(coderWt, 'extension'), { recursive: true });
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'outbox'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  fs.writeFileSync(path.join(daemonDir, 'handoffd.pid'), String(process.pid));
  fs.writeFileSync(path.join(daemonDir, 'handoffd.heartbeat'), '');
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const tmuxStub = path.join(binDir, 'tmux');
  fs.writeFileSync(tmuxStub, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(tmuxStub, 0o755);
  return { root, coderWt, binDir };
}

// A real, disposable child whose argv0 is set to the exact cmdline shape
// under test (Node's spawn `argv0` option, same effect as the shell
// fixture's `exec -a NAME ...` trick) - stays parented to THIS process
// (spawn's normal PPID, never reparented), proving the "alive parent"
// half of every scenario against a genuinely live process, not a stubbed
// PPID value.
function spawnOwnedFixture({ cwd, cmdline }) {
  const child = spawn('sleep', ['3600'], { cwd, argv0: cmdline, stdio: 'ignore', detached: true });
  return { pid: child.pid, child };
}

// A real crash-orphaned process: forks via python3 (same double-detach
// trick test_handoffd_supervisor_job_reaper.sh already established - Node
// has no raw fork() of its own), the immediate parent exits so the child
// genuinely reparents to launchd/init (PPID 1), then execs into `sleep`
// with argv0 set to the cmdline shape under test. Polls real `ps` until
// the reparent has actually happened before returning, never assumed.
async function spawnOrphanFixture({ cwd, cmdline }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bl886-orphan-spawn-'));
  const pidFile = path.join(scratch, 'pid');
  const script = path.join(scratch, 'spawn.py');
  fs.writeFileSync(
    script,
    [
      'import os, sys',
      'pid_file, target_cwd, cmdline_name = sys.argv[1:4]',
      'if os.fork() > 0:',
      '    sys.exit(0)',
      'os.setpgrp()',
      'os.chdir(target_cwd)',
      'with open(pid_file, "w") as f:',
      '    f.write(str(os.getpid()))',
      'os.execvp("sleep", [cmdline_name, "3600"])',
      '',
    ].join('\n')
  );
  spawnSync('python3', [script, pidFile, cwd, cmdline], { stdio: 'ignore' });
  const deadline = Date.now() + 5000;
  let pid;
  while (Date.now() < deadline) {
    if (fs.existsSync(pidFile) && fs.statSync(pidFile).size > 0) {
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!pid) {
    fs.rmSync(scratch, { recursive: true, force: true });
    throw new Error('bl886: orphan fixture never wrote its pid file');
  }
  let reparented = false;
  while (Date.now() < deadline) {
    const ppid = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)]).stdout.toString().trim();
    if (ppid === '1') {
      reparented = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  if (!reparented) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    throw new Error(`bl886: orphan fixture pid ${pid} never reparented to PPID 1`);
  }
  return { pid };
}

// A zombie (defunct - reaped by the OS kernel but not yet waitpid()'d by
// its own parent) still occupies its pid slot, so `kill(pid, 0)` (and
// java.lang.ProcessHandle.isAlive(), which handoffd_supervisor.bb's own
// pid-alive? uses) both report it as "alive" even though its execution has
// already ended. Spawning an owned fixture with `detached: true` and then
// immediately blocking this process in a synchronous checkOnce() call
// leaves no opportunity for Node's own SIGCHLD handling to reap a child
// that dies mid-block - exactly the corner a deliberately-broken
// orphaned-job-groups (BL-886 non-vacuity check) walks into by killing a
// process this harness never expected to die. Treating a zombie as dead
// here (ps STAT starting with Z) matches the invariant's real meaning -
// "has this job process's execution ended" - not the OS's bookkeeping
// state.
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const stat = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)]).stdout.toString().trim();
  return !stat.startsWith('Z');
}

function killFixture(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

// Real `bb handoffd_supervisor.bb <root> --check-once` - the actual
// reviewed CLI, exercising reap-orphaned-job-processes! -> orphaned-job-
// groups -> job-in-scope? / job-process-pattern /
// process-table-lib/parent-orphaned? end to end, never a reimplementation.
function checkOnce(root, binDir) {
  spawnSync('bb', [SUPERVISOR_SCRIPT, root, '--check-once'], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      SUPERVISOR_STALL_MS: '500',
      SUPERVISOR_KILL_TIMEOUT_MS: '2000',
    },
    stdio: 'ignore',
  });
}

function cleanupFixtureRoot(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

module.exports = {
  mkTmp,
  makeFixtureRoot,
  spawnOwnedFixture,
  spawnOrphanFixture,
  pidAlive,
  killFixture,
  checkOnce,
  cleanupFixtureRoot,
};
