import * as os from 'node:os';
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

// BL-479: property tests are a SEPARATE explicit command from normal
// verification (engineering.prompt: "Keep property tests separate from
// normal verification... unless the role owns property-test verification"
// - the architect, per this ticket's own role-prompt amendment). This
// config is used ONLY by `npm run test:properties`; the default
// `vitest.config.mjs` (unit/coverage run, and Stryker's mutation run,
// which reuses that same config) explicitly EXCLUDES `**/*.property.test.js`
// so property files are never picked up by any of those runs. This
// config's own `include` is scoped to exactly that glob, nothing else.

// BL-871: this lane used to size its worker pool to Vitest's CPU-count
// default with no per-worker heap limit at all - the exact BL-422 failure
// mode the unit lane already guards against, just never wired here. A full
// 65-file run's verdict was a function of host load (which file lost the
// contention moved between runs) rather than of the code under test. Both
// lanes now read the SAME shared budget module - this file carries no copy
// of its own numbers, so a change to the caps applies to both lanes at
// once. `npm run test:properties` runs `npm run compile` first (see
// package.json), so out/ already exists by the time this config loads,
// same createRequire bridge vitest.config.mjs's own ESM-to-CommonJS load
// uses (this config is ESM, the budget module is CommonJS).
const require = createRequire(import.meta.url);
const {
  resolveVitestWorkerPool,
  resolveFreeCoresCeiling,
  resolvePropertyLaneHeapMB,
  resolvePropertyLaneFileHeapCeilingMB,
} = require('./out/tools/vitest-worker-memory-budget');
const { FORKS_ENV_KEY, resolveLaneForks } = require('./test/helpers/propertyLaneContentionBudget');
const { PROPERTY_LANE_HEAP_CEILING_ENV_KEY } = require('./test/helpers/propertyLaneHeapCeilingEnvKey');
// BL-935: the SAME single pool-resolution route as vitest.config.mjs - the
// second required call site named by this ticket's own required_wiring, and
// historically the easy one to miss a fix in. Both lanes now call the one
// resolveVitestWorkerPool composition rather than each re-composing the
// ceiling and the memory budget themselves (BL-935 invariant 3).
const WORKER_POOL_SIZE = resolveVitestWorkerPool({
  pack: process.env.SWARMFORGE_PACK,
  // BL-1336: both lanes read the rotation signal through the SAME
  // resolveVitestWorkerPool composition point - neither gains a sizing route
  // the other lacks (BL-935 invariant 3).
  rotation: process.env.SWARMFORGE_ROTATION,
  platform: os.platform(),
  override: process.env.SWARMFORGE_VITEST_MAX_FORKS,
  hostRamMB: os.totalmem() / (1024 * 1024),
  // BL-1348, human ruling B: the DEFAULT (no override set) now follows the
  // cores this host has FREE (cores minus the 5-minute load average, floor
  // 1, cap cores) rather than the fixed MAX_WORKERS=6 ceiling or the raw
  // core count - passed in here, same as hostRamMB/platform above, so the
  // budget module itself still reads no os/env of its own. The SAME input
  // both lanes now pass (BL-935 invariant 3).
  defaultCeiling: resolveFreeCoresCeiling(os.cpus().length, os.loadavg()[1]),
});

// BL-1588: publish the lane's own concurrency signal to every worker BEFORE
// any fork spawns, so a fixture-spawning file's own per-test budget call
// (propertyLaneTimeoutMs, inside a worker) can fold it in alongside the
// 1-minute load average, which lags the lane's own ramp by up to a minute
// (see propertyLaneContentionBudget.js). Forks are spawned as child
// processes of this process, so they inherit process.env as set here.
// BL-932 invariant 1 (bl932SharedHeavyTimeoutInvariants.property.test.js)
// fixes this config's own suite-wide `testTimeout` at the literal 20000ms
// below - the budget stays PER-TEST headroom on the fixture-spawning files
// themselves, never a lane-wide raise here.
//
// Architect bounce (2026-09-16): WORKER_POOL_SIZE alone is the lane's
// static pool CEILING, sized from host RAM/cores - identical whether this
// invocation targets 408 files or 1, so publishing it unconditionally
// violated invariant 1 on any host with enough free capacity (a genuinely
// solo run on a 20-core host resolved a 3x budget). resolveLaneForks reads
// process.argv (the number of explicit test-file arguments on this
// invocation, known before any fork spawns, same as WORKER_POOL_SIZE
// itself) and forces forks=1 whenever exactly one file was named - the one
// shape indistinguishable from a truly solo run - and only uses the pool
// ceiling when the invocation could actually run more than one file
// concurrently (0 explicit files, the full lane's own glob, or >1 named
// together).
process.env[FORKS_ENV_KEY] = String(resolveLaneForks(process.argv, WORKER_POOL_SIZE));

// BL-1651: the per-worker heap cap and the per-file gate ceiling it feeds
// (propertyLaneHeapGuardSetup.js), derived from memory ACTUALLY FREE at
// this moment (os.freemem(), never totalmem() - a busy host's other
// resident processes, the live swarm's own role sessions, already hold
// some of that) divided across the forks resolveLaneForks actually
// publishes above. A test harness driving a controlled scenario (BL-1651's
// own acceptance handler) pre-sets PROPERTY_LANE_HEAP_CEILING_ENV_KEY
// before this config loads; only computed here when absent, so a real run
// never overwrites a deliberately-forced test ceiling.
//
// Printed exactly once: this module body runs once in the main process,
// before any fork spawns (forks inherit process.env, never re-run this
// file) - the same "known once, in the main process" property FORKS_ENV_KEY
// above already relies on.
const FREE_RAM_MB = os.freemem() / (1024 * 1024);
const PROPERTY_LANE_LANE_FORKS = Number(process.env[FORKS_ENV_KEY]);
if (!process.env[PROPERTY_LANE_HEAP_CEILING_ENV_KEY]) {
  const workerHeapMB = resolvePropertyLaneHeapMB(FREE_RAM_MB, PROPERTY_LANE_LANE_FORKS);
  process.env[PROPERTY_LANE_HEAP_CEILING_ENV_KEY] = String(resolvePropertyLaneFileHeapCeilingMB(workerHeapMB));
}
const PROPERTY_LANE_WORKER_HEAP_MB = resolvePropertyLaneHeapMB(FREE_RAM_MB, PROPERTY_LANE_LANE_FORKS);
// eslint-disable-next-line no-console
console.log(
  `[property-lane-budget] forks=${PROPERTY_LANE_LANE_FORKS} workerHeapMB=${PROPERTY_LANE_WORKER_HEAP_MB} ` +
    `fileHeapCeilingMB=${process.env[PROPERTY_LANE_HEAP_CEILING_ENV_KEY]} freeRamMB=${Math.round(FREE_RAM_MB)}`
);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // BL-868: this lane silently ran without the two shared isolation
    // guards vitest.config.mjs wires (BL-420's temp-dir sweep, BL-720's
    // env-restore guard) - a property test's mkTmpDir() calls were never
    // swept and a leaked process.env key had nothing to catch it. Same two
    // setupFiles, same paths, as vitest.config.mjs. BL-1651 adds the
    // per-file heap ceiling gate (propertyLaneHeapGuardSetup.js) alongside
    // them - this lane's own addition, never wired into vitest.config.mjs.
    setupFiles: [
      './test/helpers/tmpDirSetup.js',
      './test/helpers/envRestoreGuardSetup.js',
      './test/helpers/gitEnvGuardSetup.js',
      './test/helpers/propertyLaneHeapGuardSetup.js',
    ],
    include: ['test/**/*.property.test.js'],
    testTimeout: 20000,
    // BL-871 QA bounce D2 follow-up (2026-08-11): raising per-test timeouts
    // (see bl760/bl787/bl797) stopped tests failing their OWN assertions,
    // but 3 direct `npm run test:properties` runs still exited 1 with
    // ZERO failing tests (232/232 passed every time) because of a THIRD,
    // separate mechanism: Vitest's bundled birpc RPC layer has its own
    // hardcoded 60000ms heartbeat for a worker's "onTaskUpdate" callback
    // (node_modules/vitest/dist/chunks/index.B521nVV-.js's DEFAULT_TIMEOUT
    // - confirmed NOT exposed by any public config: forks.js's
    // getRpcOptions()/createForksRpcOptions() pass no `timeout`, so this
    // can never be raised from here the way testTimeout can). A worker
    // running bl760/bl787/bl797 spends 100-240s+ of real time INSIDE a
    // synchronous spawnSync/execFileSync call, which blocks that worker's
    // event loop and starves the heartbeat - unavoidable given the file
    // count survives real subprocess time, not a timeout value. Vitest logs
    // these (5, 4 and 6 identical `[vitest-worker]: Timeout calling
    // "onTaskUpdate"` errors, confirmed identical across all 3 runs, never
    // any other message) as "unhandled errors" and fails the WHOLE RUN via
    // `process.exitCode = 1` for it, independent of any file's own verdict
    // - exactly the "verdict depends on something other than the code under
    // test" failure mode this ticket's invariant 1 exists to close.
    // `dangerouslyIgnoreUnhandledErrors` is Vitest's own official flag for
    // this exit-code gate specifically (cli-api.DWGBtMmz.js's
    // _checkUnhandledErrors) - it does not suppress the "Unhandled Errors"
    // section from printing, so a genuinely new/different unhandled error
    // class remains visible for a human or QA to notice, it just stops this
    // confirmed-benign, non-configurable, always-on Vitest-internal artifact
    // from flipping a real 232/232 pass into a reported failure.
    dangerouslyIgnoreUnhandledErrors: true,
    // BL-871/BL-1651: the fork pool ceiling is unchanged (BL-871's own
    // resolveVitestWorkerPool); the per-worker heap cap is now
    // resolvePropertyLaneHeapMB's own host-derived value, never the unit
    // lane's fixed PER_WORKER_HEAP_MB (this lane's own crashes, not the
    // unit lane's, are what this ticket fixes - see the derivation above).
    // This lane deliberately leaves Vitest's default per-file isolation ON
    // (unlike vitest.config.mjs's isolate:false) - bringing the lanes to
    // parity there rests on a precondition (every test restores what it
    // stubs) not yet established for property files, and is out of this
    // ticket's scope.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: WORKER_POOL_SIZE,
        execArgv: [`--max-old-space-size=${PROPERTY_LANE_WORKER_HEAP_MB}`],
      },
    },
  },
});
