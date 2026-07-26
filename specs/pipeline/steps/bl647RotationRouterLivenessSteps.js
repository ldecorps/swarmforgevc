'use strict';

// BL-647: step handlers for "rotation-router liveness never blames dormant
// roles". Drives the REAL swarmforge/scripts/operator_runtime.bb end to end
// (a genuine bb subprocess, --tick-once) against isolated fixtures - the
// same architecture as controlLossIsNotAgentDeathSteps.js (BL-368's sibling
// liveness-producer scenarios), never a hand-rolled substitute for the
// rotation-mode resolution this ticket wires through operator_runtime.bb's
// tick! into operator_lib/dead-agent-events.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { OPERATOR_RUNTIME_BB_FILES } = require('./lib/operatorRuntimeBbFixtureFiles');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

// The live system's 8-row roster (roles.tsv), coordinator plus the seven
// pipeline roles - the same fixture shape as the ticket's own measured
// evidence and the sibling wiring test
// (test_operator_runtime_bl647_rotation_liveness.sh).
const ROSTER = [
  ['coder', 'coder', 'Coder', 'task'],
  ['specifier', 'master', 'Specifier', 'task'],
  ['cleaner', 'cleaner', 'Cleaner', 'batch'],
  ['architect', 'architect', 'Architect', 'task'],
  ['hardender', 'hardender', 'Hardender', 'batch'],
  ['documenter', 'documenter', 'Documenter', 'task'],
  ['QA', 'QA', 'Qa', 'task'],
  ['coordinator', 'master', 'Coordinator', 'task'],
];
const NON_COORDINATOR_ROLES = ROSTER.map((r) => r[0]).filter((r) => r !== 'coordinator');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkFixture() {
  const target = mkTmp('sfvc-bl647-runtime-');
  const scriptsDir = path.join(target, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(target, 'swarmforge', 'packs'), { recursive: true });
  fs.mkdirSync(path.join(target, '.swarmforge', 'operator'), { recursive: true });
  for (const f of OPERATOR_RUNTIME_BB_FILES) {
    fs.copyFileSync(path.join(SWARM_SCRIPTS, f), path.join(scriptsDir, f));
  }
  return target;
}

// Session column is always swarmforge-<role> - branch/worktree columns are
// irrelevant to dead-agent-events, but a real path keeps the fixture
// plausible for any other row-scanning code the tick touches.
function writeRosterRolesTsv(target) {
  const lines = ROSTER.map(([role, branch, display, mode]) => {
    const worktree = branch === 'master' ? target : path.join(target, '.worktrees', role);
    return [role, branch, worktree, `swarmforge-${role}`, display, 'claude', mode, 'off'].join('\t');
  });
  fs.writeFileSync(path.join(target, '.swarmforge', 'roles.tsv'), `${lines.join('\n')}\n`);
}

// The same two files real swarmforge.sh writes for a `config rotation
// router` mono-router launch: swarm-identity's launch_pack (the first-choice
// resolution active-launch-config-path already uses for relaunch) and the
// pack conf itself carrying the rotation directive conf-rotation-mode reads.
function writeRouterIdentity(target) {
  fs.writeFileSync(path.join(target, '.swarmforge', 'swarm-identity'), 'launch_pack\tmono-router\n');
  fs.writeFileSync(path.join(target, 'swarmforge', 'packs', 'mono-router.conf'), 'config rotation router\n');
}

function writeActiveRole(target, role) {
  fs.writeFileSync(path.join(target, '.swarmforge', 'mono-router-active-role'), `${role}\n`);
}

// Starts a fresh tmux server on an isolated socket with exactly the named
// sessions live, and points the fixture's tmux-socket pointer at it.
function startTmuxSessions(target, sessionNames) {
  const sockDir = mkTmp('sfvc-bl647-sock-');
  const sock = path.join(sockDir, 'bl647.sock');
  for (const name of sessionNames) {
    execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', name, '-n', 'agent']);
  }
  fs.writeFileSync(path.join(target, '.swarmforge', 'tmux-socket'), sock);
  return { sock, sockDir };
}

// cwd MUST be the fixture root: handoff-lib's target-root / roles-tsv-path /
// mono-router-active-role-path resolve via `git rev-parse --git-common-dir`
// (falling back to `git rev-parse --show-toplevel`, then the JVM's
// user.dir) in the PROCESS'S OWN cwd, not the project-root CLI arg
// operator_runtime.bb itself uses for state-dir. A non-git fixture with the
// wrong cwd would silently read the REAL repo's live .swarmforge/roles.tsv
// instead of the fixture's (see the sibling shell wiring test's header).
function tick(target) {
  const env = {
    ...process.env,
    OPERATOR_SKIP_LAUNCH: '1',
    SWARMFORGE_SKIP_TUNNEL: '1',
    SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: '',
    SWARMFORGE_SANDBOX_SWEEP_ROOT: path.join(target, '.no-sandbox-sweep'),
    SWARMFORGE_FIXTURE_REAP_ROOT: path.join(target, '.no-fixture-reap'),
  };
  delete env.SWARMFORGE_CONFIG;
  return execFileSync('bb', [path.join(target, 'swarmforge', 'scripts', 'operator_runtime.bb'), target, '--tick-once'], {
    cwd: target,
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function readEvents(target) {
  const opDir = path.join(target, '.swarmforge', 'operator');
  const events = [];
  for (const name of ['events.jsonl', 'events.inflight.jsonl']) {
    const p = path.join(opDir, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line));
    }
  }
  return events;
}

function cleanup(ctx) {
  if (ctx.bl647Sock) {
    try {
      // stdio: 'ignore' - tmux tears its own server down the moment the
      // last pane's shell exits (common in this sandbox's non-interactive
      // panes), so a race where the server is already gone by cleanup time
      // is expected, not a defect; ignored rather than logged as noise.
      execFileSync('tmux', ['-S', ctx.bl647Sock, 'kill-server'], { stdio: 'ignore' });
    } catch {
      // already gone - fine
    }
  }
  if (ctx.bl647SockDir) {
    fs.rmSync(ctx.bl647SockDir, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a roles fixture with the live system's eight roles\.tsv rows$/, (ctx) => {
    ctx.bl647Target = mkFixture();
    writeRosterRolesTsv(ctx.bl647Target);
  });

  // ── rotation-mode ────────────────────────────────────────────────────
  registry.define(/^the conf declares rotation mode router$/, (ctx) => {
    writeRouterIdentity(ctx.bl647Target);
  });

  registry.define(/^the conf declares no rotation mode$/, () => {
    // Deliberately a no-op: the fixture is full-forge unless
    // writeRouterIdentity was called - no launch_pack, no mono-router.conf,
    // so conf-rotation-mode resolves nil (see the ticket's explicit "do NOT
    // infer the pack from the session count" constraint).
  });

  // ── tmux liveness ────────────────────────────────────────────────────
  registry.define(/^the live tmux sessions are swarmforge-coder and swarmforge-coordinator$/, (ctx) => {
    const { sock, sockDir } = startTmuxSessions(ctx.bl647Target, ['swarmforge-coder', 'swarmforge-coordinator']);
    ctx.bl647Sock = sock;
    ctx.bl647SockDir = sockDir;
  });

  registry.define(/^only the coordinator session is live$/, (ctx) => {
    const { sock, sockDir } = startTmuxSessions(ctx.bl647Target, ['swarmforge-coordinator']);
    ctx.bl647Sock = sock;
    ctx.bl647SockDir = sockDir;
  });

  // resident session = roles.tsv's first non-coordinator row's session,
  // always "swarmforge-coder" per ROSTER above, regardless of which role
  // the active-role marker currently names (respawn-pane -k never renames
  // the pane's tmux session on rotation).
  registry.define(/^the coordinator session is live but the resident session is not$/, (ctx) => {
    const { sock, sockDir } = startTmuxSessions(ctx.bl647Target, ['swarmforge-coordinator']);
    ctx.bl647Sock = sock;
    ctx.bl647SockDir = sockDir;
  });

  registry.define(/^the resident session is live but the coordinator session is not$/, (ctx) => {
    const { sock, sockDir } = startTmuxSessions(ctx.bl647Target, ['swarmforge-coder']);
    ctx.bl647Sock = sock;
    ctx.bl647SockDir = sockDir;
  });

  // ── active-role marker ───────────────────────────────────────────────
  registry.define(/^the active role marker names (\S+)$/, (ctx, role) => {
    writeActiveRole(ctx.bl647Target, role);
  });

  // The mid-rotation race: the resident tmux session (swarmforge-coder)
  // stays alive across a rotation by construction, but the marker can
  // momentarily still name whichever role was rotated away FROM - here,
  // "architect", distinct from the roster's home role "coder" so a
  // pre-fix regression (checking the marked role's OWN roles.tsv session
  // instead of the resident session) would misfire.
  registry.define(/^the active role marker still names the role rotated away from$/, (ctx) => {
    writeActiveRole(ctx.bl647Target, 'architect');
  });

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(/^the dead-agent liveness sweep runs$/, (ctx) => {
    tick(ctx.bl647Target);
    ctx.bl647Events = readEvents(ctx.bl647Target).filter((e) => e.type === 'AGENT_EXITED');
  });

  // ── Then ─────────────────────────────────────────────────────────────
  registry.define(/^it reports no AGENT_EXITED events$/, (ctx) => {
    try {
      if (ctx.bl647Events.length !== 0) {
        throw new Error(`expected zero AGENT_EXITED events, got: ${JSON.stringify(ctx.bl647Events)}`);
      }
    } finally {
      cleanup(ctx);
    }
  });

  registry.define(/^it reports exactly one AGENT_EXITED event$/, (ctx) => {
    if (ctx.bl647Events.length !== 1) {
      cleanup(ctx);
      throw new Error(`expected exactly one AGENT_EXITED event, got: ${JSON.stringify(ctx.bl647Events)}`);
    }
  });

  registry.define(/^that event names (\S+) as its subject$/, (ctx, role) => {
    try {
      const subject = ctx.bl647Events[0] && ctx.bl647Events[0].subject;
      if (subject !== role) {
        throw new Error(`expected the event's subject to be "${role}", got: ${JSON.stringify(ctx.bl647Events)}`);
      }
    } finally {
      cleanup(ctx);
    }
  });

  registry.define(/^it reports one AGENT_EXITED event for each of the seven non-coordinator roles$/, (ctx) => {
    try {
      const subjects = ctx.bl647Events.map((e) => e.subject).sort();
      const expected = [...NON_COORDINATOR_ROLES].sort();
      if (JSON.stringify(subjects) !== JSON.stringify(expected)) {
        throw new Error(`expected AGENT_EXITED for exactly ${JSON.stringify(expected)}, got: ${JSON.stringify(subjects)}`);
      }
    } finally {
      cleanup(ctx);
    }
  });

  registry.define(/^it reports one AGENT_EXITED event for each of the six sessionless roles$/, (ctx) => {
    try {
      const subjects = ctx.bl647Events.map((e) => e.subject).sort();
      const expected = NON_COORDINATOR_ROLES.filter((r) => r !== 'coder').sort();
      if (JSON.stringify(subjects) !== JSON.stringify(expected)) {
        throw new Error(`expected AGENT_EXITED for exactly ${JSON.stringify(expected)}, got: ${JSON.stringify(subjects)}`);
      }
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
