'use strict';

// BL-486: step handlers for "the swarm auto-reaps orphaned SwarmForge agent
// processes, and never a live agent". Scenario 01 drives the REAL pure
// decision function (orphan_agent_reaper_lib.bb's reapable?) via
// orphan_agent_reapable_decision_acceptance_runner.bb - the same
// Babashka-runner pattern fixture_reapable_decision_acceptance_runner.bb
// (BL-458) already established, never a hand-rolled reimplementation of the
// decision in JS. Scenarios 02/03 drive the REAL
// orphan_agent_reaper_sweep_lib.bb sweep (via the standalone
// reap_orphan_agents.bb CLI) against a real, disposable candidate process
// this step file spawns itself and a PRIVATE fixture project root - never
// the real /proc-wide scan (SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS pins the
// exact candidate pid) and never the real live swarm's own tmux socket.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DECISION_RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'orphan_agent_reapable_decision_acceptance_runner.bb'
);
const REAP_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'reap_orphan_agents.bb');

const FEATURE_NAME = 'the swarm auto-reaps orphaned SwarmForge agent processes, and never a live agent';

// engineering.prompt's Scenario Outline rule: every Examples: column value
// must be validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough.
const KNOWN_BOOLEANS = { yes: true, no: false };

function knownBoolean(label, value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_BOOLEANS, value)) {
    throw new Error(`reap-orphaned-agent-processes: unrecognized <${label}> example value "${value}"`);
  }
  return KNOWN_BOOLEANS[value];
}

function runDecision(input) {
  const out = execFileSync('bb', [DECISION_RUNNER, JSON.stringify(input)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

// A real, disposable, harmless child whose cmdline legitimately carries the
// same --remote-control SwarmForge-* tell swarmforge.sh's own launch_role
// bakes into a real claude role's argv - "--" stops node's own flag
// parsing so the trailing args land in the child's argv untouched, never
// throwing "bad option".
function spawnRemoteControlCandidate() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', '--remote-control', 'SwarmForge-Test'], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  return child.pid;
}

function auditLogPath(projectRoot) {
  return path.join(projectRoot, '.swarmforge', 'daemon', 'reap-orphan-agents-audit.log');
}

function readAuditLines(projectRoot) {
  const p = auditLogPath(projectRoot);
  if (!fs.existsSync(p)) {
    return [];
  }
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function runSweep(projectRoot, candidatePid) {
  execFileSync('bb', [REAP_CLI, projectRoot], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SWARMFORGE_ORPHAN_REAP_STALE_HOURS: '0',
      SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: String(candidatePid),
    },
  });
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^the orphaned-agent reaper$/, (ctx) => {
    ctx.decisionInput = {
      inLiveWindowSet: false,
      cwdInsideRoot: false,
      remoteControlAgent: true,
      hasChildren: false,
      stale: true,
    };
  });

  // ── reap-orphaned-agent-processes-01 (Scenario Outline) ────────────────
  registry.define(
    /^the candidate pid being a member of the live control socket's tmux window set is "([^"]+)"$/,
    (ctx, value) => {
      ctx.decisionInput.inLiveWindowSet = knownBoolean('in_window_set', value);
    }
  );

  registry.define(/^its cwd still resolving inside this repo root is "([^"]+)"$/, (ctx, value) => {
    ctx.decisionInput.cwdInsideRoot = knownBoolean('cwd_inside_root', value);
  });

  registry.define(/^it being a SwarmForge remote-control agent process is "([^"]+)"$/, (ctx, value) => {
    ctx.decisionInput.remoteControlAgent = knownBoolean('remote_control_agent', value);
  });

  registry.define(/^it having live child processes is "([^"]+)"$/, (ctx, value) => {
    ctx.decisionInput.hasChildren = knownBoolean('has_children', value);
  });

  registry.defineScoped(
    /^its age past the stale threshold is "([^"]+)"$/,
    (ctx, value) => {
      ctx.decisionInput.stale = knownBoolean('is_stale', value);
    },
    FEATURE_NAME
  );

  registry.define(/^the reaper evaluates the candidate$/, (ctx) => {
    ctx.result = runDecision(ctx.decisionInput);
  });

  registry.define(/^the agent process is killed is "([^"]+)"$/, (ctx, value) => {
    const expected = knownBoolean('reaped', value);
    if (ctx.result.reapable !== expected) {
      throw new Error(`expected reapable=${expected} for ${JSON.stringify(ctx.decisionInput)}, got reapable=${ctx.result.reapable}`);
    }
  });

  // ── reap-orphaned-agent-processes-02 ────────────────────────────────────
  registry.define(
    /^a candidate agent process that is old, has a deleted working directory, has no children, and is not in any live window set$/,
    (ctx) => {
      ctx.projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl486-project-'));
      fs.mkdirSync(path.join(ctx.projectRoot, '.swarmforge'), { recursive: true });
      // No .swarmforge/tmux-socket file at all -> live-window-pid-set!
      // resolves to the empty set, exactly the "not in any live window
      // set" fixture shape. cwd/age are real reads (SWARMFORGE_ORPHAN_REAP_
      // STALE_HOURS=0 makes any real elapsed time count as stale; the
      // candidate's real cwd is wherever this test process runs from,
      // never under projectRoot/.swarmforge, satisfying cwd-inside-root?=false).
      ctx.candidatePid = spawnRemoteControlCandidate();
    }
  );

  registry.define(/^the orphaned-agent reaper sweep runs against a private fixture$/, (ctx) => {
    runSweep(ctx.projectRoot, ctx.candidatePid);
  });

  registry.define(/^that candidate process is killed$/, async (ctx) => {
    const dead = await waitFor(() => !pidAlive(ctx.candidatePid), 3000);
    if (!dead) {
      throw new Error(`expected candidate pid ${ctx.candidatePid} to be killed, but it is still alive`);
    }
  });

  registry.define(/^the audit log gains exactly one entry naming that pid$/, (ctx) => {
    const lines = readAuditLines(ctx.projectRoot).filter((l) => l.includes(`pid=${ctx.candidatePid} `));
    if (lines.length !== 1) {
      throw new Error(`expected exactly one audit line naming pid=${ctx.candidatePid}, got: ${JSON.stringify(lines)}`);
    }
    fs.rmSync(ctx.projectRoot, { recursive: true, force: true });
  });

  // ── reap-orphaned-agent-processes-03 ────────────────────────────────────
  registry.define(/^an old agent process whose pid is a member of the live control socket's tmux window set$/, (ctx) => {
    ctx.projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl486-project-'));
    fs.mkdirSync(path.join(ctx.projectRoot, '.swarmforge'), { recursive: true });
    ctx.fixtureSocket = path.join(ctx.projectRoot, '.swarmforge', 'fixture-tmux.sock');
    // A REAL, disposable tmux server whose one pane IS the remote-control-
    // tagged candidate process directly (no intermediate shell), so
    // `tmux -S sock list-panes -a -F '#{pane_pid}'` returns exactly this
    // pid - the same real mechanism kill_all_swarm.sh's own
    // snapshot_pane_descendants and the production live-window-pid-set!
    // both read.
    execFileSync('tmux', [
      '-S',
      ctx.fixtureSocket,
      'new-session',
      '-d',
      '-s',
      'bl486-orphan-test',
      '--',
      process.execPath,
      '-e',
      'setInterval(() => {}, 1000)',
      '--',
      '--remote-control',
      'SwarmForge-Test',
    ]);
    const paneOut = execFileSync('tmux', ['-S', ctx.fixtureSocket, 'list-panes', '-a', '-F', '#{pane_pid}'], {
      encoding: 'utf8',
    }).trim();
    ctx.candidatePid = parseInt(paneOut, 10);
    // The SAME file production code reads (project-root/.swarmforge/tmux-socket)
    // - the real discovery mechanism, never a separate override env var.
    fs.writeFileSync(path.join(ctx.projectRoot, '.swarmforge', 'tmux-socket'), ctx.fixtureSocket);
  });

  registry.define(/^that process is left running$/, (ctx) => {
    if (!pidAlive(ctx.candidatePid)) {
      throw new Error(`expected pid ${ctx.candidatePid} (in the live window set) to survive, but it was killed`);
    }
  });

  registry.define(/^no audit line is written for that pid$/, (ctx) => {
    try {
      const lines = readAuditLines(ctx.projectRoot).filter((l) => l.includes(`pid=${ctx.candidatePid} `));
      if (lines.length !== 0) {
        throw new Error(`expected no audit line naming pid=${ctx.candidatePid}, got: ${JSON.stringify(lines)}`);
      }
    } finally {
      try {
        execFileSync('tmux', ['-S', ctx.fixtureSocket, 'kill-server'], { stdio: 'ignore' });
      } catch {
        // already gone - fine.
      }
      fs.rmSync(ctx.projectRoot, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
