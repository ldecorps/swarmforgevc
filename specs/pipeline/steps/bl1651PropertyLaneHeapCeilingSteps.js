'use strict';

// BL-1651: step handlers for "The property lane names the file that
// exceeds its heap ceiling instead of dying"
// (specs/features/BL-1651-the-property-lane-crashes-on-the-per-worker-heap-cap-mid-file.feature).
//
// Scenarios 01/02 drive the REAL vitest.properties.config.mjs against a
// real fixture file via propertyLaneFixtureRunner.js's own
// runAsPropertyLaneFixture (BL-868's "temporarily add a property test...
// remove it afterwards" convention, reused rather than re-implemented),
// with SWARMFORGE_PROPERTY_LANE_FILE_HEAP_CEILING_MB forced via env so
// the scenario is deterministic regardless of the real host's own free
// memory. Scenario 03 drives the real pure derivation functions directly
// for the numeric half, and the same fixture runner (a trivial one-line
// fixture) for the "printed once" half. Scenario 04 reads the real
// committed census file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runAsPropertyLaneFixture } = require('../../../extension/test/helpers/propertyLaneFixtureRunner');

const FEATURE = "BL-1651 The property lane names the file that exceeds its heap ceiling instead of dying";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const BUDGET_MODULE = path.join(EXTENSION_DIR, 'out', 'tools', 'vitest-worker-memory-budget.js');
const CENSUS_PATH = path.join(EXTENSION_DIR, 'test', 'property-lane-heap-census.txt');

function loadBudgetModule() {
  delete require.cache[require.resolve(BUDGET_MODULE)];
  return require(BUDGET_MODULE);
}

// A fixture that allocates and RETAINS memory across its generated cases
// (a module-level array nothing ever clears, mirroring the ticket's own
// diagnosis of the real offenders) - large enough that a handful of cases
// cross a deliberately tiny test ceiling within a couple hundred
// milliseconds, small enough to stay far below any real worker's own V8
// cap so the fixture itself never risks a genuine crash regardless of the
// ceiling under test.
function fixtureSource() {
  return [
    "'use strict';",
    'const retained = [];',
    'for (let i = 0; i < 30; i += 1) {',
    "  test(`allocates-${i}`, () => {",
    '    retained.push(new Array(2_000_000).fill(i));',
    '  });',
    '}',
  ].join('\n');
}

function runFixture(ctx, ceilingMB) {
  const env = { ...process.env, SWARMFORGE_PROPERTY_LANE_FILE_HEAP_CEILING_MB: String(ceilingMB) };
  ctx.bl1651 = ctx.bl1651 || {};
  ctx.bl1651.result = runAsPropertyLaneFixture(fixtureSource(), { basenamePrefix: 'bl1651-fixture-', timeout: 30000, env });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture property test file that allocates and retains memory across its generated cases$/, (ctx) => {
    ctx.bl1651 = {};
  });

  scoped(/^the per-file heap ceiling is set to a value the fixture file will exceed$/, (ctx) => {
    ctx.bl1651.forcedCeilingMB = 20;
  });

  scoped(/^the per-file heap ceiling is set to a value the fixture file will not reach$/, (ctx) => {
    ctx.bl1651.forcedCeilingMB = 999999;
  });

  scoped(/^the property lane runs on the fixture file alone$/, (ctx) => {
    runFixture(ctx, ctx.bl1651.forcedCeilingMB);
  });

  scoped(/^the run reports the fixture file as failed$/, (ctx) => {
    assert.notEqual(ctx.bl1651.result.status, 0, `expected the run to fail:\n${ctx.bl1651.result.output}`);
  });

  scoped(/^the run reports the fixture file as passed$/, (ctx) => {
    assert.equal(ctx.bl1651.result.status, 0, `expected the run to pass:\n${ctx.bl1651.result.output}`);
  });

  scoped(/^the failure message names the file and its peak heap in megabytes$/, (ctx) => {
    const { output } = ctx.bl1651.result;
    assert.match(output, /PROPERTY_LANE_HEAP_CEILING_EXCEEDED/, `expected the gate's own message:\n${output}`);
    assert.match(output, /heapUsed \d+(\.\d+)?MB exceeds the per-file ceiling \d+MB/, `expected named MB numbers:\n${output}`);
    assert.match(output, /bl1651-fixture-/, `expected the fixture's own filename in the report:\n${output}`);
  });

  scoped(/^the worker that ran it is still alive at the end of the run$/, (ctx) => {
    const { output } = ctx.bl1651.result;
    assert.doesNotMatch(output, /FATAL ERROR/, `a real V8 abort must never occur:\n${output}`);
    assert.doesNotMatch(output, /heap out of memory/i, `a real V8 abort must never occur:\n${output}`);
    assert.match(output, /Test Files\s+\d+ failed/, `expected a normal, complete run summary (proof the process exited gracefully):\n${output}`);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────
  scoped(/^the property lane's budget is resolved for a host with 20 cores and 19 gigabytes of memory$/, (ctx) => {
    const { resolveVitestWorkerPool, resolveFreeCoresCeiling, resolvePropertyLaneHeapMB, computeWorkerMemoryBudget, PER_WORKER_HEAP_MB } =
      loadBudgetModule();
    const cores = 20;
    const freeRamMB = 19 * 1024;
    const forks = resolveVitestWorkerPool({
      pack: undefined,
      platform: 'linux',
      hostRamMB: freeRamMB,
      defaultCeiling: resolveFreeCoresCeiling(cores, 0),
    });
    const workerHeapMB = resolvePropertyLaneHeapMB(freeRamMB, forks);
    ctx.bl1651Budget = { forks, workerHeapMB, freeRamMB, PER_WORKER_HEAP_MB, computeWorkerMemoryBudget };
  });

  scoped(
    /^the resolved fork count times the per-worker cap does not exceed the memory available at spawn less the configured headroom$/,
    (ctx) => {
      const { forks, workerHeapMB, freeRamMB, PER_WORKER_HEAP_MB, computeWorkerMemoryBudget } = ctx.bl1651Budget;
      const budget = computeWorkerMemoryBudget({ maxWorkers: forks, perWorkerHeapMB: workerHeapMB, hostRamMB: freeRamMB });
      assert.ok(
        budget.withinBudget || workerHeapMB === PER_WORKER_HEAP_MB,
        `expected forks(${forks}) * cap(${workerHeapMB}) to stay within the safe fraction of ${freeRamMB}MB, or the proven-safe floor to bind`
      );
    }
  );

  scoped(/^the derivation is printed exactly once at the start of a run$/, (ctx) => {
    const result = runAsPropertyLaneFixture("'use strict';\ntest('trivial', () => {});\n", {
      basenamePrefix: 'bl1651-print-once-',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `expected the trivial fixture to pass:\n${result.output}`);
    const matches = result.output.match(/\[property-lane-budget\]/g) || [];
    assert.equal(matches.length, 1, `expected exactly one budget line, got ${matches.length}:\n${result.output}`);
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────
  scoped(/^extension\/test\/property-lane-heap-census\.txt is read on the parcel commit$/, (ctx) => {
    ctx.bl1651Census = fs.readFileSync(CENSUS_PATH, 'utf8');
  });

  scoped(/^it lists one row per property test file with its peak heap in megabytes and its case count$/, (ctx) => {
    const dataLines = ctx.bl1651Census.split('\n').filter((line) => line && !line.startsWith('#'));
    assert.ok(dataLines.length > 0, 'expected at least one data row in the census');
    for (const line of dataLines) {
      const cols = line.split('\t');
      assert.equal(cols.length, 3, `expected <file>\\t<peakHeapMB>\\t<caseCount>, got: ${JSON.stringify(line)}`);
      assert.match(cols[0], /\.property\.test\.js$/, `expected a property test file path: ${JSON.stringify(line)}`);
      assert.ok(Number.isFinite(Number(cols[1])), `expected a numeric peak heap MB: ${JSON.stringify(line)}`);
      assert.ok(Number.isInteger(Number(cols[2])), `expected an integer case count: ${JSON.stringify(line)}`);
    }
  });

  scoped(/^its header states the cap, the fork count and the host load of the run that produced it$/, (ctx) => {
    const headerLines = ctx.bl1651Census.split('\n').filter((line) => line.startsWith('#'));
    const header = headerLines.join('\n');
    assert.match(header, /cap=\d+MB/, `expected the header to state the cap:\n${header}`);
    assert.match(header, /forks=\d+/, `expected the header to state the fork count:\n${header}`);
    assert.match(header, /load=[\d.]+/, `expected the header to state the host load:\n${header}`);
  });

  // ── Scenario 05 ───────────────────────────────────────────────────────
  // BL-871's own feature had two stale expectations (scenario 02's forks
  // formula predated BL-1348/BL-1336's resolveFreeCoresCeiling ceiling,
  // scenario 03's 8192MB row predated BL-1348's 640MB heap drop) and a
  // scenario 04 that crashed this very acceptance harness nesting the
  // whole property lane inside it via spawnSync (BL-1651's own standing-
  // red evidence) - fixed/retired as this ticket's own registered debt
  // (backlog/standing-reds.tsv). Drives the REAL run_acceptance.sh on
  // BL-871's own (now-fixed) feature file, never a re-implementation of
  // the runner.
  const BL871_FEATURE = path.join(REPO_ROOT, 'specs', 'features', 'BL-871-property-lane-worker-pool-cap.feature');
  const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');

  scoped(/^specs\/features\/BL-871-property-lane-worker-pool-cap\.feature runs once through the acceptance runner$/, (ctx) => {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('bash', [RUN_ACCEPTANCE, BL871_FEATURE], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 });
    ctx.bl871Run = { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
  });

  scoped(/^every scenario it still carries passes$/, (ctx) => {
    assert.equal(ctx.bl871Run.status, 0, `expected BL-871's feature to pass, got exit ${ctx.bl871Run.status}:\n${ctx.bl871Run.output}`);
    assert.doesNotMatch(ctx.bl871Run.output, /^not ok/m, `expected no failing subtest:\n${ctx.bl871Run.output}`);
  });

  scoped(/^it carries no scenario that runs the whole property lane$/, () => {
    const featureText = fs.readFileSync(BL871_FEATURE, 'utf8');
    assert.doesNotMatch(featureText, /whole property (suite|lane)/i, `expected no full-lane scenario left in the feature:\n${featureText}`);
    const handlerText = fs.readFileSync(
      path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'bl871PropertyLaneWorkerPoolCapSteps.js'),
      'utf8'
    );
    assert.doesNotMatch(handlerText, /test:properties/, 'expected no handler still spawning the full property lane');
  });
}

module.exports = { registerSteps };
