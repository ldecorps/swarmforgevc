'use strict';

// BL-878: step handlers for "Handoffd wiring tests spawn their daemon
// without requiring setsid". Drives a REAL handoffd.bb subprocess through
// the REAL portable_daemon_spawn_lib.sh shared helper, against a private,
// disposable fixture root - never the real /tmp - mirroring
// bl877PortableProcessLivenessSteps.js's own convention. "setsid present"
// is reproduced even on this project's own macOS host (which genuinely
// lacks setsid) via a small stub binary prepended to PATH that execs its
// argv (BL-877's own "stub the facility" seam, applied to a command rather
// than an env var). "setsid absent" is simply the ambient PATH, unmodified
// - this host's own real condition.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');
const SPAWN_LIB = path.join(SCRIPTS_DIR, 'portable_daemon_spawn_lib.sh');

const FEATURE_NAME = 'Handoffd wiring tests spawn their daemon without requiring setsid';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_SETSID_AVAILABILITY = { present: 'present', absent: 'absent' };

function knownSetsidAvailability(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_SETSID_AVAILABILITY, value)) {
    throw new Error(`setsid-free-daemon-spawn: unrecognized <setsid availability> example value "${value}"`);
  }
  return KNOWN_SETSID_AVAILABILITY[value];
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitFor(predicate, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    (function tick() {
      if (predicate()) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, intervalMs);
    })();
  });
}

function logFile(ctx) {
  return path.join(ctx.projectRoot, '.swarmforge', 'daemon', 'handoffd.log');
}

function buildMinimalFixture(ctx) {
  ctx.projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl878-project-'));
  const sock = path.join(ctx.projectRoot, 'fake.sock');
  fs.writeFileSync(sock, '');
  for (const dir of [
    '.swarmforge/handoffs/inbox/new',
    '.swarmforge/handoffs/coordinator/inbox/new',
    '.swarmforge/handoffs/coordinator/inbox/in_process',
    '.swarmforge/handoffs/coordinator/inbox/completed',
    'docs/briefings',
    'backlog/active',
    'backlog/paused',
    'backlog/done',
  ]) {
    fs.mkdirSync(path.join(ctx.projectRoot, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(ctx.projectRoot, '.swarmforge', 'tmux-socket'), sock + '\n');
  fs.writeFileSync(
    path.join(ctx.projectRoot, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${ctx.projectRoot}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
  );

  const fakeBin = path.join(ctx.projectRoot, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(fakeBin, 'tmux'), 0o755);
  ctx.fakeBin = fakeBin;

  // No real network/email/tmux ever reached from this fixture.
  ctx.env = {
    ...process.env,
    SWARMFORGE_ALLOW_TMP_DAEMON: '1',
  };
  delete ctx.env.TELEGRAM_BOT_TOKEN;
  delete ctx.env.TELEGRAM_CHAT_ID;
  delete ctx.env.RESEND_API_KEY;
}

function makeSetsidStubBin(ctx) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl878-setsid-stub-'));
  const stub = path.join(dir, 'setsid');
  fs.writeFileSync(stub, '#!/usr/bin/env bash\nexec "$@"\n');
  fs.chmodSync(stub, 0o755);
  return dir;
}

// Spawns the real handoffd.bb through the real shared library, exactly the
// shape every fixed wiring script now uses. Returns the pid via a marker
// file, since the library backgrounds the daemon inside a `bash -c`
// subprocess whose own $! is not observable from Node directly.
//
// stdio MUST be 'ignore' (never Node's default piped stdout/stderr): the
// setsid branch backgrounds the daemon with no redirection of its own
// (matching production), so a long-lived grandchild inherits whatever fds
// this `bash -c` process has open at fork time. A Node sync exec call that
// pipes output waits for that pipe's write end to close on ALL holders,
// including the still-running daemon - which never happens until the
// daemon itself exits, hanging this call forever. Capture only what's
// needed (the missing-tool error text) via an explicit file redirect
// inside the script, never via Node's own stdio pipe.
function spawnDaemon(ctx) {
  const pidFile = path.join(ctx.projectRoot, 'daemon.pid');
  const errFile = path.join(ctx.projectRoot, 'spawn.stderr');
  const shellPath = ctx.setsidStubDir
    ? `${ctx.setsidStubDir}:${ctx.fakeBin}:${ctx.env.PATH}`
    : `${ctx.fakeBin}:${ctx.env.PATH}`;
  const script = [
    `source ${JSON.stringify(SPAWN_LIB)}`,
    `portable_spawn_daemon_or_fail ${JSON.stringify(ctx.requiredInterpreter || 'bb')} bb ${JSON.stringify(HANDOFFD)} ${JSON.stringify(ctx.projectRoot)} 2>${JSON.stringify(errFile)}`,
    `echo $! > ${JSON.stringify(pidFile)}`,
  ].join('\n');

  const res = execSyncSafe('bash', ['-c', script], {
    env: { ...ctx.env, PATH: shellPath },
  });
  ctx.spawnResult = {
    code: res.code,
    stderr: fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : '',
  };
  if (fs.existsSync(pidFile)) {
    ctx.daemonPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
  }
}

function execSyncSafe(cmd, args, opts) {
  try {
    execFileSync(cmd, args, { ...opts, stdio: ['ignore', 'ignore', 'ignore'] });
    return { code: 0 };
  } catch (e) {
    return { code: e.status ?? 1 };
  }
}

function cleanupFixture(ctx) {
  if (ctx.daemonPid && isAlive(ctx.daemonPid)) {
    try {
      process.kill(ctx.daemonPid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  for (const dir of [ctx.projectRoot, ctx.setsidStubDir].filter(Boolean)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a handoffd wiring test pointed at a private fixture root$/,
    (ctx) => buildMinimalFixture(ctx),
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a fake bin directory ahead of PATH so no real tmux or mailer is touched$/,
    () => {
      // Marker only - buildMinimalFixture above already wired ctx.fakeBin
      // ahead of PATH at spawn time and stripped the mailer env vars.
    },
    FEATURE_NAME
  );

  // ── Given: setsid availability ──────────────────────────────────────
  registry.defineScoped(
    /^a host on which setsid is (.+)$/,
    (ctx, availability) => {
      const known = knownSetsidAvailability(availability);
      ctx.setsidStubDir = known === 'present' ? makeSetsidStubBin(ctx) : null;
    },
    FEATURE_NAME
  );

  // ── Given: required tool missing ────────────────────────────────────
  registry.defineScoped(
    /^a host on which a tool the daemon spawn requires cannot be resolved$/,
    (ctx) => {
      ctx.requiredInterpreter = 'bl878-definitely-not-a-real-interpreter';
    },
    FEATURE_NAME
  );

  // ── When ──────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the test spawns the handoff daemon$/,
    (ctx) => {
      ctx.spawnStartedAtMs = Date.now();
      spawnDaemon(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the test finishes and runs its cleanup$/,
    async (ctx) => {
      fs.mkdirSync(path.join(ctx.projectRoot, '.swarmforge', 'daemon'), { recursive: true });
      fs.writeFileSync(path.join(ctx.projectRoot, '.swarmforge', 'daemon', 'stop'), '');
      await waitFor(() => !isAlive(ctx.daemonPid), 15000);
      // Safety net, same as every fixed wiring script's own cleanup(): if
      // the stop-file check somehow didn't land in time, this proof must
      // never itself leak a runaway daemon regardless.
      if (ctx.daemonPid && isAlive(ctx.daemonPid)) {
        try {
          process.kill(ctx.daemonPid, 'SIGTERM');
        } catch {
          // already gone
        }
        await waitFor(() => !isAlive(ctx.daemonPid), 3000);
      }
    },
    FEATURE_NAME
  );

  // ── Then ──────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the daemon starts$/,
    async (ctx) => {
      const ok = await waitFor(() => fs.existsSync(logFile(ctx)) && fs.readFileSync(logFile(ctx), 'utf8').includes(' started'), 15000);
      if (!ok) {
        throw new Error(
          `expected handoffd.bb to log "started" within 15s; spawn result: ${JSON.stringify(ctx.spawnResult)}; log: ${
            fs.existsSync(logFile(ctx)) ? fs.readFileSync(logFile(ctx), 'utf8') : '(no log file)'
          }`
        );
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the test reaches its assertions and passes$/,
    (ctx) => {
      try {
        if (!ctx.daemonPid || !isAlive(ctx.daemonPid)) {
          throw new Error(`expected the daemon (pid ${ctx.daemonPid}) to still be alive and reachable for assertions`);
        }
      } finally {
        cleanupFixture(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no handoff daemon rooted at that fixture root is still running$/,
    (ctx) => {
      try {
        if (ctx.daemonPid && isAlive(ctx.daemonPid)) {
          throw new Error(`expected pid ${ctx.daemonPid} (rooted at ${ctx.projectRoot}) to no longer be running after cleanup`);
        }
      } finally {
        cleanupFixture(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the test fails naming the missing tool$/,
    (ctx) => {
      try {
        if (ctx.spawnResult.code === 0) {
          throw new Error('expected a nonzero exit when the required interpreter is missing');
        }
        if (!ctx.spawnResult.stderr.includes(ctx.requiredInterpreter)) {
          throw new Error(`expected the failure to name the missing tool "${ctx.requiredInterpreter}", got: ${ctx.spawnResult.stderr}`);
        }
      } finally {
        cleanupFixture(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it fails without waiting out its daemon-startup timeout$/,
    (ctx) => {
      const elapsedMs = Date.now() - ctx.spawnStartedAtMs;
      if (elapsedMs > 5000) {
        throw new Error(`expected the missing-tool failure within 5s, took ${elapsedMs}ms - looks like it waited out a timeout instead`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
