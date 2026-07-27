'use strict';

// BL-690: step handlers for "Ensure repairs the handoff daemon by starting
// it, never by halting the swarm". The defect: swarm_ensure.bb's daemon
// repair ran `handoffd_supervisor.bb --check-once` - a health PROBE that, on
// a dead/stalled daemon, calls alarm-and-halt! and kills every agent tmux
// session. The fix points the repair at start_handoff_daemon.sh instead (the
// same daemon-start owner the launch paths already use).
//
// Every scenario in this file runs swarm_ensure.bb with NO
// SWARM_ENSURE_SUPERVISOR_CMD override at all (runEnsure() never sets it) -
// stronger than the ticket's own minimum (only scenarios 01/06 are
// required to exercise the real default command), because that env seam is
// exactly what hid the original defect: masking it in ANY scenario here
// would risk the same blind spot recurring. Only start_handoff_daemon.sh's
// OWN inner dependents (HANDOFFD_BB / HANDOFFD_SUPERVISOR_BB) are swapped
// for fast, deterministic fakes so the tests don't depend on a real,
// full swarm install - this has no bearing on the original defect, which
// was entirely about which COMMAND swarm_ensure.bb chooses, not about
// what that command's own dependents do.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { onAbnormalExit } = require('./lib/fixtureReaper');

const FEATURE = 'Ensure repairs the handoff daemon by starting it, never by halting the swarm';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_ENSURE = path.join(SCRIPTS_DIR, 'swarm_ensure.bb');

// ── fixture-wide process/dir tracking (BL-458 posture: fixtures spawn real
// background bb processes and must be reaped even if an assertion throws or
// the runner is killed, not only on the happy path) ────────────────────────
const trackedRoots = new Set();
const trackedPids = new Set();

function reapEverything() {
  for (const pid of [...trackedPids]) {
    if (pid === process.pid) continue; // never self-kill - see trackPidFile's own guard
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already dead - fine, that's the point
    }
  }
  for (const root of [...trackedRoots]) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}
onAbnormalExit(reapEverything);

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const PID_STATE_VALUES = new Set(['absent', 'stale', 'empty', 'live']);
function knownPidState(value) {
  if (!PID_STATE_VALUES.has(value)) {
    throw new Error(`bl690 ensure-daemon-repair: unrecognized pid-file state "${value}"`);
  }
  return value;
}

function writeExec(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function daemonDir(root) {
  return path.join(root, '.swarmforge', 'daemon');
}
function pidFile(root) {
  return path.join(daemonDir(root), 'handoffd.pid');
}
function supervisorPidFile(root) {
  return path.join(daemonDir(root), 'handoffd-supervisor.pid');
}
function stopFile(root) {
  return path.join(daemonDir(root), 'stop');
}
function statusFile(root) {
  return path.join(daemonDir(root), 'handoffd.status.json');
}
function auditFile(root) {
  return path.join(daemonDir(root), 'daemon-start-audit.log');
}

function readPidFileContent(root) {
  try {
    return fs.readFileSync(pidFile(root), 'utf8').trim();
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Two live agent sessions (Background), on a fake tmux logging any
// kill-session call - the direct, independent witness that a "repair" never
// reached alarm-and-halt!'s halt-swarm!.
const SESSIONS = ['swarmforge-coder', 'swarmforge-cleaner'];

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl690-ensure-daemon-'));
  trackedRoots.add(root);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(daemonDir(root), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  for (const role of ['coder', 'cleaner']) {
    fs.mkdirSync(path.join(root, '.worktrees', role), { recursive: true });
  }
  fs.mkdirSync(bin, { recursive: true });

  const socket = path.join(root, 'fake.sock');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${socket}\n`);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${path.join(root, '.worktrees', 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `cleaner\tcleaner\t${path.join(root, '.worktrees', 'cleaner')}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n`
  );

  const killLog = path.join(root, 'tmux-kill.log');
  fs.writeFileSync(killLog, '');
  writeExec(
    path.join(bin, 'tmux'),
    '#!/usr/bin/env bash\n' +
      'if [[ "$3" == "list-panes" ]]; then echo "0"; exit 0; fi\n' +
      `if [[ "$3" == "kill-session" ]]; then echo "KILL $*" >> ${JSON.stringify(killLog)}; exit 0; fi\n` +
      'exit 0\n'
  );

  const extFake = path.join(bin, 'fake_ext.sh');
  writeExec(extFake, '#!/usr/bin/env bash\nexit 0\n');

  // Success fakes for start_handoff_daemon.sh's own inner dependents: claim
  // the pid file with a REAL live process (survives this Node process's own
  // exit the same way the existing daemon fixtures already rely on - a real
  // backgrounded/spawned process, not a piped/inherited one) and stay alive.
  const handoffdBbOk = path.join(root, 'fake_handoffd_ok.bb');
  fs.writeFileSync(
    handoffdBbOk,
    `(spit ${JSON.stringify(pidFile(root))} (str (.pid (java.lang.ProcessHandle/current))))\n(Thread/sleep 60000)\n`
  );
  const supervisorBbOk = path.join(root, 'fake_supervisor_ok.bb');
  fs.writeFileSync(
    supervisorBbOk,
    `(spit ${JSON.stringify(supervisorPidFile(root))} (str (.pid (java.lang.ProcessHandle/current))))\n(Thread/sleep 60000)\n`
  );

  // Fail fakes: exit immediately without ever claiming a pid file, so
  // start_handoff_daemon.sh's bounded wait loop times out and reports
  // FAILED - never a probe, never anything that could reach alarm-and-halt!.
  const handoffdBbFail = path.join(root, 'fake_handoffd_fail.bb');
  fs.writeFileSync(handoffdBbFail, '(System/exit 1)\n');
  const supervisorBbFail = path.join(root, 'fake_supervisor_fail.bb');
  fs.writeFileSync(supervisorBbFail, '(System/exit 1)\n');

  return {
    root,
    bin,
    socket,
    killLog,
    extFake,
    handoffdBbOk,
    supervisorBbOk,
    handoffdBbFail,
    supervisorBbFail,
  };
}

// The "live" pid state (below) deliberately writes THIS process's own pid
// into the fixture as a live-process stand-in (same convention the existing
// shell/JS fixtures use). Tracking it for cleanup would mean reapEverything
// later sends this very process SIGKILL - exactly the guard bl461's own
// cleanupFixture (`pid !== process.pid`) already established; repeated here
// for the same reason.
function trackPidFile(root) {
  for (const file of [pidFile(root), supervisorPidFile(root)]) {
    let pid;
    try {
      pid = fs.readFileSync(file, 'utf8').trim();
    } catch {
      continue;
    }
    if (pid && Number(pid) !== process.pid) {
      trackedPids.add(Number(pid));
    }
  }
}

// Deliberately never sets SWARM_ENSURE_SUPERVISOR_CMD - see file header.
function runEnsure(fixture, extraEnv = {}) {
  const env = {
    ...process.env,
    PATH: `${fixture.bin}:${process.env.PATH}`,
    SWARM_ENSURE_EXTENSION_CHECK_CMD: fixture.extFake,
    SWARM_ENSURE_EXTENSION_BOUNCE_CMD: fixture.extFake,
    SWARMFORGE_SKIP_OPERATOR: '1',
    SWARMFORGE_SKIP_FRONT_DESK: '1',
    SWARMFORGE_SKIP_BABYSITTER: '1',
    HANDOFFD_BB: fixture.handoffdBbOk,
    HANDOFFD_SUPERVISOR_BB: fixture.supervisorBbOk,
    PID_WAIT_ATTEMPTS: '5',
    ...extraEnv,
  };
  delete env.SWARM_ENSURE_SUPERVISOR_CMD;
  for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_PRINCIPAL_USER_ID']) {
    delete env[name];
  }
  try {
    const stdout = execFileSync('bb', [SWARM_ENSURE, fixture.root], { encoding: 'utf8', env });
    trackPidFile(fixture.root);
    return { stdout, status: 0 };
  } catch (err) {
    trackPidFile(fixture.root);
    return { stdout: (err.stdout || '') + (err.stderr || ''), status: err.status ?? 1 };
  }
}

function registerSteps(registry) {
  registry.defineScoped(
    /^an ensure fixture project root with two live agent sessions$/,
    (ctx) => {
      ctx.fixture = buildFixture();
      ctx.envOverrides = {};
      ctx.runCount = 0;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the fixture daemon pid file is "([^"]*)"$/,
    (ctx, value) => {
      const state = knownPidState(value);
      switch (state) {
        case 'absent':
          fs.rmSync(pidFile(ctx.fixture.root), { force: true });
          break;
        case 'empty':
          fs.writeFileSync(pidFile(ctx.fixture.root), '');
          break;
        case 'stale':
          fs.writeFileSync(pidFile(ctx.fixture.root), '999999\n');
          break;
        case 'live':
          fs.writeFileSync(pidFile(ctx.fixture.root), `${process.pid}\n`);
          break;
        default:
          throw new Error(`unreachable pid-file state "${state}"`);
      }
      // Snapshot for the "unchanged" assertion (scenario 03) - taken right
      // after seeding, before any ensure run.
      ctx.pidBeforeRun = readPidFileContent(ctx.fixture.root);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the daemon start path is made to fail$/,
    (ctx) => {
      ctx.envOverrides = {
        ...ctx.envOverrides,
        HANDOFFD_BB: ctx.fixture.handoffdBbFail,
        HANDOFFD_SUPERVISOR_BB: ctx.fixture.supervisorBbFail,
      };
    },
    FEATURE
  );

  registry.defineScoped(
    /^no ensure supervisor command override is set$/,
    () => {
      // Documents intent for this scenario; runEnsure() never sets
      // SWARM_ENSURE_SUPERVISOR_CMD for ANY scenario in this file (see
      // header) - this step exists so the Gherkin reads as an explicit
      // precondition, not an accident of this file's implementation.
    },
    FEATURE
  );

  registry.defineScoped(
    /^ensure runs against the fixture$/,
    (ctx) => {
      ctx.lastResult = runEnsure(ctx.fixture, ctx.envOverrides || {});
      ctx.runCount += 1;
      if (ctx.runCount === 1) {
        ctx.firstRunPid = readPidFileContent(ctx.fixture.root);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^it reports "([^"]*)"$/,
    (ctx, expected) => {
      const output = ctx.lastResult.stdout;
      // The ticket's own prose ("daemon: OK") is a synonym for the real
      // implementation's "daemon: HEALTHY" report line - swarm_ensure.bb
      // never emits the literal string "OK" anywhere.
      if (expected === 'daemon: OK') {
        if (!/^daemon: HEALTHY$/m.test(output)) {
          throw new Error(`expected daemon component to report HEALTHY ("OK"), got:\n${output}`);
        }
        return;
      }
      if (!output.includes(expected)) {
        throw new Error(`expected output to contain ${JSON.stringify(expected)}, got:\n${output}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the fixture is left with a live handoff daemon$/,
    (ctx) => {
      const pid = readPidFileContent(ctx.fixture.root);
      if (!pid || !/^\d+$/.test(pid)) {
        throw new Error(`expected a numeric pid in handoffd.pid, got: ${JSON.stringify(pid)}`);
      }
      if (!pidAlive(Number(pid))) {
        throw new Error(`expected handoffd.pid (${pid}) to name a live process`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the two agent sessions are still alive$/,
    (ctx) => {
      const kills = fs.readFileSync(ctx.fixture.killLog, 'utf8').trim();
      if (kills) {
        throw new Error(`expected no tmux session to be killed, but kill-session was called: ${kills}`);
      }
      for (const session of SESSIONS) {
        const out = execFileSync(path.join(ctx.fixture.bin, 'tmux'), ['-S', ctx.fixture.socket, 'list-panes', '-t', session], {
          encoding: 'utf8',
        }).trim();
        if (out !== '0') {
          throw new Error(`expected session ${session} to report a live (non-dead) pane, got: ${out}`);
        }
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^no daemon stop marker was written$/,
    (ctx) => {
      if (fs.existsSync(stopFile(ctx.fixture.root))) {
        throw new Error('expected no .swarmforge/daemon/stop marker, but one exists');
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^no swarm halt was recorded$/,
    (ctx) => {
      const status = statusFile(ctx.fixture.root);
      if (fs.existsSync(status)) {
        const text = fs.readFileSync(status, 'utf8');
        if (text.includes('"halted"')) {
          throw new Error(`expected the daemon status to never record a halt, got: ${text}`);
        }
      }
      const failureLogs = fs.readdirSync(daemonDir(ctx.fixture.root)).filter((f) => f.startsWith('handoffd-failure-'));
      if (failureLogs.length > 0) {
        throw new Error(`expected no handoffd-failure log (alarm-and-halt! must never run), found: ${failureLogs.join(', ')}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the fixture daemon pid is unchanged$/,
    (ctx) => {
      const after = readPidFileContent(ctx.fixture.root);
      if (after !== ctx.pidBeforeRun) {
        throw new Error(`expected the already-healthy pid to be left unchanged, before=${ctx.pidBeforeRun} after=${after}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^exactly (\d+) handoff daemon is running for the fixture$/,
    (ctx, countStr) => {
      const expectedCount = Number(countStr);
      if (expectedCount !== 1) {
        throw new Error(`bl690 ensure-daemon-repair: this step only supports a count of 1, got "${countStr}"`);
      }
      const finalPid = readPidFileContent(ctx.fixture.root);
      if (finalPid !== ctx.firstRunPid) {
        throw new Error(
          `expected the second run to leave the SAME single handoffd pid behind, first=${ctx.firstRunPid} second=${finalPid}`
        );
      }
      if (!pidAlive(Number(finalPid))) {
        throw new Error(`expected handoffd pid ${finalPid} to still be alive after the second run`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^ensure exits non-zero$/,
    (ctx) => {
      if (ctx.lastResult.status === 0) {
        throw new Error('expected a non-zero exit status when the daemon repair genuinely fails');
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the daemon start audit log records a successful start$/,
    (ctx) => {
      const audit = auditFile(ctx.fixture.root);
      if (!fs.existsSync(audit)) {
        throw new Error(`expected an audit log at ${audit}`);
      }
      const text = fs.readFileSync(audit, 'utf8');
      if (!text.includes('SUCCESS')) {
        throw new Error(`expected the daemon-start audit log to record a SUCCESS line, got:\n${text}`);
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };
