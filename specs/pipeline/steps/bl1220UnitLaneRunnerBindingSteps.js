'use strict';

// BL-1220: step handlers for "main-lane test files declare their tests to the
// runner that actually runs them". Drives the testable surfaces - the lane's
// own guard helper and a real Vitest run of one repaired file - not a hand
// assertion about what the tree looks like.
//
// Every occurrence of the literal string below sits inside a quoted fixture,
// which is data, not a declaration: the guard anchors on the import FORM at
// the start of a line, so this file is not a violation of the rule it checks.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const TEST_DIR = path.join(EXT_DIR, 'test');
const FIXTURE_PREFIX = 'bl1220-acceptance-';

// The file the ticket names as the worked example of the defect.
const WORKED_EXAMPLE = 'crossFileDuplicationCheck.test.js';

function guardModule() {
  return require(path.join(TEST_DIR, 'helpers', 'nodeTestImportGuard.js'));
}

// BL-971: a killed earlier run traps nothing, so sweep by prefix up front as
// well as removing this run's own fixtures on the way out.
function sweepStaleFixtures() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  }
}

const liveFixtures = new Set();
let exitHookInstalled = false;

function makeFixtureDir() {
  sweepStaleFixtures();
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const dir of [...liveFixtures]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort on the way out */
        }
      }
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  liveFixtures.add(dir);
  return dir;
}

/** Run the unit lane over the given files and return Vitest's JSON report. */
function runUnitLane(files) {
  const reportPath = path.join(makeFixtureDir(), 'report.json');
  try {
    execFileSync(
      path.join(EXT_DIR, 'node_modules', '.bin', 'vitest'),
      ['run', ...files, '--reporter=json', `--outputFile=${reportPath}`],
      { cwd: EXT_DIR, stdio: 'ignore' }
    );
  } catch {
    // A file may legitimately have failing tests (BL-1221's separate defect is
    // live in this set); the scenarios ask about COLLECTION, which the report
    // records either way.
  }
  if (!fs.existsSync(reportPath)) {
    throw new Error(`the unit lane produced no report for ${files.join(', ')}`);
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function collectedCounts(report) {
  const counts = {};
  for (const file of report.testResults || []) {
    counts[path.basename(file.name)] = (file.assertionResults || []).length;
  }
  return counts;
}

/** Every file the unit lane collects, i.e. the repaired set plus the rest. */
function unitLaneFiles() {
  const { isUnitLaneTestFile } = guardModule();
  return fs
    .readdirSync(TEST_DIR)
    .filter((name) => isUnitLaneTestFile(name))
    .map((name) => path.join('test', name));
}

const FEATURE_NAME = 'main-lane test files declare their tests to the runner that actually runs them';

function registerSteps(registry) {
  // BL-425 scoping: several of the step texts below are generic enough
  // that another ticket's feature legitimately uses the same words for
  // unrelated behaviour, and an unscoped registration resolves
  // first-match across every handler file - so an unscoped one here can
  // answer another feature's scenario with this ticket's context.
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);
  // ── uncollected-file-now-runs-01 ────────────────────────────────────
  scoped(
    /^a main-lane test file that declared its tests by importing "test" from "node:test"$/,
    (ctx) => {
      const target = path.join(TEST_DIR, WORKED_EXAMPLE);
      if (!fs.existsSync(target)) {
        throw new Error(`the worked example ${WORKED_EXAMPLE} is gone; the scenario names a file that must exist`);
      }
      // It carried the import at mint; what matters now is that it no longer
      // does, which is what makes the lane able to collect it at all.
      const { findNodeTestImportLines } = guardModule();
      const lines = findNodeTestImportLines(fs.readFileSync(target, 'utf8'));
      if (lines.length > 0) {
        throw new Error(`${WORKED_EXAMPLE} still declares its tests to node:test at line ${lines[0]}`);
      }
      ctx.bl1220Files = [path.join('test', WORKED_EXAMPLE)];
    }
  );

  scoped(/^the unit lane runs that file$/, (ctx) => {
    ctx.bl1220Report = runUnitLane(ctx.bl1220Files);
    ctx.bl1220Counts = collectedCounts(ctx.bl1220Report);
  });

  scoped(/^the file reports at least one collected test$/, (ctx) => {
    const [name] = Object.keys(ctx.bl1220Counts);
    if (!name || ctx.bl1220Counts[name] < 1) {
      throw new Error(`the lane collected no tests from ${ctx.bl1220Files.join(', ')}`);
    }
  });

  scoped(/^the file does not report "No test suite found"$/, (ctx) => {
    const messages = (ctx.bl1220Report.testResults || []).map((f) => f.message || '').join('\n');
    if (/No test suite found/.test(messages)) {
      throw new Error(`the lane still found no test suite:\n${messages}`);
    }
  });

  // ── no-main-lane-file-collects-zero-02 ──────────────────────────────
  scoped(/^the unit lane runs every file in the repaired set$/, (ctx) => {
    ctx.bl1220Files = unitLaneFiles();
    ctx.bl1220Report = runUnitLane(ctx.bl1220Files);
    ctx.bl1220Counts = collectedCounts(ctx.bl1220Report);
  });

  scoped(/^every one of them reports at least one collected test$/, (ctx) => {
    const empty = Object.entries(ctx.bl1220Counts)
      .filter(([, count]) => count === 0)
      .map(([name]) => name);
    if (empty.length > 0) {
      throw new Error(`these lane files collected zero tests: ${empty.join(', ')}`);
    }
    const missing = ctx.bl1220Files.filter((file) => !(path.basename(file) in ctx.bl1220Counts));
    if (missing.length > 0) {
      throw new Error(`these lane files produced no report at all: ${missing.join(', ')}`);
    }
  });

  // ── guard-rejects-reintroduced-import-03 / guard-ignores-property-lane-04 ──
  scoped(/^a main-lane test file that imports "test" from "node:test"$/, (ctx) => {
    ctx.bl1220GuardDir = makeFixtureDir();
    ctx.bl1220Offender = path.join(ctx.bl1220GuardDir, 'reintroduced.test.js');
    fs.writeFileSync(ctx.bl1220Offender, "const { test } = require('node:test');\ntest('x', () => {});\n");
  });

  scoped(/^a property-lane test file that imports "test" from "node:test"$/, (ctx) => {
    ctx.bl1220GuardDir = makeFixtureDir();
    fs.writeFileSync(
      path.join(ctx.bl1220GuardDir, 'outOfLane.property.test.js'),
      "const { test } = require('node:test');\ntest('x', () => {});\n"
    );
  });

  scoped(/^the unit-lane import guard runs$/, (ctx) => {
    ctx.bl1220Violations = guardModule().findUnitLaneNodeTestImports(ctx.bl1220GuardDir);
  });

  scoped(/^the guard fails and names that file$/, (ctx) => {
    if (ctx.bl1220Violations.length === 0) {
      throw new Error('the guard passed a file that reintroduced the import');
    }
    if (!ctx.bl1220Violations.some((v) => v.file === ctx.bl1220Offender)) {
      throw new Error(
        `the guard failed without naming the offending file; it named: ${ctx.bl1220Violations
          .map((v) => v.file)
          .join(', ')}`
      );
    }
  });

  scoped(/^the guard passes$/, (ctx) => {
    if (ctx.bl1220Violations.length > 0) {
      throw new Error(
        `the guard reached outside its lane: ${ctx.bl1220Violations.map((v) => v.file).join(', ')}`
      );
    }
  });
}

module.exports = { registerSteps };
