'use strict';

// BL-804: step handlers for "babysitter health sweep is mono-router
// topology aware". Drives the REAL babysitter_check.sh end to end (never a
// parallel reimplementation of the topology resolution) against disposable
// fixture roots — a real tmux server for the "alive" scenarios (bl647's
// approach: an actual session with a renamed child process ps can see,
// rather than a hand-rolled fake tmux protocol responder) and a fake
// `pgrep` stub only for the one scenario that needs a fully green sweep
// (handoffd/handoffd_supervisor liveness is a live-host process check that
// has nothing to do with this ticket's topology fix).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');

const FEATURE = 'BL-804 babysitter health sweep is mono-router topology aware';

// The Background's "eight roles whose first non-coordinator session is the
// resident": coder is the resident (first row, non-coordinator); the six
// dormant roles are the rest of the real pipeline chain; coordinator is
// always-standing infrastructure. Session column mirrors the live roles.tsv
// shape (role, branch, worktree, session, display, agent, mode).
const RESIDENT_ROLE = 'coder';
const DORMANT_ROLES = ['specifier', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const ALL_ROLES = [RESIDENT_ROLE, ...DORMANT_ROLES, 'coordinator'];

function sessionFor(role) {
  return `swarmforge-${role}`;
}

// Outline's <required-session> example values map to a real role name — an
// explicit KNOWN_VALUES table (engineering.prompt's Scenario Outline rule),
// never a passthrough of the example text into the fixture/assertion.
const REQUIRED_SESSION_ROLE = { resident: RESIDENT_ROLE, coordinator: 'coordinator' };

function knownRequiredSession(value) {
  if (!Object.prototype.hasOwnProperty.call(REQUIRED_SESSION_ROLE, value)) {
    throw new Error(`BL-804: unrecognized <required-session> example value "${value}" - not in REQUIRED_SESSION_ROLE`);
  }
  return REQUIRED_SESSION_ROLE[value];
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkFixtureRoot() {
  const root = mkTmp('bl804-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  // babysitter_check.bb's active-ticket-count glob throws on a missing dir
  // (unlike the try/caught mailbox globs) - keep it empty, but present.
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  return root;
}

function writeRolesTsv(root) {
  const lines = ALL_ROLES.map((role) => {
    const worktree = role === 'coordinator' ? root : path.join(root, '.worktrees', role);
    return [role, role, worktree, sessionFor(role), role, 'claude', 'task'].join('\t');
  });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${lines.join('\n')}\n`);
}

function writeMeminfo(root) {
  // Deterministic, host-independent memory floor reading (mirrors bl802's
  // BABYSITTER_MEMINFO_PATH seam) - a real host's vm_stat is irrelevant to
  // this ticket and must never introduce a stray memory finding.
  const p = path.join(root, 'meminfo');
  fs.writeFileSync(p, 'MemAvailable:    8000000 kB\n');
  return p;
}

// A placeholder regular file at the tmux-socket path so read-tmux-socket's
// fs/exists? check passes; with no real tmux server listening there, every
// `tmux -S <path> has-session` naturally fails (exit non-zero) - the "every
// session absent" world needs no fake tmux binary at all.
function writePlaceholderSocket(root) {
  const p = path.join(root, 'placeholder.sock');
  fs.writeFileSync(p, '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), p);
}

// Starts a REAL tmux server with exactly the named sessions live. Sessions
// in `claudeSessions` run a renamed child process (`exec -a "claude
// --remote-control fake" sleep 999`, backgrounded under a `wait`d parent so
// pane_pid stays the shell, not the exec'd child) that a real `ps -eo
// pid=,ppid=,args=` snapshot picks up as a live, RC-enabled claude process.
// Sessions in `plainSessions` run the default shell — alive, but with no
// claude-argv child (the BL-804-04 half-launch shape).
function startTmuxSessions(root, { claudeSessions = [], plainSessions = [] } = {}) {
  const sockDir = mkTmp('bl804-sock-');
  const sock = path.join(sockDir, 'bl804.sock');
  for (const name of claudeSessions) {
    execFileSync('tmux', [
      '-S', sock, 'new-session', '-d', '-s', name,
      'bash', '-c', 'exec -a "claude --remote-control fake" sleep 999 & wait',
    ]);
  }
  for (const name of plainSessions) {
    execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', name]);
  }
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);
  return { sock, sockDir };
}

function writeRouterIdentity(root) {
  fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'rotation\trouter\n');
}

function writeConfPackIdentity(root) {
  const packConf = path.join(root, 'pack.conf');
  fs.writeFileSync(packConf, 'config rotation router\n');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'swarm-identity'),
    `active_backlog_max_depth_conf_path\t${packConf}\n`
  );
}

// A fake `pgrep` stub that always reports a match (exit 0), so
// handoffd/handoffd_supervisor liveness reads green regardless of what is
// actually running on the host that happens to execute this suite - real
// tmux/ps still resolve from the system PATH after this directory.
function buildPgrepStub() {
  const dir = mkTmp('bl804-fakebin-');
  const stub = path.join(dir, 'pgrep');
  fs.writeFileSync(stub, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(stub, 0o755);
  return dir;
}

function ensureState(ctx) {
  if (!ctx.bl804) ctx.bl804 = { root: null, sock: null, sockDir: null, fakeBin: null, greenInfra: false };
  return ctx.bl804;
}

function cleanup(ctx) {
  const st = ctx.bl804;
  if (!st) return;
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
}

function runSweep(ctx) {
  const st = ensureState(ctx);
  // Any scenario that never started a real tmux server still needs a
  // socket file present so read-tmux-socket resolves a (dead) path -
  // every session then naturally reads as absent.
  if (!st.sock) writePlaceholderSocket(st.root);
  const meminfoPath = writeMeminfo(st.root);
  const pathPrefix = st.greenInfra ? `${(st.fakeBin = buildPgrepStub())}:` : '';
  st.result = spawnSync('bash', [CHECK_SH, st.root], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${pathPrefix}${process.env.PATH}`,
      BABYSITTER_MEMINFO_PATH: meminfoPath,
    },
  });
  st.stdout = st.result.stdout || '';
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(/^a fixture project root with a \.swarmforge directory$/, (ctx) => {
    ensureState(ctx).root = mkFixtureRoot();
  }, FEATURE);

  registry.defineScoped(/^a roles\.tsv listing eight roles whose first non-coordinator session is the resident$/, (ctx) => {
    writeRolesTsv(ensureState(ctx).root);
  }, FEATURE);

  // ── swarm-identity / conf resolution ────────────────────────────────
  registry.defineScoped(/^the swarm-identity rotation key declares router$/, (ctx) => {
    writeRouterIdentity(ensureState(ctx).root);
  }, FEATURE);

  registry.defineScoped(
    /^the swarm-identity has no rotation key and records an active pack conf declaring rotation router$/,
    (ctx) => {
      writeConfPackIdentity(ensureState(ctx).root);
    },
    FEATURE
  );

  registry.defineScoped(/^no rotation router declaration exists in identity or conf$/, () => {
    // Deliberately a no-op: no swarm-identity file is written at all, so
    // resolution falls back to the tracked default swarmforge/swarmforge.conf,
    // which declares no rotation directive (verified: only prose mentions
    // "config rotation router" inside comments, never an active line).
  }, FEATURE);

  // ── session liveness ────────────────────────────────────────────────
  registry.defineScoped(/^the resident and coordinator sessions are alive with claude processes$/, (ctx) => {
    const st = ensureState(ctx);
    const { sock, sockDir } = startTmuxSessions(st.root, {
      claudeSessions: [sessionFor(RESIDENT_ROLE), sessionFor('coordinator')],
    });
    st.sock = sock;
    st.sockDir = sockDir;
  }, FEATURE);

  registry.defineScoped(/^every dormant role session is absent$/, () => {
    // No-op: dormant sessions are simply never created by any other step
    // in this scenario - real tmux (or the placeholder-socket fallback)
    // reports them absent with no fixture of its own needed.
  }, FEATURE);

  registry.defineScoped(/^every other health signal is green$/, (ctx) => {
    ensureState(ctx).greenInfra = true;
  }, FEATURE);

  registry.defineScoped(/^the (resident|coordinator) session is absent$/, () => {
    // No-op: the outline's fixture never starts a tmux server at all, so
    // every session - including the named required one - is absent by
    // construction. The Then step asserts the specific CRIT line fires.
  }, FEATURE);

  registry.defineScoped(/^a dormant role session exists with no claude process under it$/, (ctx) => {
    const st = ensureState(ctx);
    const { sock, sockDir } = startTmuxSessions(st.root, {
      plainSessions: [sessionFor(DORMANT_ROLES[0])],
    });
    st.sock = sock;
    st.sockDir = sockDir;
  }, FEATURE);

  registry.defineScoped(/^the cleaner session is absent$/, () => {
    // No-op, same rationale as the outline's absent-session step above -
    // no tmux server is ever started for this scenario.
  }, FEATURE);

  // ── When ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^the sweep assembles findings$/, (ctx) => {
    runSweep(ctx);
  }, FEATURE);

  // ── Then ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^no finding names a dormant role$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      for (const role of DORMANT_ROLES) {
        if (st.stdout.includes(`swarmforge-${role}:`)) {
          throw new Error(`expected no finding naming dormant role "${role}"; got:\n${st.stdout}`);
        }
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^the sweep reports OK all checks green$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      if (!/ OK all checks green\s*$/.test(st.stdout.trim())) {
        throw new Error(`expected "OK all checks green"; got:\n${st.stdout}\n${st.result.stderr || ''}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^a CRIT finding reports the (resident|coordinator) session missing$/, (ctx, rawValue) => {
    const st = ensureState(ctx);
    try {
      const role = knownRequiredSession(rawValue);
      const needle = `CRIT [pane-${role}] swarmforge-${role}: tmux session missing`;
      if (!st.stdout.includes(needle)) {
        throw new Error(`expected to find "${needle}"; got:\n${st.stdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^a CRIT finding reports that role's pane alive without a claude process$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const role = DORMANT_ROLES[0];
      const needle = `CRIT [proc-${role}] swarmforge-${role}: pane alive but NO claude process under it`;
      if (!st.stdout.includes(needle)) {
        throw new Error(`expected to find "${needle}"; got:\n${st.stdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^a CRIT finding reports the cleaner session missing$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const needle = 'CRIT [pane-cleaner] swarmforge-cleaner: tmux session missing';
      if (!st.stdout.includes(needle)) {
        throw new Error(`expected to find "${needle}"; got:\n${st.stdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
