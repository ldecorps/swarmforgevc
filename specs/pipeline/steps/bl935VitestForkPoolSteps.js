'use strict';

// BL-935: step handlers for "a vitest run under a live full-forge pack on
// macOS takes one fork, not the whole memory budget". Drives the real
// extension/out/tools/vitest-worker-memory-budget.js resolvers in-process
// (pure, no fixture directory needed), and scenario 02 additionally spawns
// the two REAL config files with stubbed env so a resolver that's exported
// and unit-tested but never actually read by a config (the BL-419 shape
// required_wiring exists to catch) would fail here, not just look tested.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveWorkerPoolSize, resolveVitestWorkerPool } = require('../../../extension/out/tools/vitest-worker-memory-budget');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const HOST_RAM_MB_FOR_3_FORKS = 8192; // floor(8192 * 0.5 / 1280) = 3, matching the real swarm host

const FEATURE = 'a vitest run under a live full-forge pack on macOS takes one fork, not the whole memory budget';

const PACK_VALUES = { 'full-forge': 'full-forge', 'mono-router': 'mono-router', unset: undefined };
const PLATFORM_VALUES = { macOS: 'darwin', Linux: 'linux' };
// BL-935 hardening: '0' and '-1' cover the ZERO and NEGATIVE halves of the
// ticket's own precedence rule 1 ("a non-positive or non-numeric value is
// IGNORED, not floored"). The table previously pinned only the non-numeric
// half, so a mutant widening the override guard to `n >= 0` passed all nine
// scenarios. They are tabled under an UNSET pack deliberately: under
// full-forge/macOS the pack rule's own 1 coincides with the pool floor's 1,
// so that combination cannot tell an ignored override from an accepted zero.
const OVERRIDE_VALUES = { unset: undefined, '2': '2', '9': '9', '0': '0', '-1': '-1', 'not-a-number': 'not-a-number' };

function knownValue(map, token, label) {
  if (!Object.prototype.hasOwnProperty.call(map, token)) {
    throw new Error(`unknown <${label}> token: ${token}`);
  }
  return map[token];
}

function resolveConfigMaxForks(configFile, env) {
  const out = execFileSync('node', ['-e', `import('${configFile.replace(/\\/g, '\\\\')}').then(m => console.log(m.default.test.poolOptions.forks.maxForks))`], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    env,
  });
  return Number(out.trim());
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a host whose memory-derived worker budget is 3 forks$/,
    (ctx) => {
      ctx.hostRamMB = HOST_RAM_MB_FOR_3_FORKS;
      assert.equal(resolveWorkerPoolSize(ctx.hostRamMB), 3, 'fixture host RAM must itself resolve to 3 forks with no ceiling override');
    },
    FEATURE
  );

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^the pack is (\S+)$/,
    (ctx, pack) => {
      ctx.pack = knownValue(PACK_VALUES, pack, 'pack');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the platform is (\S+)$/,
    (ctx, platform) => {
      ctx.platform = knownValue(PLATFORM_VALUES, platform, 'platform');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the explicit fork override is (\S+)$/,
    (ctx, override) => {
      ctx.override = knownValue(OVERRIDE_VALUES, override, 'override');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the worker pool size is resolved$/,
    (ctx) => {
      // BL-935 hardening: drives resolveVitestWorkerPool - the ONE route both
      // vitest.config.mjs and vitest.properties.config.mjs actually call -
      // rather than re-composing resolveVitestForkCeiling with
      // resolveWorkerPoolSize here. A hand-composed pair inside the step is a
      // second implementation of the decision, so a miswire INSIDE the real
      // route (swapped arguments, a dropped ceiling) left all eight Examples
      // rows green; the architect closed this same gap on the property side
      // and it stayed open on the acceptance side.
      ctx.forks = resolveVitestWorkerPool({
        pack: ctx.pack,
        platform: ctx.platform,
        override: ctx.override,
        hostRamMB: ctx.hostRamMB,
      });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the run is given (\d+) forks$/,
    (ctx, forks) => {
      assert.equal(ctx.forks, Number(forks));
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the unit config and the property config each resolve their worker pool$/,
    (ctx) => {
      // os.platform() inside the spawned config process reads the REAL host
      // OS - can't be stubbed across a subprocess boundary. This scenario's
      // own Given only ever sets macOS (the ticket's own platform gate), so
      // require it rather than silently no-op on a host this feature was
      // never meant to run against.
      assert.equal(ctx.platform, 'darwin', 'scenario 02 exercises the real config files and only makes sense on macOS');
      const env = { ...process.env, SWARMFORGE_PACK: ctx.pack };
      delete env.SWARMFORGE_VITEST_MAX_FORKS;
      ctx.unitForks = resolveConfigMaxForks(path.join(EXTENSION_DIR, 'vitest.config.mjs'), env);
      ctx.propertyForks = resolveConfigMaxForks(path.join(EXTENSION_DIR, 'vitest.properties.config.mjs'), env);
    },
    FEATURE
  );

  registry.defineScoped(
    /^both report exactly (\d+) fork$/,
    (ctx, forks) => {
      // BL-935 hardening (architect's pass-3 observation): asserting only that
      // the two lanes AGREE lost its bite once the cleaner collapsed them onto
      // one shared composition - agreement became structural, so both lanes
      // silently dropping the ceiling and reporting the memory-derived 3 still
      // passed. Pin the expected VALUE as well, so this scenario fails when the
      // ceiling stops being applied in the real configs even though the lanes
      // still agree with each other. Equality is asserted first, so a genuine
      // lane DIVERGENCE is still reported as a divergence rather than as a
      // wrong number.
      const expected = Number(forks);
      assert.equal(
        ctx.unitForks,
        ctx.propertyForks,
        `unit lane resolved ${ctx.unitForks} forks but the property lane resolved ${ctx.propertyForks}`
      );
      assert.equal(
        ctx.unitForks,
        expected,
        `both lanes agreed on ${ctx.unitForks} forks, but a full-forge pack on macOS must resolve to ${expected}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
