const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { parseArgs, realAdapters, main, PROJECT_ROOT } = require('../out/tools/mutation-site-count');
const { countMutationSites } = require('../out/quality/mutationSiteCount');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'mutation-site-count.js');

// BL-234 EQUIVALENT MUTANTS (hardener, 2026-07-17, mutation-site-count.ts):
// a real Stryker run over out/tools/mutation-site-count.js still shows ~65
// survivors after the fixes below; every one of them falls into one of two
// classes that are equivalent BY DESIGN, not gaps left uncovered:
//   1. `import * as fs`/`import * as path`'s TS-emitted __importStar/
//      __createBinding/__setModuleDefault interop shim (lines 3-31 of the
//      compiled output). This is pure TypeScript compiler boilerplate,
//      identical in every file across this codebase that uses the SAME
//      `import * as x` convention (dependency-gate.ts, swarm-metrics.ts,
//      co-change-report.ts, ...) - it runs once at module load with inputs
//      (a real Node `fs`/`path` module object) that always take the exact
//      same internal branch in this runtime, so no test could ever
//      distinguish the mutated shim from the original without asserting on
//      the shim's own implementation trivia. The project's own
//      EntrypointBoilerplateIgnorer (BL-447) filters the SEPARATE
//      require.main/__esModule boilerplate class but not this one - a real
//      systemic gap, reported upstream via a rule_proposal rather than
//      chased here file-by-file.
//   2. NOOP_LOGGER's isTraceEnabled/isDebugEnabled/.../isFatalEnabled
//      (lines 87-92): mutated from `() => false` to `() => undefined`.
//      Both are falsy, and the ONLY consumer is @stryker-mutator/
//      instrumenter's own internal `if (logger.isXEnabled()) logger.x(...)`
//      truthiness gate - `false` and `undefined` are indistinguishable
//      there, so this is equivalent for the same reason a boolean vs.
//      falsy-nullish swap always is when the only reader is a truthy check.

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see its own branches (the empty-files usage/exit-1 guard, the
// report-and-print path) - the engineering article's CLI main()-thin-
// wrapper rule; mirrors queueStatusCli.test.js's own identical seam. main()
// takes no parameters - it reads process.argv and writes via
// process.stdout.write/process.stderr.write (printJsonToStdout, and main's
// own usage line) - so all three are stubbed and restored in finally.
async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const stdout = [];
  const stderr = [];
  process.stdout.write = (chunk) => {
    stdout.push(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr.push(chunk);
    return true;
  };
  process.argv = ['node', CLI_PATH, ...args];
  process.exitCode = undefined;
  let exitCode;
  try {
    await main();
    exitCode = process.exitCode;
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode };
}

// BL-485: the REAL @stryker-mutator/instrumenter wiring - never mocked,
// stubbed, or faked, per this codebase's own dependencyGateCli*.test.js
// precedent (mutationSiteCount.test.js proves the pure counting/mapping/
// threshold logic against a fake countMutantsPerFile; this file proves
// the real adapter that actually drives Stryker's instrumentation step).

function mkFixtureFile(content) {
  const dir = mkTmpDir('bl485-fixture-');
  const file = path.join(dir, 'fixture.js');
  fs.writeFileSync(file, content);
  return file;
}

// ── parseArgs (pure) ───────────────────────────────────────────────────

test('parseArgs: no --threshold flag uses the default threshold and every arg is a changed file', () => {
  assert.deepEqual(parseArgs(['a.ts', 'b.ts']), { threshold: 100, files: ['a.ts', 'b.ts'] });
});

test('parseArgs: --threshold N is extracted from anywhere among the args, remaining args are files', () => {
  assert.deepEqual(parseArgs(['--threshold', '50', 'a.ts']), { threshold: 50, files: ['a.ts'] });
  assert.deepEqual(parseArgs(['a.ts', '--threshold', '25']), { threshold: 25, files: ['a.ts'] });
});

test('parseArgs: a non-numeric --threshold value falls back to the default rather than producing NaN', () => {
  assert.deepEqual(parseArgs(['--threshold', 'oops', 'a.ts']), { threshold: 100, files: ['a.ts'] });
});

// Hardener 2026-07-17: the no-flag test above happens to pass exactly TWO
// files, and `[...argv.slice(0, flagIndex), ...argv.slice(flagIndex + 2)]`
// with flagIndex=-1 reconstructs an IDENTICAL 2-element array by accident
// (slice(0,-1) drops the last, slice(1) drops the first, concatenating back
// to the same pair) - so a mutant that skips the `flagIndex === -1` early
// return entirely still produces the exact same { threshold: 100, files }
// for that specific input, and survives. A single-file (or 3+-file) input
// does NOT round-trip through that same slice arithmetic, so it is the one
// input that actually distinguishes "took the early return" from "fell
// through to the general parse".
test('parseArgs: no --threshold flag with exactly ONE file is not accidentally reconstructed by the general-case slice arithmetic', () => {
  assert.deepEqual(parseArgs(['only.ts']), { threshold: 100, files: ['only.ts'] });
});

// ── the REAL Stryker instrumenter (mutation-site-size-gate-01/03) ───────

test('the REAL @stryker-mutator/instrumenter counts genuine mutation sites in a real fixture file, count-only', async () => {
  const file = mkFixtureFile('function add(a, b) { return a + b; }\nmodule.exports = { add };\n');

  const [result] = await countMutationSites([file], realAdapters);

  // Hardener 2026-07-17: this fixture instruments to EXACTLY 3 real mutants
  // (verified directly against @stryker-mutator/instrumenter: BlockStatement,
  // ArithmeticOperator, ObjectLiteral) - asserting the EXACT count, not just
  // `> 0`, is load-bearing: countMutantsPerFileReal's own per-mutant tally
  // (`counts[fileName] = (counts[fileName] ?? 0) + 1`) only differs from a
  // broken accumulator on the SECOND-and-later increment for the same file -
  // a `> 0` assertion is satisfied by a broken tally that resets to 1 on
  // every mutant just as much as by the correct running total.
  assert.equal(result.siteCount, 3, `expected exactly 3 real mutants, got ${result.siteCount}`);
  // count-only: the result carries no kill/pass/test-execution field.
  assert.deepEqual(Object.keys(result).sort(), ['file', 'outPath', 'siteCount']);
});

// Hardener 2026-07-17: every test above passes an ALREADY-ABSOLUTE fixture
// path straight through as if it were the mapped out/ path, so
// realAdapters.readOutFile's `path.isAbsolute(outPath) ? outPath :
// path.join(PROJECT_ROOT, outPath)` branch only ever takes the isAbsolute
// arm - the relative/PROJECT_ROOT-join arm (this tool's OWN documented
// "repo-root-relative" input contract - see mutation-site-count.ts's own
// usage docstring) was never exercised at all. Anchor the fixture to the
// EXPORTED PROJECT_ROOT rather than a hardcoded real repo file: PROJECT_ROOT
// resolves differently between a real checkout (repo root, containing
// extension/) and a Stryker mutation sandbox of this very file (whose
// sandbox root corresponds to extension/ itself) - a relative path hardcoded
// against the real checkout's layout (e.g. 'extension/src/tools/foo.ts')
// silently resolves to a non-existent path and reports 0 mutants under the
// sandbox, exactly the kind of environment-coupled test the project's
// shared-global rules warn about. Writing under PROJECT_ROOT itself makes
// the fixture correct in both environments without knowing which one it is.
test('main()/realAdapters resolves a relative path by joining PROJECT_ROOT, matching the documented CLI usage contract', async () => {
  const relDir = path.join('extension', 'tmp', 'bl485-relative-probe');
  const relFile = path.join(relDir, 'fixture.js');
  const absDir = path.join(PROJECT_ROOT, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  fs.writeFileSync(path.join(PROJECT_ROOT, relFile), 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n');
  try {
    const [result] = await countMutationSites([relFile], realAdapters);

    assert.equal(result.outPath, relFile);
    assert.ok(result.siteCount > 0, `expected the real fixture file to instrument to at least one mutant, got ${result.siteCount}`);
  } finally {
    fs.rmSync(absDir, { recursive: true, force: true });
  }
});

// Hardener 2026-07-17: the fixture-write test above derives BOTH sides of
// its comparison from the SAME exported PROJECT_ROOT value, so it is
// tautological against a mutated PROJECT_ROOT - if a '..' segment is
// dropped, the write and the read still agree with each other (they both
// move to the same wrong place together), and the mutant survives even
// though PROJECT_ROOT no longer points where it should. Verify PROJECT_ROOT
// against an INDEPENDENT computation instead: this test file's own
// __dirname sits at the SAME directory depth under the project root as
// mutation-site-count.ts's out/tools/ location (extension/test/ vs
// extension/out/tools/ - both two segments below extension/), so
// `path.join(__dirname, '..', '..')` computed here, from an entirely
// different (unmutated) file, must land on the identical directory -  in a
// real checkout AND inside a Stryker sandbox of mutation-site-count.js
// alike, since neither computation's OWN nesting depth is affected by a
// mutation confined to the other file.
test('PROJECT_ROOT resolves to the actual project root, verified independently of its own (possibly mutated) export', () => {
  const independentlyComputedRoot = path.join(__dirname, '..', '..');

  assert.equal(PROJECT_ROOT, independentlyComputedRoot);
});

// ── entrypoint-boilerplate parity with the real gate (BL-447) ───────────

test('the REAL instrumenter excludes entrypoint-boilerplate mutants, matching what the real hardener gate would count', async () => {
  const withBoilerplate = mkFixtureFile(
    [
      'Object.defineProperty(exports, "__esModule", { value: true });',
      'function main() { return 1; }',
      'if (require.main === module) { main(); }',
    ].join('\n') + '\n'
  );
  const bareEquivalent = mkFixtureFile('function main() { return 1; }\n');

  const [withBoilerplateResult] = await countMutationSites([withBoilerplate], realAdapters);
  const [bareResult] = await countMutationSites([bareEquivalent], realAdapters);

  assert.equal(
    withBoilerplateResult.siteCount,
    bareResult.siteCount,
    'expected the __esModule/require.main boilerplate to contribute zero extra sites over the bare equivalent'
  );
});

// ── main() in-process (CLI wiring) ──────────────────────────────────────

test('main() with no file args prints usage to stderr and sets a non-zero exit code, without printing a report', async () => {
  const { stdout, stderr, exitCode } = await runCli([]);

  assert.equal(stdout, '');
  assert.match(stderr, /Usage: mutation-site-count\.js/);
  assert.equal(exitCode, 1);
});

test('main() with a real file arg prints the JSON report (threshold + per-file verdict) to stdout', async () => {
  const file = mkFixtureFile('function add(a, b) { return a + b; }\nmodule.exports = { add };\n');

  const { stdout, stderr, exitCode } = await runCli(['--threshold', '1', file]);

  assert.equal(stderr, '');
  assert.equal(exitCode, undefined);
  const report = JSON.parse(stdout);
  assert.equal(report.threshold, 1);
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].file, file);
  assert.ok(report.files[0].siteCount >= 1);
  assert.equal(report.files[0].verdict, report.files[0].siteCount > 1 ? 'over' : 'within');
});
