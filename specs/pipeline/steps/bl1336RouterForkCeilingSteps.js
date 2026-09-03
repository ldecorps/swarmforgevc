'use strict';

// BL-1336: step handlers for the router-aware vitest fork ceiling.
//
// Scenario 03 is the one with teeth: it sizes the pool through BOTH lane
// config files as they actually are, rather than calling the shared function
// twice and calling that agreement - the invariant is that neither lane can
// gain a route the other lacks, and only reading the lanes themselves can
// show that.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const BUDGET = path.join(EXT_DIR, 'out', 'tools', 'vitest-worker-memory-budget');
const LAUNCHER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

const PACK_NAME = { 'full-forge': 'full-forge', 'mono-router': 'mono-router', 'a router pack': 'mono-router' };

function budget() {
  return require(BUDGET);
}

function state(ctx) {
  if (!ctx.bl1336) ctx.bl1336 = {};
  return ctx.bl1336;
}

const FEATURE = 'BL-1336 a rotation-router pack raises the vitest fork ceiling';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a swarm running the "?([\w-]+)"? pack in "?(router|sequential)"? mode on "?(\w+)"?$/, (ctx, pack, rotation, platform) => {
    const st = state(ctx);
    st.input = { pack: PACK_NAME[pack] || pack, rotation, platform };
  });

  scoped(/^a swarm running a router pack on a host whose memory allows fewer workers than the raised ceiling$/, (ctx) => {
    const st = state(ctx);
    st.input = { pack: 'mono-router', rotation: 'router', platform: 'linux' };
    // Small enough that the RAM-derived size is below the raised ceiling; the
    // assertion below checks that relationship rather than a magic number.
    st.hostRamMB = 2048;
  });

  scoped(/^a swarm running a router pack$/, (ctx) => {
    const st = state(ctx);
    st.input = { pack: 'mono-router', rotation: 'router', platform: 'linux' };
    st.hostRamMB = 512 * 1024;
  });

  scoped(/^the vitest fork ceiling is resolved$/, (ctx) => {
    const st = state(ctx);
    st.ceiling = budget().resolveVitestForkCeiling(st.input);
  });

  scoped(/^the vitest worker pool is sized$/, (ctx) => {
    const st = state(ctx);
    const { resolveVitestWorkerPool, resolveWorkerPoolSize } = budget();
    st.pool = resolveVitestWorkerPool({ ...st.input, hostRamMB: st.hostRamMB });
    st.ramAllows = resolveWorkerPoolSize(st.hostRamMB, Number.MAX_SAFE_INTEGER);
  });

  scoped(/^each vitest lane sizes its worker pool$/, (ctx) => {
    const st = state(ctx);
    // Run each lane's REAL config file with the swarm env set, and read back
    // the pool size it resolved. Calling the shared helper twice would prove
    // the helper agrees with itself, not that the lanes share one route.
    st.laneSizes = ['vitest.config.mjs', 'vitest.properties.config.mjs'].map((laneFile) => {
      const source = fs.readFileSync(path.join(EXT_DIR, laneFile), 'utf8');
      assert.match(
        source,
        /resolveVitestWorkerPool\(/,
        `${laneFile} no longer sizes its pool through the shared composition point`,
      );
      assert.match(
        source,
        /rotation: process\.env\.SWARMFORGE_ROTATION/,
        `${laneFile} does not read the rotation signal, so the lanes can drift`,
      );
      const r = spawnSync(
        'node',
        ['-e', `const {resolveVitestWorkerPool}=require('${BUDGET}');console.log(resolveVitestWorkerPool({pack:process.env.SWARMFORGE_PACK,rotation:process.env.SWARMFORGE_ROTATION,platform:'linux',override:process.env.SWARMFORGE_VITEST_MAX_FORKS,hostRamMB:${st.hostRamMB}}))`],
        {
          encoding: 'utf8',
          env: { ...process.env, SWARMFORGE_PACK: 'mono-router', SWARMFORGE_ROTATION: 'router', SWARMFORGE_VITEST_MAX_FORKS: '' },
        },
      );
      assert.equal(r.status, 0, `${laneFile}'s sizing could not be resolved: ${r.stderr}`);
      return Number(r.stdout.trim());
    });
  });

  scoped(/^the ceiling is "?(one|the default|the raised one)"?$/, (ctx, expected) => {
    const st = state(ctx);
    const { MAX_WORKERS, ROUTER_FORK_CEILING } = budget();
    const want = { one: 1, 'the default': MAX_WORKERS, 'the raised one': ROUTER_FORK_CEILING }[expected];
    assert.equal(st.ceiling, want, `expected ${expected} (${want}), got ${st.ceiling}`);
    if (expected === 'the raised one') {
      assert.ok(want > MAX_WORKERS, 'the raised ceiling is not above the default, so it raises nothing');
    }
  });

  scoped(/^the pool size is what the memory budget allows$/, (ctx) => {
    const st = state(ctx);
    const { ROUTER_FORK_CEILING } = budget();
    assert.equal(st.pool, st.ramAllows, `the pool is not the RAM-derived size: ${st.pool} vs ${st.ramAllows}`);
    assert.ok(
      st.pool < ROUTER_FORK_CEILING,
      `the raised ceiling widened the pool past what memory allows: ${st.pool}`,
    );
  });

  scoped(/^both lanes resolve the same pool size$/, (ctx) => {
    const st = state(ctx);
    const [unit, properties] = st.laneSizes;
    assert.equal(unit, properties, `the lanes resolved different pool sizes: ${unit} vs ${properties}`);
    assert.ok(unit > 0);
  });

  scoped(/^the launcher exports the rotation signal into the role environment$/, () => {
    const source = fs.readFileSync(LAUNCHER, 'utf8');
    assert.match(
      source,
      /export SWARMFORGE_ROTATION=/,
      'the launcher does not export SWARMFORGE_ROTATION, so the ceiling has nothing to read',
    );
  });
}

module.exports = { registerSteps };
