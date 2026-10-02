'use strict';

// BL-1866: step handlers for the stamp-off of hotfix 635570352e (13 step
// handlers sweep their stale fixtures before their own first step, rather
// than at the top level of registerSteps, so building the full step
// registry lists nothing in the temp directory).
//
// Scenario 01 proves the fixed shape directly: it builds the full registry
// in a FRESH child process with fs.readdirSync/rmSync/rmdirSync/opendirSync
// wrapped, so the probe cannot be fooled by whatever this process already
// did. A failed load (defs < 18000) cannot pass vacuously (BL-1445).
//
// Scenario 02 is the pinned census from the hotfix commit message, read
// back from the real files - exactly 13 named handlers, each still calling
// its sweep (via sweepOnFirstStep, BL-1866's wrapper), but none of them at
// the top level of registerSteps any more.
//
// Scenario 03 runs the real bl800 property file three times, alone, with a
// JSON reporter (so the failing line survives if one run goes red under
// load - the 2026-10-01 QA class), and takes the fastest test 1 duration
// (BL-1658 D2 rule).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const STEPS_DIR = __dirname;

// The 13 handlers named in hotfix 635570352e's commit message, pinned here
// rather than re-derived, so a future handler that happens to match the
// same shell census cannot silently join or leave this scenario's set.
const CENSUS_13 = [
  'bl1299ReverseHopMasterResidentSteps.js',
  'bl1306HandoffAuditRerouteSteps.js',
  'bl1320SeatOperatorStepSteps.js',
  'bl1323MainSyncDeadlockOverlapHintsStampSteps.js',
  'bl1327DescentLadderProposalSteps.js',
  'bl1332SharedPathLineLeakSteps.js',
  'bl1335ExhaustionOpensFailoverRecordSteps.js',
  'bl1339LandApprovalSharedRootSteps.js',
  'bl1343ReplayDropsTheTicketsOwnPathSteps.js',
  'bl1352EscalationTransportFaultSteps.js',
  'bl1375ApprovedSiblingsCanLandSteps.js',
  'bl1536BounceIsNeverStampedMergeOnlySteps.js',
  'bl1565CoordinatorNeverReceivesGitHandoffSteps.js',
];

// Same shell census the specifier ran to find the 13 originally: a
// registerSteps body whose first 12 lines call a sweep at two-space
// indent, straight from the top level.
function sweepsFromRegisterStepsTopLevel(source) {
  const lines = source.split('\n');
  let on = false;
  let n = 0;
  for (const line of lines) {
    if (/^function registerSteps\(registry\) \{/.test(line)) {
      on = true;
      n = 0;
      continue;
    }
    if (!on) continue;
    n++;
    if (/^ {2}sweep[A-Za-z]*\(/.test(line)) return true;
    if (n > 12) on = false;
  }
  return false;
}

function state(ctx) {
  if (!ctx.bl1866) ctx.bl1866 = {};
  return ctx.bl1866;
}

function buildRegistryInChildProcess() {
  const probe = `
    const fs = require('node:fs');
    const os = require('node:os');
    const calls = [];
    for (const name of ['readdirSync', 'rmSync', 'rmdirSync', 'opendirSync']) {
      const orig = fs[name];
      if (typeof orig !== 'function') continue;
      fs[name] = function (p, ...rest) {
        calls.push(String(p));
        return orig.call(fs, p, ...rest);
      };
    }
    const { createStepRegistry } = require(${JSON.stringify(path.join(REPO_ROOT, 'specs', 'pipeline', 'stepRegistry'))});
    const { registerSteps } = require(${JSON.stringify(path.join(STEPS_DIR, 'index'))});
    const registry = createStepRegistry();
    registerSteps(registry);
    const defs = registry.listDefinitions().length;
    process.stdout.write('BL1866_PROBE_RESULT:' + JSON.stringify({ calls, defs }) + '\\n');
  `;
  const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(result.status, 0, `building the full registry failed: ${result.stderr}`);
  const line = result.stdout.split('\n').find((l) => l.startsWith('BL1866_PROBE_RESULT:'));
  assert.ok(line, `no probe result line in child output: ${result.stdout.slice(0, 2000)}`);
  return JSON.parse(line.slice('BL1866_PROBE_RESULT:'.length));
}

function runBl800Alone() {
  const result = spawnSync(
    process.execPath,
    [
      path.join(EXT_DIR, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--config',
      'vitest.properties.config.mjs',
      'test/bl800StepRegistryScopingConsistency.property.test.js',
      '--reporter=json',
    ],
    { encoding: 'utf8', cwd: EXT_DIR, maxBuffer: 64 * 1024 * 1024 },
  );
  const jsonLine = result.stdout
    .split('\n')
    .reverse()
    .find((line) => line.trim().startsWith('{'));
  let parsed;
  try {
    parsed = JSON.parse(jsonLine);
  } catch (cause) {
    throw new Error(
      `bl800 alone run did not produce parseable JSON (status ${result.status}): ${result.stdout.slice(0, 4000)}\n${result.stderr.slice(0, 4000)}`,
    );
  }
  assert.equal(parsed.success, true, `bl800 alone run failed: ${JSON.stringify(parsed.testResults).slice(0, 4000)}`);
  const assertionResult = parsed.testResults[0].assertionResults.find((a) =>
    a.title.includes('every BL-623 step resolves to the same handler'),
  );
  assert.ok(assertionResult, 'bl800 test 1 (the full-registry property test) was not found in the JSON report');
  return assertionResult.duration;
}

const FEATURE = 'BL-1866 building the full step registry lists no temp directory';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the full step registry is built in a fresh process that records every directory listing and removal$/, (ctx) => {
    state(ctx).registryProbe = buildRegistryInChildProcess();
  });

  scoped(/^no recorded listing or removal names a path in the temp directory$/, (ctx) => {
    const { calls } = state(ctx).registryProbe;
    const tmpdir = os.tmpdir();
    const offenders = calls.filter((p) => p === tmpdir || p === '/tmp' || p.startsWith(`${tmpdir}${path.sep}`));
    assert.deepEqual(
      offenders,
      [],
      `building the full registry listed/removed a path in the temp directory: ${JSON.stringify(offenders)}`,
    );
  });

  scoped(/^the built registry holds at least 18000 step definitions$/, (ctx) => {
    const { defs } = state(ctx).registryProbe;
    assert.ok(defs >= 18000, `expected at least 18000 step definitions, got ${defs}`);
  });

  scoped(/^the step handler sources are read$/, (ctx) => {
    const files = fs
      .readdirSync(STEPS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => name.endsWith('Steps.js'))
      .sort();
    state(ctx).sources = new Map(files.map((name) => [name, fs.readFileSync(path.join(STEPS_DIR, name), 'utf8')]));
  });

  scoped(
    /^exactly 13 handler files are the ones that swept their stale fixtures from registerSteps on 2026-10-01$/,
    (ctx) => {
      const { sources } = state(ctx);
      const existing = CENSUS_13.filter((name) => sources.has(name));
      assert.deepEqual(
        existing.sort(),
        [...CENSUS_13].sort(),
        'the pinned 13-file census does not match the step handlers on disk',
      );
      assert.equal(existing.length, 13);
    },
  );

  scoped(/^each of them still calls its stale-fixture sweep$/, (ctx) => {
    const { sources } = state(ctx);
    for (const name of CENSUS_13) {
      const source = sources.get(name);
      assert.match(
        source,
        /sweepOnFirstStep\(registry, sweep\w*\)/,
        `${name} no longer calls its stale-fixture sweep via sweepOnFirstStep`,
      );
    }
  });

  scoped(/^none of them calls it from the top level of registerSteps$/, (ctx) => {
    const { sources } = state(ctx);
    const stillTopLevel = CENSUS_13.filter((name) => sweepsFromRegisterStepsTopLevel(sources.get(name)));
    assert.deepEqual(
      stillTopLevel,
      [],
      `these handlers still sweep from the top level of registerSteps: ${JSON.stringify(stillTopLevel)}`,
    );
  });

  scoped(/^the bl800 property file is run alone three times$/, (ctx) => {
    state(ctx).bl800Durations = [runBl800Alone(), runBl800Alone(), runBl800Alone()];
  });

  scoped(/^its full-registry test finishes in under 3000 ms in its fastest run$/, (ctx) => {
    const durations = state(ctx).bl800Durations;
    const fastest = Math.min(...durations);
    assert.ok(fastest < 3000, `fastest of 3 alone runs was ${fastest} ms, durations: ${JSON.stringify(durations)}`);
  });
}

module.exports = { registerSteps };
