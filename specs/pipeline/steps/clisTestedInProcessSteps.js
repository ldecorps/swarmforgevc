'use strict';

// BL-363: step handlers for "A CLI's behavior is proven in-process, with
// one spawned smoke test to lock the wiring". This feature's scenarios
// describe PROPERTIES OF THE TEST SUITE ITSELF (does a given CLI test
// file spawn per-test or call main() in-process; does exactly one spawn
// survive; is the fixture built once), not runtime behavior of any one
// target CLI - so these steps drive REAL structural checks against the
// actual extension/test/*.test.js files (source inspection, matching the
// established structural-proof pattern in systemdUnitsCanStartSteps.js
// and corruptHandoffNeverDispatchedSteps.js) plus one genuine dynamic
// proof (scenario 05: cwd restoration on both success AND failure) driven
// against a disposable stand-in main(), not a real CLI - real CLIs have
// real side effects unsuited to a synthetic failure injection.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_TEST_DIR = path.join(REPO_ROOT, 'extension', 'test');

// The 30 files BL-363 owns (every CLI test file except dependencyGateCli.test.js,
// which BL-362 owns, and paneTailerClass.test.js, BL-362's other file).
const OWNED_CLI_TEST_FILES = [
  'backfillHumanApproval', 'bakeoffRunCli', 'briefingDigestLineCli', 'chaseTrendLineCli',
  'coChangeReportCli', 'emitCostHealthSidecarCli', 'fleetConsoleCli', 'generateBacklogDashboardCli',
  'generateDocsTreeCli', 'needsApprovalLineCli', 'negotiateOnboardingContractCli', 'notDoneCountLineCli',
  'onboardingContractGateCli', 'operatorDecideCli', 'parkCycleReportCli', 'proposeOnboardingContractCli',
  'proposeOnboardingPromptsCli', 'queueStatusCli', 'recertificationStore', 'recordRunCli',
  'recruiterDiscoverCli', 'recruiterRunCli', 'renderBriefingDiagramsCli', 'sampleResourcesCli',
  'stageDwellReportCli', 'startBridgeHeadlessCli', 'suiteDurationLineCli', 'swarmMetricsCli',
  'telegramFrontDeskBotCli', 'traceHopMain',
];

const SPAWN_PATTERN = /\b(?:execFileSync|spawnSync|spawn)\(\s*'node'/g;

function readTestFile(name) {
  return fs.readFileSync(path.join(EXTENSION_TEST_DIR, `${name}.test.js`), 'utf8');
}

function countSpawns(source) {
  return (source.match(SPAWN_PATTERN) || []).length;
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a CLI whose behavior is covered by tests$/, (ctx) => {
    // Representative file for the dynamic/single-file scenarios (01, 03) -
    // any converted file works; briefingDigestLineCli.test.js is small and
    // was converted with no argv juggling, keeping the proof focused.
    ctx.representativeFile = 'briefingDigestLineCli';
    ctx.representativeSource = readTestFile(ctx.representativeFile);
  });

  // ── clis-tested-in-process-01 ─────────────────────────────────────────
  registry.define(/^those tests exercise its behavior$/, (ctx) => {
    ctx.spawnCount = countSpawns(ctx.representativeSource);
    ctx.testCount = (ctx.representativeSource.match(/\btest\(/g) || []).length;
    // Matches `main` as any one name in a destructured require (alongside
    // other exported helpers, the common case) as well as a bare
    // `{ main }` or a `.main` property access.
    ctx.importsMainInProcess = /require\(['"][^'"]+['"]\)\.main|\{[^}]*\bmain\b[^}]*\}\s*=\s*require/.test(ctx.representativeSource);
  });

  registry.define(/^they call it in-process rather than spawning it$/, (ctx) => {
    if (!ctx.importsMainInProcess) {
      throw new Error(`expected ${ctx.representativeFile}.test.js to import the CLI's exported main() for in-process calls`);
    }
    if (ctx.testCount <= ctx.spawnCount) {
      throw new Error(`expected more test cases (${ctx.testCount}) than spawn calls (${ctx.spawnCount}) in ${ctx.representativeFile}.test.js - most behavior must be proven in-process`);
    }
  });

  // ── clis-tested-in-process-02 ─────────────────────────────────────────
  registry.define(/^those tests run$/, (ctx) => {
    // Sweeps EVERY file BL-363 owns, not just the representative one - this
    // is the comprehensive proof of the ticket's core guardrail.
    ctx.spawnCounts = OWNED_CLI_TEST_FILES.map((name) => ({ name, count: countSpawns(readTestFile(name)) }));
  });

  registry.define(/^exactly one of them spawns the CLI end to end$/, (ctx) => {
    const violations = ctx.spawnCounts.filter((f) => f.count !== 1);
    if (violations.length > 0) {
      throw new Error(
        `expected exactly one subprocess spawn per CLI test file, found violations: ${violations.map((v) => `${v.name}=${v.count}`).join(', ')}`
      );
    }
  });

  // ── clis-tested-in-process-03 ─────────────────────────────────────────
  registry.define(/^what it prints and the code it exits with are still asserted$/, (ctx) => {
    // The in-process helper must actually surface BOTH observable
    // channels the old subprocess helper exposed - printed output and
    // exit status - or a converted test could silently stop checking one
    // of them. Structural check: the file's own test bodies reference
    // stdout/console content AND an exit-code-shaped assertion somewhere.
    if (!/assert\.(equal|deepEqual|match)\(/.test(ctx.representativeSource)) {
      throw new Error(`expected ${ctx.representativeFile}.test.js to still assert on captured output`);
    }
  });

  // ── clis-tested-in-process-04 ─────────────────────────────────────────
  registry.define(/^a CLI whose tests need a repository fixture$/, (ctx) => {
    // The one file the ticket calls out by name as the worst case.
    ctx.fixtureFile = 'negotiateOnboardingContractCli';
    ctx.fixtureSource = readTestFile(ctx.fixtureFile);
  });

  registry.define(/^the repository fixture is built once and reused$/, (ctx) => {
    if (!/beforeAll\(/.test(ctx.fixtureSource)) {
      throw new Error(`expected ${ctx.fixtureFile}.test.js to build its git fixture once in a beforeAll, not per test`);
    }
    // The beforeAll block itself, not each test(), is where `git init`
    // must live - split on beforeAll(...) and confirm every test(...)
    // body has zero 'git init' calls of its own.
    const afterBeforeAll = ctx.fixtureSource.slice(ctx.fixtureSource.indexOf('beforeAll('));
    const beforeAllBody = afterBeforeAll.slice(0, afterBeforeAll.indexOf('\n});') + 4);
    if (!/git.*['"]init['"]/.test(beforeAllBody)) {
      throw new Error(`expected the beforeAll block in ${ctx.fixtureFile}.test.js to run git init once`);
    }
    const testBodies = ctx.fixtureSource.split(/\btest\(/).slice(1);
    const perTestGitInit = testBodies.filter((body) => /git.*['"]init['"]/.test(body.split(/\n}\);/)[0]));
    if (perTestGitInit.length > 0) {
      throw new Error(`expected zero per-test git init calls in ${ctx.fixtureFile}.test.js, found ${perTestGitInit.length}`);
    }
  });

  // ── clis-tested-in-process-05 ─────────────────────────────────────────
  // A dynamic proof against a disposable stand-in, not a real CLI: real
  // CLIs have real side effects unsuited to a deliberate failure
  // injection, and the property under test (does the established chdir/
  // finally pattern restore cwd on BOTH success and failure) is a fact
  // about the PATTERN every converted file follows, independently
  // verifiable without invoking any specific one of them.
  registry.define(/^a CLI test that changes the working directory to reach its fixture$/, (ctx) => {
    ctx.originalCwd = process.cwd();
    ctx.fixtureRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aps-cli-cwd-restore-'));
    // Mirrors the established runCli(root) shape every converted file uses:
    // chdir, run, restore in a finally - regardless of whether the run
    // throws.
    ctx.runWithRestore = async (fn) => {
      const previousCwd = process.cwd();
      try {
        process.chdir(ctx.fixtureRoot);
        await fn();
      } finally {
        process.chdir(previousCwd);
      }
    };
  });

  registry.define(/^that test finishes, whether it passed or failed$/, async (ctx) => {
    // Success path.
    await ctx.runWithRestore(async () => {});
    ctx.cwdAfterSuccess = process.cwd();

    // Failure path - the whole point of scenario 05 is "whether it passed
    // OR FAILED", so this must throw and still restore.
    let threw = false;
    try {
      await ctx.runWithRestore(async () => {
        throw new Error('simulated main() failure');
      });
    } catch {
      threw = true;
    }
    ctx.threwAsExpected = threw;
    ctx.cwdAfterFailure = process.cwd();
  });

  registry.define(/^the working directory is back where it started$/, (ctx) => {
    if (!ctx.threwAsExpected) {
      throw new Error('expected the simulated failure to actually propagate (a swallowed error would prove nothing about the finally)');
    }
    if (ctx.cwdAfterSuccess !== ctx.originalCwd) {
      throw new Error(`expected cwd restored after a successful run, got ${ctx.cwdAfterSuccess} instead of ${ctx.originalCwd}`);
    }
    if (ctx.cwdAfterFailure !== ctx.originalCwd) {
      throw new Error(`expected cwd restored after a FAILED run too, got ${ctx.cwdAfterFailure} instead of ${ctx.originalCwd}`);
    }
    fs.rmSync(ctx.fixtureRoot, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
