'use strict';

// BL-1292: step handlers driving the REAL isAlive(pid, name) helper
// (extension/test/helpers/fixtureLiveness.js, the same module
// bl857TunnelOwnershipInvariants.property.test.js now imports) against
// REAL processes - never a mock or a fabricated process table.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { isAlive, spawnZombie } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'fixtureLiveness.js'));

const FEATURE = "A fixture's liveness is decided by identity, not by a bare pid signal";

function uniqueName(label) {
  return `bl1292-${label}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Spawns a real, harmless background process whose command line contains
// `run <name>` - the same technique bl857's own spawnFakeCloudflared uses
// (a fake binary that ignores its own arguments and just sleeps, invoked
// with the same tunnel-name-bearing CLI shape a real cloudflared gets) -
// via bash so the process outlives the short-lived spawning wrapper.
function spawnRunning(name) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bl1292-fake-cf-'));
  const bin = path.join(dir, 'cloudflared');
  fs.writeFileSync(bin, '#!/usr/bin/env bash\nsleep 300\n');
  fs.chmodSync(bin, 0o755);
  const child = spawnSync('bash', [
    '-c',
    `"$1" tunnel --config "$2/fake-config.yml" --no-autoupdate run "$3" >/dev/null 2>&1 & echo $!`,
    '_',
    bin,
    dir,
    name,
  ]);
  return Number(child.stdout.toString().trim());
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

function waitForGone(pid, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
  }
  return false;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture process the reap has just signalled$/, (ctx) => {
    ctx.bl1292 = { cleanups: [] };
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^the pid is (.+)$/, async (ctx, situation) => {
    const name = uniqueName('outline');
    switch (situation) {
      case 'still running the fixture': {
        const pid = spawnRunning(name);
        ctx.bl1292.cleanups.push(() => killPid(pid));
        ctx.bl1292.subjectPid = pid;
        ctx.bl1292.subjectName = name;
        break;
      }
      case 'a zombie awaiting its reaper': {
        const zombie = await spawnZombie(name);
        assert.ok(zombie.confirmedZombie, `expected a genuine zombie (/proc State: Z), got pid ${zombie.pid}`);
        ctx.bl1292.cleanups.push(zombie.cleanup);
        ctx.bl1292.subjectPid = zombie.pid;
        ctx.bl1292.subjectName = name;
        break;
      }
      case 'reused by an unrelated process': {
        // A live pid whose command line does NOT carry the name being
        // asked about - from isAlive's own perspective this is exactly
        // what OS-level pid reuse looks like (a signallable pid running a
        // DIFFERENT identity than expected), and it is what the mechanism
        // must reject regardless of whether the kernel actually recycled
        // the number.
        const unrelatedPid = spawnRunning(uniqueName('unrelated'));
        ctx.bl1292.cleanups.push(() => killPid(unrelatedPid));
        ctx.bl1292.subjectPid = unrelatedPid;
        ctx.bl1292.subjectName = name; // the ORIGINAL fixture's name, not the unrelated process's own
        break;
      }
      case 'absent entirely': {
        const pid = spawnRunning(name);
        killPid(pid);
        const gone = waitForGone(pid, 2000);
        assert.ok(gone, `expected pid ${pid} to fully exit`);
        ctx.bl1292.subjectPid = pid;
        ctx.bl1292.subjectName = name;
        break;
      }
      default:
        throw new Error(`unknown <situation>: ${situation}`);
    }
  });

  scoped(/^the test asks whether the fixture is still alive$/, (ctx) => {
    ctx.bl1292.result = isAlive(ctx.bl1292.subjectPid, ctx.bl1292.subjectName);
  });

  scoped(/^the answer is (alive|gone)$/, (ctx, expected) => {
    assert.equal(ctx.bl1292.result, expected === 'alive', `expected isAlive to answer ${expected}, got ${ctx.bl1292.result}`);
    ctx.bl1292.cleanups.forEach((fn) => fn());
    ctx.bl1292.cleanups = [];
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  const OWNERSHIP_LIB = path.join(EXTENSION_DIR, '..', 'swarmforge', 'scripts', 'tunnel_ownership_lib.sh');

  scoped(/^a target bound to its own unique tunnel name and never registered$/, (ctx) => {
    ctx.bl1292.targetName = uniqueName('sc02-target');
    ctx.bl1292.targetPid = spawnRunning(ctx.bl1292.targetName);
    ctx.bl1292.registryDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bl1292-registry-'));
  });

  scoped(/^a reap scoped to the target runs$/, (ctx) => {
    spawnSync('bash', [OWNERSHIP_LIB, 'reap-orphans', ctx.bl1292.targetName, ''], {
      env: { ...process.env, SWARMFORGE_TUNNEL_REGISTRY_DIR: ctx.bl1292.registryDir },
    });
  });

  scoped(/^the target is reported gone by an identity-checked liveness answer$/, (ctx) => {
    assert.equal(isAlive(ctx.bl1292.targetPid, ctx.bl1292.targetName), false, 'expected the unregistered target to be reaped');
    killPid(ctx.bl1292.targetPid);
    fs.rmSync(ctx.bl1292.registryDir, { recursive: true, force: true });
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a bystander whose tunnel name merely extends the target's$/, (ctx) => {
    ctx.bl1292.targetName = uniqueName('sc03-target');
    ctx.bl1292.bystanderName = `old-${ctx.bl1292.targetName}`;
    ctx.bl1292.targetPid = spawnRunning(ctx.bl1292.targetName);
    ctx.bl1292.bystanderPid = spawnRunning(ctx.bl1292.bystanderName);
    ctx.bl1292.registryDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bl1292-registry-'));
  });

  scoped(/^the bystander is still alive under the same identity check$/, (ctx) => {
    assert.equal(
      isAlive(ctx.bl1292.bystanderPid, ctx.bl1292.bystanderName),
      true,
      `expected the near-miss bystander ("${ctx.bl1292.bystanderName}") to survive a reap scoped to "${ctx.bl1292.targetName}"`
    );
    killPid(ctx.bl1292.targetPid);
    killPid(ctx.bl1292.bystanderPid);
    fs.rmSync(ctx.bl1292.registryDir, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
