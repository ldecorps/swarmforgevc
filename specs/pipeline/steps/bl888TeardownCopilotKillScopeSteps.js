'use strict';

// BL-888: teardown copilot kill is root-scoped. Drives the REAL
// kill_pipeline_swarm.sh against a temp root; fixtures are harmless sleep
// processes with crafted argv via bash `exec -a` — never real agents.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const KILL_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'kill_pipeline_swarm.sh');

const FEATURE_NAME = 'BL-888 pipeline teardown copilot kill scope';

const KNOWN_PROCESS_ROOT = {
  'a different project root': 'other',
  'the root under teardown': 'same',
};
const KNOWN_FATE = {
  'still running': 'alive',
  signaled: 'dead',
};

function knownProcessRoot(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_PROCESS_ROOT, value)) {
    throw new Error(`bl888: unrecognized <process root> "${value}"`);
  }
  return KNOWN_PROCESS_ROOT[value];
}

function knownFate(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_FATE, value)) {
    throw new Error(`bl888: unrecognized <fate> "${value}"`);
  }
  return KNOWN_FATE[value];
}

function ensureRoot(ctx) {
  if (ctx.teardownRoot) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl888-teardown-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  ctx.teardownRoot = root;
  ctx.fixturePids = [];
}

function reapFixtures(ctx) {
  for (const child of ctx.fixtureChildren || []) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  for (const pid of ctx.fixturePids || []) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  ctx.fixtureChildren = [];
  ctx.fixturePids = [];
}

function fixtureArgvForKind(ctx, kind) {
  const pathInArgv =
    kind === 'same'
      ? path.join(ctx.teardownRoot, '.worktrees', 'coder')
      : '/foreign/bl888-other-root/.worktrees/coder';
  return `copilot -C ${pathInArgv} --name SwarmForge coder`;
}

function spawnFixture(ctx, argvLabel) {
  // Keep the child attached so a TERM'd sleep is reaped (not left as a
  // zombie that still satisfies process.kill(pid, 0)).
  const child = spawn('bash', ['-c', `exec -a ${JSON.stringify(argvLabel)} sleep 120`], {
    stdio: 'ignore',
  });
  ctx.fixtureChildren = ctx.fixtureChildren || [];
  ctx.fixtureChildren.push(child);
  ctx.fixturePids.push(child.pid);
  ctx.lastFixturePid = child.pid;
  spawnSync('sleep', ['0.15']);
  return child.pid;
}

function fixtureIsAlive(pid) {
  const statusPath = `/proc/${pid}/status`;
  if (!fs.existsSync(statusPath)) return false;
  const status = fs.readFileSync(statusPath, 'utf8');
  // Zombie = already signaled; treat as not alive for fate checks.
  if (/^State:\s*Z/m.test(status)) return false;
  return true;
}

function assertFixtureFate(ctx, fate) {
  const pid = ctx.lastFixturePid;
  const alive = fixtureIsAlive(pid);
  if (fate === 'alive' && !alive) {
    throw new Error(`expected fixture pid ${pid} still running, but it is gone`);
  }
  if (fate === 'dead' && alive) {
    throw new Error(`expected fixture pid ${pid} signaled, but it is still running`);
  }
  if (fate !== 'dead') return;
  ctx.fixturePids = (ctx.fixturePids || []).filter((p) => p !== pid);
  for (const child of ctx.fixtureChildren || []) {
    if (child.pid === pid) child.kill('SIGKILL');
  }
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a project root under teardown$/,
    (ctx) => {
      ensureRoot(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a copilot-shaped fixture process whose command line names (.+)$/,
    (ctx, processRootPhrase) => {
      ensureRoot(ctx);
      const kind = knownProcessRoot(processRootPhrase.trim());
      spawnFixture(ctx, fixtureArgvForKind(ctx, kind));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no copilot-shaped process on the host$/,
    (ctx) => {
      ensureRoot(ctx);
      reapFixtures(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(/^an otherwise clean teardown condition$/, () => {}, FEATURE_NAME);

  registry.defineScoped(
    /^kill_pipeline_swarm\.sh runs against the root under teardown$/,
    (ctx) => {
      ensureRoot(ctx);
      const res = spawnSync('bash', [KILL_SH, ctx.teardownRoot], {
        encoding: 'utf8',
        env: { ...process.env },
      });
      ctx.killStatus = res.status;
      ctx.killStdout = `${res.stdout || ''}${res.stderr || ''}`;
      const audit = path.join(ctx.teardownRoot, '.swarmforge', 'daemon', 'kill-all-audit.log');
      ctx.killLog = fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8') : ctx.killStdout;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the fixture process is (.+)$/,
    (ctx, fatePhrase) => {
      assertFixtureFate(ctx, knownFate(fatePhrase.trim()));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the teardown log reports "([^"]+)"$/,
    (ctx, line) => {
      if (!ctx.killLog.includes(line)) {
        throw new Error(`expected audit log to include "${line}", got:\n${ctx.killLog}`);
      }
      // Outline scenarios end here — reap leftover fixtures / temp root.
      if (ctx.killStatus === 0) {
        reapFixtures(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the teardown exits zero$/,
    (ctx) => {
      if (ctx.killStatus !== 0) {
        throw new Error(`expected kill_pipeline exit 0, got ${ctx.killStatus}\n${ctx.killLog}`);
      }
      reapFixtures(ctx);
      if (ctx.teardownRoot) {
        fs.rmSync(ctx.teardownRoot, { recursive: true, force: true });
        ctx.teardownRoot = null;
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps, FEATURE_NAME };
