'use strict';

// BL-782: expedite_cli liveness probes match only processes belonging to the
// audited root. Drives the REAL expedite_cli.bb --probe-liveness path (no
// EXPEDITE_PROBE_FILE) and the REAL shell suites test_expedite_cli.sh /
// test_lifecycle_script_scope.sh — never a JS reimplementation of ps matching.
//
// QA bounce 20260826 (D1): each acceptance scenario gets a fresh ctx, so
// ctx-scoped reapDecoys cannot see decoys from prior outline rows. Track
// decoys at module scope, unref them so Node does not wait on open handles,
// and reap in afterEach as well as at scenario boundaries.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');
const EXPEDITE_SUITE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_expedite_cli.sh');
const LIFECYCLE_SUITE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_lifecycle_script_scope.sh');

const FEATURE_NAME =
  'expedite_cli liveness probes match only processes belonging to the audited root';

const KNOWN_PROBES = {
  handoffd: 'handoffd',
  'handoffd-supervisor': 'handoffd-supervisor',
  babysitterd: 'babysitterd',
  operator: 'operator',
};

/** @type {Set<import('node:child_process').ChildProcess>} */
const liveDecoys = new Set();

function knownProbe(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_PROBES, value)) {
    throw new Error(`bl782: unrecognized <probe> example value "${value}"`);
  }
  return KNOWN_PROBES[value];
}

function killChild(child) {
  if (!child || child.killed) {
    return;
  }
  try {
    if (child.pid) {
      process.kill(child.pid, 'SIGKILL');
    }
  } catch {
    /* already gone */
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

function reapDecoys(ctx) {
  for (const child of liveDecoys) {
    killChild(child);
  }
  liveDecoys.clear();
  if (ctx) {
    ctx.decoys = [];
  }
}

afterEach(() => {
  reapDecoys(null);
});

function spawnDecoy(argv) {
  const child = spawn('bash', ['-c', `exec -a ${JSON.stringify(argv)} sleep 600`], {
    stdio: 'ignore',
  });
  // Keep the handle for explicit kill, but do not pin the event loop open
  // waiting for sleep 600 to exit (QA D1 hang).
  child.unref();
  liveDecoys.add(child);
  child.once('exit', () => {
    liveDecoys.delete(child);
  });
  return child;
}

function spawnNeighbourDecoys(ctx, prefix, argvList) {
  reapDecoys(ctx);
  const neighbourRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  ctx.neighbourRoot = neighbourRoot;
  ctx.decoys = argvList.map((argv) => spawnDecoy(argv.replace(/\{root\}/g, neighbourRoot)));
  spawnSync('sleep', ['0.2']);
}

function probeLiveness(root) {
  const env = { ...process.env };
  delete env.EXPEDITE_PROBE_FILE;
  const res = spawnSync('bb', [CLI, '--probe-liveness', root], {
    encoding: 'utf8',
    env,
    timeout: 60_000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  if (res.status !== 0) {
    throw new Error(`expedite_cli --probe-liveness exited ${res.status}:\n${out}`);
  }
  return JSON.parse(res.stdout.trim());
}

function probeCountsAsAlive(result, probeName) {
  const key = knownProbe(probeName);
  const val = result[key];
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'number') return val > 0;
  return Boolean(val);
}

function assertProbeAliveState(ctx, probe, expectAlive) {
  try {
    const alive = probeCountsAsAlive(ctx.probeResult, probe);
    if (expectAlive && !alive) {
      throw new Error(
        `expected probe "${probe}" to read alive for audited root, got: ${JSON.stringify(ctx.probeResult)}`,
      );
    }
    if (!expectAlive && alive) {
      throw new Error(
        `expected probe "${probe}" to read stopped with neighbour decoy alive, got: ${JSON.stringify(ctx.probeResult)}`,
      );
    }
  } finally {
    reapDecoys(ctx);
  }
}

function registerSteps(registry) {
  registry.defineScoped(
    /^expedite_cli is auditing project root "([^"]+)"$/,
    (ctx, root) => {
      reapDecoys(ctx);
      ctx.auditRoot = root;
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^a running process "([^"]+)"$/,
    (ctx, argv) => {
      const child = spawnDecoy(argv);
      ctx.decoys = ctx.decoys || [];
      ctx.decoys.push(child);
      spawnSync('sleep', ['0.15']);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^expedite_cli probes liveness without EXPEDITE_PROBE_FILE$/,
    (ctx) => {
      ctx.probeResult = probeLiveness(ctx.auditRoot);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^that process is not counted as alive for "([^"]+)"$/,
    (ctx, probe) => {
      assertProbeAliveState(ctx, probe, false);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^that process is counted as alive for "([^"]+)"$/,
    (ctx, probe) => {
      assertProbeAliveState(ctx, probe, true);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^real handoffd\.bb handoffd_supervisor\.bb and babysitterd\.sh processes for a different project root are alive throughout the run$/,
    (ctx) => {
      spawnNeighbourDecoys(ctx, 'bl782-beta-', [
        'bb {root}/swarmforge/scripts/handoffd.bb {root}',
        'bb {root}/swarmforge/scripts/handoffd_supervisor.bb {root}',
        '{root}/.swarmforge/operator/babysitterd.sh',
      ]);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^EXPEDITE_PROBE_FILE is not set for unpinned cases$/,
    (ctx) => {
      ctx.unsetProbeFile = true;
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^test_expedite_cli\.sh runs against its fixture roots$/,
    (ctx) => {
      const env = { ...process.env };
      if (ctx.unsetProbeFile) delete env.EXPEDITE_PROBE_FILE;
      const res = spawnSync('bash', [EXPEDITE_SUITE], {
        encoding: 'utf8',
        env,
        timeout: 300_000,
      });
      ctx.expediteSuite = { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^every unpinned case that should pass exits zero$/,
    (ctx) => {
      try {
        const { status, out } = ctx.expediteSuite || {};
        if (status !== 0 || !out.includes('test_expedite_cli: ALL PASS')) {
          throw new Error(`expected test_expedite_cli ALL PASS with neighbour decoys, got status ${status}:\n${out}`);
        }
      } finally {
        reapDecoys(ctx);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^a real handoffd\.bb for a different project root is alive throughout the run$/,
    (ctx) => {
      spawnNeighbourDecoys(ctx, 'bl782-neighbour-', ['bb {root}/swarmforge/scripts/handoffd.bb {root}']);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^test_lifecycle_script_scope\.sh runs$/,
    (ctx) => {
      const res = spawnSync('bash', [LIFECYCLE_SUITE], {
        encoding: 'utf8',
        timeout: 180_000,
      });
      ctx.lifecycleSuite = { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the suite exits zero$/,
    (ctx) => {
      try {
        const { status, out } = ctx.lifecycleSuite || {};
        if (status !== 0) {
          throw new Error(`expected test_lifecycle_script_scope exit 0 with neighbour handoffd, got ${status}:\n${out}`);
        }
      } finally {
        reapDecoys(ctx);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^expedite_cli probes the operator liveness signal$/,
    (ctx) => {
      ctx.operatorSource = fs.readFileSync(CLI, 'utf8');
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the probe either matches only processes belonging to "([^"]+)"$/,
    (ctx, root) => {
      const src = ctx.operatorSource || '';
      const scoped =
        src.includes('operator.prompt') &&
        src.includes('--remote-control Operator has no project root in argv');
      if (!scoped) {
        ctx.operatorScopeFailed = true;
        return;
      }
      const needleMatch = src.includes('operator.prompt') && src.includes(':operator (seq (pids-matching');
      if (!needleMatch) {
        ctx.operatorScopeFailed = true;
        return;
      }
      const alien = fs.mkdtempSync(path.join(os.tmpdir(), 'bl782-operator-alien-'));
      const alienChild = spawnDecoy(`${alien}/swarmforge/roles/operator.prompt`);
      try {
        spawnSync('sleep', ['0.15']);
        const result = probeLiveness(root);
        if (probeCountsAsAlive(result, 'operator')) {
          throw new Error(
            `operator probe matched alien prompt path under ${alien}; expected only ${root}`,
          );
        }
      } finally {
        killChild(alienChild);
        liveDecoys.delete(alienChild);
        fs.rmSync(alien, { recursive: true, force: true });
      }
    },
    FEATURE_NAME,
  );

  registry.define(
    /^Or the code documents why "--remote-control Operator" cannot be root-scoped by pattern alone$/,
    (ctx) => {
      try {
        if (!ctx.operatorScopeFailed) return;
        const src = ctx.operatorSource || fs.readFileSync(CLI, 'utf8');
        if (
          !src.includes('--remote-control Operator has no project root in argv') ||
          !src.includes('operator.prompt')
        ) {
          throw new Error(
            'operator probe is not root-scoped and source lacks documentation of why',
          );
        }
      } finally {
        reapDecoys(ctx);
      }
    },
  );
}

module.exports = { registerSteps, reapDecoys, spawnDecoy, liveDecoys };
