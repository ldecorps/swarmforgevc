'use strict';

// BL-857: step handlers for "exactly one process owns the production
// tunnel name, and orphans are reaped". Drives the REAL
// stop_ancillary_services.sh / launch_resident_spy_tunnel.sh /
// tunnel_ownership_lib.sh against real filesystem fixtures with a stubbed
// cloudflared binary and real (harmless, self-spawned) background
// processes standing in for a live tunnel - never a mocked reap decision.
// Registered via defineScoped (BL-425 pattern): generic phrasing here
// ("it is still running", "the stop path runs") is plausible enough that
// an unscoped registration could collide with another feature's own step.
//
// Deliberately never uses the real production tunnel name
// ("swarmforge-bubble") anywhere in this file - a dev/CI host may have the
// real operator's tunnel running under that exact name at the same time,
// and this file's own fixtures spawn REAL processes bound to whatever
// name they're given. Reusing the real name here would be this ticket's
// own incident, self-inflicted by its acceptance test.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STOP = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'stop_ancillary_services.sh');
const LAUNCH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_resident_spy_tunnel.sh');
const OWNERSHIP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tunnel_ownership_lib.sh');

const FEATURE_NAME = 'exactly one process owns the production tunnel name, and orphans are reaped';
const TUNNEL_NAME = 'bl857-aps-tunnel';
const OTHER_TUNNEL_NAME = 'bl857-aps-unrelated-tunnel';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

function ownershipLib(args, env) {
  return spawnSync('bash', [OWNERSHIP_LIB, ...args], { encoding: 'utf8', env });
}

// Writes a fake "cloudflared"-named executable that just sleeps, then
// backgrounds it with argv shaped like a real named-tunnel invocation
// ("... run <name>"), stdout/stderr redirected away from this process's
// own pipes (a bare `&` inside a captured subshell otherwise keeps the
// pipe open for the process's whole lifetime and hangs the caller).
function spawnFakeCloudflared(name) {
  const dir = mkTmp('bl857-aps-fake-cf-');
  const bin = path.join(dir, 'cloudflared');
  fs.writeFileSync(bin, ['#!/usr/bin/env bash', 'sleep 300', ''].join('\n'));
  fs.chmodSync(bin, 0o755);
  const child = spawnSync('bash', [
    '-c',
    `"$1" tunnel --config "$2/fake-config.yml" --no-autoupdate run "$3" >/dev/null 2>&1 & echo $!`,
    '_',
    bin,
    dir,
    name,
  ]);
  const pid = Number(child.stdout.toString().trim());
  return { pid, dir };
}

// Every scenario's Background spawns a live operator process; there is no
// afterEach/teardown hook in this acceptance runtime, so each scenario's
// own terminal step kills whatever it left running (bl787's own inline-kill
// convention).
function killAllSpawned(ctx) {
  for (const pid of ctx.spawnedPids || []) {
    killPid(pid);
  }
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the operator instance owns the production tunnel name$/,
    (ctx) => {
      ctx.operatorRoot = mkTmp('bl857-aps-operator-');
      ctx.opDir = path.join(ctx.operatorRoot, '.swarmforge', 'operator');
      fs.mkdirSync(ctx.opDir, { recursive: true });
      fs.writeFileSync(
        path.join(ctx.opDir, 'named-tunnel.env'),
        `SWARMFORGE_NAMED_TUNNEL=${TUNNEL_NAME}\nSWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.aps-test.invalid\nSWARMFORGE_CLOUDFLARED_CONFIG=${ctx.operatorRoot}/config.yml\n`
      );
      // Registry lives inside this same isolated root's own HOME-shaped
      // tree - fine here (unlike the launching-tree-deleted scenarios
      // below, this root is never deleted), and keeps every direct
      // ownership-lib call and stop_ancillary_services.sh's own internal
      // calls agreeing on one place.
      ctx.registryDir = path.join(ctx.operatorRoot, '.swarmforge', 'tunnels');
      ctx.env = { ...process.env, SWARMFORGE_TUNNEL_REGISTRY_DIR: ctx.registryDir };
      ownershipLib(['register-operator-root', ctx.operatorRoot], ctx.env);

      const operator = spawnFakeCloudflared(TUNNEL_NAME);
      ctx.operatorPid = operator.pid;
      ownershipLib(['record-owner', TUNNEL_NAME, String(ctx.operatorPid), ctx.operatorRoot], ctx.env);
      ctx.spawnedPids = [ctx.operatorPid];
    },
    FEATURE_NAME
  );

  // ── orphan-reaped-01 / operator-instance-survives-02 ─────────────────────
  registry.defineScoped(
    /^a tunnel bound to the production tunnel name whose launching tree has been deleted$/,
    (ctx) => {
      const orphan = spawnFakeCloudflared(TUNNEL_NAME);
      ctx.orphanPid = orphan.pid;
      ctx.spawnedPids.push(orphan.pid);
      // The whole point: the tree that launched it is gone, so nothing
      // (local pidfile or registry) can ever point at it again.
      fs.rmSync(orphan.dir, { recursive: true, force: true });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the stop path runs$/,
    (ctx) => {
      ctx.stopResult = spawnSync('bash', [STOP, ctx.operatorRoot], { encoding: 'utf8', timeout: 30000, env: ctx.env });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^that tunnel is no longer running$/,
    (ctx) => {
      if (isAlive(ctx.orphanPid)) {
        throw new Error(`expected the orphan pid ${ctx.orphanPid} to have been reaped by the stop path`);
      }
      killAllSpawned(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the operator instance is still running$/,
    (ctx) => {
      if (!isAlive(ctx.operatorPid)) {
        throw new Error(`expected the operator instance pid ${ctx.operatorPid} to survive the stop path`);
      }
      killAllSpawned(ctx);
    },
    FEATURE_NAME
  );

  // ── sandbox-cannot-bind-production-name-03 ────────────────────────────
  registry.defineScoped(
    /^a sandbox launches a tunnel under its own root$/,
    (ctx) => {
      const sandbox = mkTmp('bl857-aps-sandbox-');
      const binDir = path.join(sandbox, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const fakeCf = path.join(binDir, 'cloudflared');
      fs.writeFileSync(
        fakeCf,
        [
          '#!/usr/bin/env bash',
          'DIR="$(cd "$(dirname "$0")" && pwd)"',
          'echo "INF Registered tunnel connection connIndex=0"',
          'sleep 30 &',
          'echo $! > "$DIR/cf.pid"',
          'wait',
          '',
        ].join('\n')
      );
      fs.chmodSync(fakeCf, 0o755);
      const cfHome = path.join(sandbox, 'cloudflared-home');
      fs.mkdirSync(cfHome, { recursive: true });
      const configYml = path.join(cfHome, 'config.yml');
      fs.writeFileSync(
        configYml,
        `tunnel: 00000000-0000-0000-0000-0000000000bb\ncredentials-file: ${path.join(cfHome, 'cred.json')}\ningress:\n  - hostname: bubble.aps-test.invalid\n    service: http://127.0.0.1:8765\n  - service: http_status:404\n`
      );
      fs.writeFileSync(path.join(cfHome, 'cred.json'), '{}');
      ctx.sandbox = sandbox;
      ctx.sandboxLaunchResult = spawnSync('bash', [LAUNCH, sandbox], {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          SWARMFORGE_TUNNEL_REGISTRY_DIR: ctx.registryDir,
          CLOUDFLARED: fakeCf,
          SWARMFORGE_NAMED_TUNNEL: TUNNEL_NAME,
          SWARMFORGE_NAMED_TUNNEL_HOSTNAME: 'bubble.aps-test.invalid',
          SWARMFORGE_CLOUDFLARED_CONFIG: configYml,
          SWARMFORGE_SKIP_CAFFEINATE: '1',
        },
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it does not bind the production tunnel name$/,
    (ctx) => {
      if (ctx.sandboxLaunchResult.status === 0) {
        throw new Error('expected the sandbox launch to be refused (exit non-zero)');
      }
      if (!/not the registered operator root/i.test(ctx.sandboxLaunchResult.stderr || '')) {
        throw new Error(`expected the refusal to name the operator-root reason, got: ${ctx.sandboxLaunchResult.stderr}`);
      }
      if (fs.existsSync(path.join(ctx.sandbox, 'bin', 'cf.pid'))) {
        throw new Error('expected cloudflared to never have been invoked by the refused launch');
      }
      killAllSpawned(ctx);
    },
    FEATURE_NAME
  );

  // ── test-teardown-leaves-nothing-04 ───────────────────────────────────
  registry.defineScoped(
    /^a test run has launched a tunnel of its own$/,
    (ctx) => {
      // "A test run" that owns its own root plays by the same rules any
      // operator does - it registers itself before it may bind a named
      // tunnel. Its OWN teardown then goes through the same real stop
      // path, proving the mechanism is usable for test cleanup, not just
      // the primary operator's shutdown.
      const testRoot = mkTmp('bl857-aps-testrun-');
      const registryDir = path.join(testRoot, '.swarmforge', 'tunnels');
      const env = { ...process.env, SWARMFORGE_TUNNEL_REGISTRY_DIR: registryDir };
      ownershipLib(['register-operator-root', testRoot], env);

      const binDir = path.join(testRoot, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const fakeCf = path.join(binDir, 'cloudflared');
      fs.writeFileSync(
        fakeCf,
        [
          '#!/usr/bin/env bash',
          'DIR="$(cd "$(dirname "$0")" && pwd)"',
          'echo "INF Registered tunnel connection connIndex=0"',
          'sleep 60 &',
          'echo $! > "$DIR/cf.pid"',
          'wait',
          '',
        ].join('\n')
      );
      fs.chmodSync(fakeCf, 0o755);
      const cfHome = path.join(testRoot, 'cloudflared-home');
      fs.mkdirSync(cfHome, { recursive: true });
      const configYml = path.join(cfHome, 'config.yml');
      fs.writeFileSync(
        configYml,
        `tunnel: 00000000-0000-0000-0000-0000000000cc\ncredentials-file: ${path.join(cfHome, 'cred.json')}\ningress:\n  - hostname: bubble.aps-test-run.invalid\n    service: http://127.0.0.1:8765\n  - service: http_status:404\n`
      );
      fs.writeFileSync(path.join(cfHome, 'cred.json'), '{}');

      const launchName = `${TUNNEL_NAME}-testrun`;
      const launchResult = spawnSync('bash', [LAUNCH, testRoot], {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...env,
          CLOUDFLARED: fakeCf,
          SWARMFORGE_NAMED_TUNNEL: launchName,
          SWARMFORGE_NAMED_TUNNEL_HOSTNAME: 'bubble.aps-test-run.invalid',
          SWARMFORGE_CLOUDFLARED_CONFIG: configYml,
          SWARMFORGE_SKIP_CAFFEINATE: '1',
        },
      });
      if (launchResult.status !== 0) {
        throw new Error(`expected the test run's own launch to succeed, got ${launchResult.status}: ${launchResult.stderr}`);
      }
      ctx.testRunRoot = testRoot;
      ctx.testRunEnv = env;
      ctx.testRunName = launchName;
      ctx.testRunPid = Number(
        fs.readFileSync(path.join(testRoot, '.swarmforge', 'operator', 'resident-spy-cloudflared.pid'), 'utf8').trim()
      );
      if (!isAlive(ctx.testRunPid)) {
        throw new Error('expected the test run tunnel to be alive right after launch');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^that test run tears down$/,
    (ctx) => {
      ctx.testRunStopResult = spawnSync('bash', [STOP, ctx.testRunRoot], {
        encoding: 'utf8',
        timeout: 30000,
        env: ctx.testRunEnv,
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no tunnel from that run is still running$/,
    (ctx) => {
      if (isAlive(ctx.testRunPid)) {
        throw new Error(`expected the test run's own tunnel pid ${ctx.testRunPid} to be gone after its own teardown`);
      }
      // The Background's own operator instance is untouched by this
      // scenario (a wholly separate root/registry) and still needs
      // cleanup.
      killAllSpawned(ctx);
    },
    FEATURE_NAME
  );

  // ── stale-ownership-record-05 ──────────────────────────────────────────
  // Deliberately scoped to a DIFFERENT name than the Background's live
  // operator instance (TUNNEL_NAME), not by overwriting its own record:
  // stop_ancillary_services.sh's LOCAL pidfile signal (an unrelated,
  // pre-existing mechanism this ticket does not touch) unconditionally
  // kills whatever pid is in THIS root's own resident-spy-cloudflared.pid
  // BEFORE reaping even runs - so the only way "the operator instance is
  // still running" and "a stale record exists" can BOTH be true after the
  // stop path runs is for the stale record to belong to some other name
  // reaping never even considers touching the Background operator for.
  // That is also the more realistic shape of the bug this guards against:
  // a leftover/corrupted record for one tunnel must never affect a
  // DIFFERENT, healthy one.
  registry.defineScoped(
    /^an ownership record whose process has already exited$/,
    (ctx) => {
      const staleName = `${TUNNEL_NAME}-stale`;
      fs.writeFileSync(
        path.join(ctx.opDir, 'named-tunnel.env'),
        `SWARMFORGE_NAMED_TUNNEL=${staleName}\nSWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.aps-test.invalid\nSWARMFORGE_CLOUDFLARED_CONFIG=${ctx.operatorRoot}/config.yml\n`
      );

      const dead = spawnFakeCloudflared(staleName);
      killPid(dead.pid);
      // Retries its own SIGKILL alongside the wait - a loaded host can
      // leave a just-killed pid reporting alive for longer than a single
      // short poll window tolerates.
      spawnSync('bash', ['-c', `for i in $(seq 1 50); do kill -9 ${dead.pid} 2>/dev/null; kill -0 ${dead.pid} 2>/dev/null || exit 0; sleep 0.1; done`]);
      if (isAlive(dead.pid)) {
        throw new Error(`expected fixture pid ${dead.pid} to be dead before recording it as stale`);
      }
      ownershipLib(['record-owner', staleName, String(dead.pid), ctx.operatorRoot], ctx.env);

      // A genuine orphan for the SAME (stale-recorded) name - if the stale
      // record were wrongly treated as blanket protection for its name
      // rather than a specific, verified-live pid, this would survive the
      // stop path when it must not.
      const impersonator = spawnFakeCloudflared(staleName);
      ctx.spawnedPids.push(impersonator.pid);

      ctx.staleName = staleName;
      ctx.staleDeadPid = dead.pid;
      ctx.staleImpersonatorPid = impersonator.pid;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the record is not treated as a live owner$/,
    (ctx) => {
      const readBack = ownershipLib(['read-owner-pid', ctx.staleName], ctx.env).stdout.trim();
      if (readBack !== String(ctx.staleDeadPid)) {
        throw new Error(`expected the stale record to be left as-is (not silently repaired), got "${readBack}"`);
      }
      if (isAlive(ctx.staleImpersonatorPid)) {
        throw new Error(
          `expected the live impersonator ${ctx.staleImpersonatorPid} for the stale-recorded name to be reaped, proving the dead pid never granted it protection`
        );
      }
    },
    FEATURE_NAME
  );

  // ── reap-is-name-scoped-06 ─────────────────────────────────────────────
  registry.defineScoped(
    /^a tunnel bound to some other tunnel name$/,
    (ctx) => {
      const other = spawnFakeCloudflared(OTHER_TUNNEL_NAME);
      ctx.otherNamePid = other.pid;
      ctx.spawnedPids.push(other.pid);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^that tunnel is still running$/,
    (ctx) => {
      if (!isAlive(ctx.otherNamePid)) {
        throw new Error(`expected the other-name tunnel pid ${ctx.otherNamePid} to be untouched by a reap scoped to a different name`);
      }
      killAllSpawned(ctx);
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
