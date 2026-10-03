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
const {
  resolveWorkerPoolSize,
  resolveVitestWorkerPool,
  PER_WORKER_HEAP_MB,
  SAFE_HOST_RAM_FRACTION,
} = require('../../../extension/out/tools/vitest-worker-memory-budget');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
// Derived, never a literal: BL-1651 (2026-09-19) halved PER_WORKER_HEAP_MB
// from 1280 to 640, so the old literal 8192 resolved to 6 forks and every
// scenario here was red until 2026-10-03. Whatever the per-worker heap and
// safe fraction are, this RAM resolves to exactly 3 forks.
const HOST_RAM_MB_FOR_3_FORKS = Math.ceil((3 * PER_WORKER_HEAP_MB) / SAFE_HOST_RAM_FRACTION);

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

// The spawned script reports the platform the scenario names, not the host's
// own: it patches os.platform and syncs the builtin's ESM exports before
// importing the config, so the configs' own os.platform() reads it. The swarm
// host moved from macOS to Linux, and this scenario was red on Linux until
// 2026-10-03. The number is the LAST output line: the property config now
// logs a [property-lane-budget] line first, which made the old
// Number(out) read NaN.
function resolveConfigMaxForks(configFile, env, platform) {
  const script = [
    "const os = require('node:os');",
    `os.platform = () => ${JSON.stringify(platform)};`,
    "require('node:module').syncBuiltinESMExports();",
    `import(${JSON.stringify(configFile)}).then((m) => console.log(m.default.test.poolOptions.forks.maxForks));`,
  ].join('\n');
  const out = execFileSync('node', ['-e', script], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    env,
  });
  const lines = out.trim().split('\n');
  return Number(lines[lines.length - 1].trim());
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
      // The spawned config process reads the platform this scenario names
      // (resolveConfigMaxForks patches os.platform inside it), so the macOS
      // pack rule is exercised on any host. The Given only ever sets macOS
      // (the ticket's own platform gate); require it.
      assert.equal(ctx.platform, 'darwin', 'scenario 02 exercises the real config files and only makes sense on macOS');
      const env = { ...process.env, SWARMFORGE_PACK: ctx.pack };
      delete env.SWARMFORGE_VITEST_MAX_FORKS;
      ctx.unitForks = resolveConfigMaxForks(path.join(EXTENSION_DIR, 'vitest.config.mjs'), env, ctx.platform);
      ctx.propertyForks = resolveConfigMaxForks(path.join(EXTENSION_DIR, 'vitest.properties.config.mjs'), env, ctx.platform);
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
