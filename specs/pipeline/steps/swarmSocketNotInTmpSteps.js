'use strict';

// BL-367: step handlers for "The swarm's control socket lives somewhere
// nothing else can reap". Drives the REAL resolve_swarm_socket.bb CLI
// wrapper (the same one swarmforge.sh shells out to) against real fixture
// directories, then proves "still controllable" against a REAL bound
// AF_UNIX socket (Node's net module) rather than a live tmux server - a
// full ./swarm launch is too heavy/risky for an acceptance run (BL-367's
// own notes assign the full-launch E2E proof to QA's procedure) and, per
// this same ticket's incident history, an unscoped teardown/launch touching
// a real swarm's socket is exactly the footgun this ticket exists to fix -
// never risk that from an acceptance step.
//
// Fixtures deliberately live under $HOME, never under os.tmpdir() (which on
// this host resolves under /tmp) - a fixture rooted in /tmp would confound
// the very assertion under test ("never in shared scratch space"), same
// reasoning as the shell integration test test_swarm_socket_not_in_tmp.sh.
//
// "When the swarm launches" is ALREADY registered by
// coordinatorProvisioningSteps.js (BL-243) with identical literal text -
// the registry resolves by first-registration-wins over the whole GLOBAL
// step namespace (specs/pipeline/stepRegistry.js), so scenarios 03/04 do
// their real work in the Given step instead (same established workaround
// as coordinatorProviderConfigurableSteps.js/BL-319) and let the shared
// handler's harmless, unrelated (and here inert, since ctx.root is never
// set to what it expects) re-run of parse_config pass through as dead code.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const RESOLVE_SCRIPT = path.join(SCRIPTS_DIR, 'resolve_swarm_socket.bb');

const FIXTURE_BASE = path.join(os.homedir(), '.sfvc-test-bl367-accept');

function mkFixtureDir(prefix) {
  fs.mkdirSync(FIXTURE_BASE, { recursive: true });
  return fs.mkdtempSync(path.join(FIXTURE_BASE, prefix));
}

// Explicit allowlist, never {...process.env} - and XDG_RUNTIME_DIR is
// included ONLY when the caller passes one, so "the host offers no
// per-user runtime directory" is a genuine absence in the child's
// environment, not merely a blank value inherited from this process.
function resolveSocket(workingDir, hash, xdgRuntimeDir) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  if (xdgRuntimeDir !== undefined) {
    env.XDG_RUNTIME_DIR = xdgRuntimeDir;
  }
  const result = spawnSync('bb', [RESOLVE_SCRIPT, workingDir, hash], { encoding: 'utf8', env });
  return {
    ok: result.status === 0,
    path: result.status === 0 ? result.stdout.trim() : null,
    stderr: result.stderr || '',
  };
}

// Binds a real AF_UNIX listener at `socketPath` (creating its parent dir
// first - neither resolve-socket-path nor its callers create directories,
// that is the binder's job, same as tmux's own -S flag), proving the path
// is genuinely usable, not just a plausible-looking string.
function bindRealSocket(socketPath) {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  fs.rmSync(socketPath, { force: true });
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

function connectRealSocket(socketPath) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    sock.once('connect', () => {
      sock.end();
      resolve();
    });
    sock.once('error', reject);
  });
}

async function assertStillControllable(ctx) {
  if (!ctx.liveServer && !ctx.socketPath) {
    // "the swarm is still controllable" is textually IDENTICAL to BL-372's
    // own stand-in-process assertion (swarmOutlivesLauncherSteps.js) - the
    // global step registry resolves by first-registration-wins (see
    // stepRegistry.js), so this handler also runs, as dead code, for
    // BL-372's own scenario, which already did its own real proof one step
    // earlier and never sets either of this file's own ctx fields. A no-op
    // here, not a crash on undefined fields, is what makes that survivable.
    return;
  }
  if (ctx.liveServer) {
    // Scenario 02: the socket was already bound before the disruption -
    // prove the SAME listener is still reachable, not a freshly-bound one,
    // then release it - an unclosed listener would keep the acceptance
    // process's event loop alive forever after this scenario finishes.
    await connectRealSocket(ctx.liveSocketPath);
    await closeServer(ctx.liveServer);
    ctx.liveServer = null;
    return;
  }
  // Scenario 04: nothing has bound yet - prove the resolved path itself is
  // genuinely bindable (short enough, parent creatable), then release it.
  const server = await bindRealSocket(ctx.socketPath);
  await closeServer(server);
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^the swarm is launched with a tmux control socket$/, (ctx) => {
    ctx.projectRoot = mkFixtureDir('root-');
    ctx.hash = '12345';
  });

  // ── swarm-socket-not-in-tmp-01 ───────────────────────────────────────────
  registry.define(/^the swarm creates its control socket$/, (ctx) => {
    ctx.resolveResult = resolveSocket(ctx.projectRoot, ctx.hash, '/run/user/99999-unused');
    if (!ctx.resolveResult.ok) {
      throw new Error(`expected resolve_swarm_socket.bb to succeed for a normal-length project root, got: ${ctx.resolveResult.stderr}`);
    }
    ctx.socketPath = ctx.resolveResult.path;
    fs.mkdirSync(path.dirname(ctx.socketPath), { recursive: true });
  });

  registry.define(/^the socket is not placed in a world-writable directory shared with other processes$/, (ctx) => {
    if (ctx.socketPath.startsWith('/tmp/') || ctx.socketPath.startsWith('/var/tmp/')) {
      throw new Error(`expected the control socket to never live under shared scratch space, got: ${ctx.socketPath}`);
    }
    if (!ctx.socketPath.startsWith(`${ctx.projectRoot}/`)) {
      throw new Error(`expected the control socket to live under the project's own private tree, got: ${ctx.socketPath}`);
    }
    const mode = fs.statSync(path.dirname(ctx.socketPath)).mode;
    if ((mode & 0o002) !== 0) {
      throw new Error(`expected the socket's directory to not be world-writable, got mode ${mode.toString(8)}`);
    }
  });

  // ── swarm-socket-not-in-tmp-02 ───────────────────────────────────────────
  registry.define(/^the swarm is running$/, async (ctx) => {
    ctx.resolveResult = resolveSocket(ctx.projectRoot, ctx.hash, '/run/user/99999-unused');
    if (!ctx.resolveResult.ok) {
      throw new Error(`expected resolve_swarm_socket.bb to succeed, got: ${ctx.resolveResult.stderr}`);
    }
    ctx.socketPath = ctx.resolveResult.path;
    ctx.liveSocketPath = ctx.socketPath;
    ctx.liveServer = await bindRealSocket(ctx.socketPath);
    // A stand-in for "everybody's shared scratch space" - a directory
    // outside the project root entirely, so wiping it can never touch the
    // real control socket unless that socket is (wrongly) placed inside it.
    ctx.scratchDir = mkFixtureDir('shared-scratch-');
    fs.writeFileSync(path.join(ctx.scratchDir, 'unrelated-junk'), 'x');
  });

  registry.define(/^shared scratch space is cleaned out$/, (ctx) => {
    fs.rmSync(ctx.scratchDir, { recursive: true, force: true });
  });

  registry.define(/^the swarm's control socket is untouched$/, (ctx) => {
    if (!fs.existsSync(ctx.liveSocketPath)) {
      throw new Error(`expected the control socket to survive a shared-scratch-space cleanup, but it is gone: ${ctx.liveSocketPath}`);
    }
    if (!fs.statSync(ctx.liveSocketPath).isSocket()) {
      throw new Error(`expected ${ctx.liveSocketPath} to still be a real socket after the cleanup`);
    }
  });

  registry.define(/^the swarm is still controllable$/, async (ctx) => {
    await assertStillControllable(ctx);
  });

  // ── swarm-socket-not-in-tmp-03 ───────────────────────────────────────────
  registry.define(/^the host provides no per-user runtime directory$/, (ctx) => {
    ctx.resolveResult = resolveSocket(ctx.projectRoot, ctx.hash, undefined);
    if (!ctx.resolveResult.ok) {
      throw new Error(`expected the swarm to still resolve a socket with no XDG_RUNTIME_DIR, got: ${ctx.resolveResult.stderr}`);
    }
    ctx.socketPath = ctx.resolveResult.path;
  });

  registry.define(/^it still creates its control socket somewhere private to the user$/, (ctx) => {
    if (!ctx.socketPath.startsWith(`${ctx.projectRoot}/`)) {
      throw new Error(`expected a socket path under the project's own private tree, got: ${ctx.socketPath}`);
    }
  });

  registry.define(/^it does not fall back to shared scratch space$/, (ctx) => {
    if (ctx.socketPath.startsWith('/tmp/') || ctx.socketPath.startsWith('/var/tmp/')) {
      throw new Error(`expected no fallback to shared scratch space, got: ${ctx.socketPath}`);
    }
  });

  // ── swarm-socket-not-in-tmp-04 ───────────────────────────────────────────
  registry.define(/^the project lives at a path long enough to exceed the operating system's socket-path limit$/, (ctx) => {
    ctx.deepRoot = path.join(ctx.projectRoot, 'a'.repeat(90));
    fs.mkdirSync(ctx.deepRoot, { recursive: true });
    // The fallback runtime dir must itself be real and writable so the
    // "still controllable" step below can actually bind there - a fixture
    // under $HOME, not the real /run/user/<uid> (which may not exist or be
    // writable in every test sandbox), and deliberately not /tmp.
    ctx.xdgRuntimeDir = mkFixtureDir('xdg-runtime-');
    ctx.resolveResult = resolveSocket(ctx.deepRoot, ctx.hash, ctx.xdgRuntimeDir);
    if (!ctx.resolveResult.ok) {
      throw new Error(`expected the XDG_RUNTIME_DIR fallback to rescue a deeply-nested project root, got: ${ctx.resolveResult.stderr}`);
    }
    ctx.socketPath = ctx.resolveResult.path;
  });

  registry.define(/^it does not fail with an unreadable operating-system error$/, (ctx) => {
    if (!ctx.resolveResult.ok) {
      throw new Error(`expected success (a usable fallback path), not a raw OS error, got: ${ctx.resolveResult.stderr}`);
    }
    if (ctx.resolveResult.stderr) {
      throw new Error(`expected no diagnostic output on the success path, got: ${ctx.resolveResult.stderr}`);
    }
  });
}

module.exports = { registerSteps };
