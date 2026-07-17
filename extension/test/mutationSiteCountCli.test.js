const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { parseArgs, realAdapters, main } = require('../out/tools/mutation-site-count');
const { countMutationSites } = require('../out/quality/mutationSiteCount');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'mutation-site-count.js');

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

// ── the REAL Stryker instrumenter (mutation-site-size-gate-01/03) ───────

test('the REAL @stryker-mutator/instrumenter counts genuine mutation sites in a real fixture file, count-only', async () => {
  const file = mkFixtureFile('function add(a, b) { return a + b; }\nmodule.exports = { add };\n');

  const [result] = await countMutationSites([file], realAdapters);

  assert.ok(result.siteCount > 0, `expected at least one real mutant, got ${result.siteCount}`);
  // count-only: the result carries no kill/pass/test-execution field.
  assert.deepEqual(Object.keys(result).sort(), ['file', 'outPath', 'siteCount']);
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
