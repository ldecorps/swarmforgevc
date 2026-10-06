'use strict';

// BL-1832: a router resident running its active role's agent is never
// respawned.
//
// Drives the REAL babysitter_check.sh end to end (never a parallel
// reimplementation of the agent-acceptability resolution), same pattern
// bl804BabysitterMonoRouterTopologyAwarenessSteps.js already uses: a real
// tmux server with a renamed child process (`exec -a "<agent> ..." sleep
// 999`) that a real `ps -eo pid=,ppid=,args=` snapshot picks up, so the
// gatherer's own agent-marker matching is exercised verbatim, not stubbed.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');
const { track } = require('./lib/fixtureReaper');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { gitifyFixtureRoot } = require('./lib/operatorRuntimeFixtureGitRoot');

const FEATURE = "BL-1832 a router resident running its active role's agent is never respawned";

const HOME_ROLE = 'coder';
const ACTIVE_ROLE = 'QA';
const ROLE_AGENT = { [HOME_ROLE]: 'aider', [ACTIVE_ROLE]: 'claude' };
const ALL_ROLES = [HOME_ROLE, ACTIVE_ROLE, 'coordinator'];

function sessionFor(role) {
  return `swarmforge-${role}`;
}

function mkTmp(prefix) {
  return mkSocketFixtureRoot(prefix);
}

function mkFixtureRoot() {
  const root = mkTmp('bl1832-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  // BL-1833: pipeline-code-on-main fails the whole sweep closed to
  // UNAVAILABLE without a swarmforge-QA ref to resolve against - same
  // gitify-and-branch fixture every other babysitter acceptance handler
  // with this need already uses (BL-804's own mkFixtureRoot).
  gitifyFixtureRoot(root);
  execFileSync('git', ['-C', root, 'branch', 'swarmforge-QA']);
  return root;
}

function writeRolesTsv(root, { agentFor = ROLE_AGENT } = {}) {
  const lines = ALL_ROLES.map((role) => {
    const worktree = role === 'coordinator' ? root : path.join(root, '.worktrees', role);
    const agent = agentFor[role] || 'claude';
    return [role, role, worktree, sessionFor(role), role, agent, 'task'].join('\t');
  });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${lines.join('\n')}\n`);
}

function writeMeminfo(root) {
  const p = path.join(root, 'meminfo');
  fs.writeFileSync(p, 'MemAvailable:    8000000 kB\n');
  return p;
}

function writeRouterIdentity(root) {
  fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'rotation\trouter\n');
}

function writeActiveRoleMarker(root, role) {
  fs.writeFileSync(path.join(root, '.swarmforge', 'mono-router-active-role'), role);
}

// Starts a REAL tmux server. The home session either runs a renamed child
// process for the given agent token, or no agent process at all.
function startHomeSession(root, { agent } = {}) {
  const sockDir = mkTmp('bl1832-sock-');
  const sock = path.join(sockDir, 'bl1832.sock');
  const name = sessionFor(HOME_ROLE);
  if (agent) {
    execFileSync('tmux', [
      '-S', sock, 'new-session', '-d', '-s', name,
      'bash', '-c', `exec -a "${agent} fake" sleep 999 & wait`,
    ]);
  } else {
    execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', name]);
  }
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);
  return { sock, sockDir };
}

function buildPgrepStub() {
  const dir = mkTmp('bl1832-fakebin-');
  const stub = path.join(dir, 'pgrep');
  fs.writeFileSync(stub, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(stub, 0o755);
  return dir;
}

// BL-1832 hardening: a scenario ends on different Then steps (scenario 02
// has two, 03/04 have only one), so cleanup cannot live inline in any single
// assertion step without either firing too early (destroying fixture state
// a LATER Then still needs) or leaking on a throw. BL-1659: registered
// through the runtime's own per-scenario disposal instead, at the step that
// first builds this scenario's state.
function ensureState(ctx) {
  if (!ctx.bl1832) {
    ctx.bl1832 = { root: null, sock: null, sockDir: null, fakeBin: null, rotationRouter: false, standing: false };
    const st = ctx.bl1832;
    const cleanup = () => {
      if (st.sock) {
        try {
          execFileSync('tmux', ['-S', st.sock, 'kill-server'], { stdio: 'ignore' });
        } catch {
          /* server already gone - fine */
        }
      }
      if (st.sockDir) fs.rmSync(st.sockDir, { recursive: true, force: true });
      if (st.fakeBin) fs.rmSync(st.fakeBin, { recursive: true, force: true });
      if (st.root) fs.rmSync(st.root, { recursive: true, force: true });
    };
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(cleanup);
  }
  return ctx.bl1832;
}

function runSweep(ctx) {
  const st = ensureState(ctx);
  const meminfoPath = writeMeminfo(st.root);
  const fakeBin = (st.fakeBin = buildPgrepStub());
  st.result = spawnSync('bash', [CHECK_SH, st.root], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      BABYSITTER_MEMINFO_PATH: meminfoPath,
    },
  });
  st.stdout = st.result.stdout || '';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pack whose roles\.tsv runs role "([^"]+)" on agent "([^"]+)" and role "([^"]+)" on agent "([^"]+)"$/,
    (ctx, role1, agent1, role2, agent2) => {
      const st = ensureState(ctx);
      st.root = mkFixtureRoot();
      track(st.root);
      writeRolesTsv(st.root, { agentFor: { [role1]: agent1, [role2]: agent2 } });
    });

  scoped(/^the pack is a rotation router whose home role is "([^"]+)"$/, (ctx, homeRole) => {
    const st = ensureState(ctx);
    st.rotationRouter = true;
    st.standing = false;
    if (homeRole !== HOME_ROLE) {
      throw new Error(`BL-1832 fixture only models home role "${HOME_ROLE}", got "${homeRole}"`);
    }
    writeRouterIdentity(st.root);
  });

  scoped(/^the pack is a standing pack$/, (ctx) => {
    const st = ensureState(ctx);
    st.rotationRouter = false;
    st.standing = true;
    // No-op otherwise: no swarm-identity file is written, so resolution
    // falls back to the tracked default conf, which declares no rotation
    // directive (same as BL-804's "no rotation router declaration" step).
  });

  scoped(/^the resident is active as "([^"]+)"$/, (ctx, role) => {
    writeActiveRoleMarker(ensureState(ctx).root, role);
  });

  scoped(/^no active-role marker is recorded$/, () => {
    // No-op: the marker file is simply never written.
  });

  scoped(/^an active-role marker names "([^"]+)"$/, (ctx, role) => {
    writeActiveRoleMarker(ensureState(ctx).root, role);
  });

  scoped(/^the "coder" pane runs a live "([^"]+)" process$/, (ctx, agent) => {
    const st = ensureState(ctx);
    const { sock, sockDir } = startHomeSession(st.root, { agent });
    st.sock = sock;
    st.sockDir = sockDir;
  });

  scoped(/^the "coder" pane runs no agent process$/, (ctx) => {
    const st = ensureState(ctx);
    const { sock, sockDir } = startHomeSession(st.root, {});
    st.sock = sock;
    st.sockDir = sockDir;
  });

  scoped(/^the babysitter sweep assesses the "coder" seat$/, (ctx) => {
    runSweep(ctx);
  });

  scoped(/^no half-launch finding names the "coder" seat$/, (ctx) => {
    const st = ensureState(ctx);
    const needle = 'proc-coder]';
    if (st.stdout.includes(needle)) {
      throw new Error(`expected no half-launch finding naming the coder seat; got:\n${st.stdout}`);
    }
  });

  scoped(/^no repair is decided for the "coder" seat$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.stdout.includes('REPAIR') && st.stdout.includes('coder')) {
      throw new Error(`expected no repair decided for the coder seat; got:\n${st.stdout}`);
    }
  });

  scoped(/^a half-launch CRIT names the "coder" seat$/, (ctx) => {
    const st = ensureState(ctx);
    const needle = 'CRIT [proc-coder] swarmforge-coder: pane alive but NO';
    if (!st.stdout.includes(needle)) {
      throw new Error(`expected to find "${needle}"; got:\n${st.stdout}`);
    }
  });

  scoped(/^a repair to ensure the "coder" session is decided alongside it$/, (ctx) => {
    const st = ensureState(ctx);
    if (!/REPAIR .*swarmforge-coder/.test(st.stdout)) {
      throw new Error(`expected a repair naming swarmforge-coder; got:\n${st.stdout}`);
    }
  });
}

module.exports = { registerSteps };
