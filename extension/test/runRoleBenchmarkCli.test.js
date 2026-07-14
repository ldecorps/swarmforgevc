const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, reportDateKey, runRoleBenchmarkCli, main } = require('../out/tools/run-role-benchmark');

test('parseArgs rejects missing arguments', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['fixtureDir']), null);
});

test('parseArgs rejects a non-numeric repetitions or threshold', () => {
  assert.equal(parseArgs(['f', 'm.json', 'nope', '0.8', '/target']), null);
  assert.equal(parseArgs(['f', 'm.json', '2', 'nope', '/target']), null);
});

test('parseArgs rejects fewer than one repetition', () => {
  assert.equal(parseArgs(['f', 'm.json', '0', '0.8', '/target']), null);
});

test('parseArgs accepts a valid full argument set', () => {
  const args = parseArgs(['fixtureDir', 'models.json', '3', '0.8', '/target']);
  assert.deepEqual(args, { fixtureDir: 'fixtureDir', modelsFile: 'models.json', repetitions: 3, qualityThreshold: 0.8, targetPath: '/target' });
});

// ── reportDateKey ─────────────────────────────────────────────────────────

test('reportDateKey slices the ISO timestamp down to just the date', () => {
  assert.equal(reportDateKey({ generatedAtIso: '2026-07-13T10:20:30.000Z' }), '2026-07-13');
});

// ── runRoleBenchmarkCli (in-process, with fakes standing in for the
//    subprocess-spawning executor/evaluator and the real-git write/commit -
//    so main()'s own orchestration is coverage-visible, the engineering
//    article's CLI main()-thin-wrapper rule) ──────────────────────────────

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'benchmark', 'coder-task-01');

function mkScratchRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-run-role-benchmark-'));
}

test('runRoleBenchmarkCli loads the task, runs the real benchmark, then writes+commits+prints the report', async () => {
  const executorCalls = [];
  const executor = {
    async execute(prompt, cwd, model) {
      executorCalls.push({ prompt, modelId: model.id });
      return { success: true, costUsd: 0.01, tokens: { inputTokens: 10, outputTokens: 10 }, durationMs: 100 };
    },
  };
  const evaluator = { async evaluate() { return { passed: 6, total: 6 }; } };
  const writeCalls = [];
  const commitCalls = [];
  const printed = [];

  await runRoleBenchmarkCli(
    { fixtureDir: FIXTURE_DIR, modelsFile: 'unused-models-file-path', repetitions: 1, qualityThreshold: 0.5, targetPath: '/fake/target' },
    {
      loadTask: (fixtureDir) => ({ id: 'coder-task-01', fixtureDir, promptFile: 'TASK.md', testFile: 'test/wordFrequency.test.js' }),
      readModels: () => [{ id: 'a', provider: 'claude', model: 'sonnet' }],
      mkScratchRoot,
      nowIso: () => '2026-07-13T10:20:30.000Z',
      executor,
      evaluator,
      writeReport: (targetPath, report, dateIso) => {
        writeCalls.push({ targetPath, report, dateIso });
        return '/fake/target/docs/benchmarks/2026-07-13.json';
      },
      commitReport: (targetPath, filePath, taskId, dateIso) => {
        commitCalls.push({ targetPath, filePath, taskId, dateIso });
        return true;
      },
      print: (data) => printed.push(data),
    }
  );

  assert.equal(executorCalls.length, 1, 'expected the benchmark to actually run the one configured model');
  assert.equal(writeCalls.length, 1);
  assert.equal(writeCalls[0].targetPath, '/fake/target');
  assert.equal(writeCalls[0].dateIso, '2026-07-13', 'expected the date key derived from the injected nowIso');
  assert.equal(writeCalls[0].report.taskId, 'coder-task-01');
  assert.equal(commitCalls.length, 1);
  assert.equal(commitCalls[0].filePath, '/fake/target/docs/benchmarks/2026-07-13.json');
  assert.equal(commitCalls[0].taskId, 'coder-task-01');
  assert.equal(commitCalls[0].dateIso, '2026-07-13');
  assert.equal(printed.length, 1);
  assert.equal(printed[0].taskId, 'coder-task-01');
});

// ── main() (in-process, real fixture/models-file/target-repo, real
//    evaluator - only the executor's real `claude` subprocess is faked via
//    the RUN_ROLE_BENCHMARK_EXECUTOR_FORCE_RESULT env seam. This is the
//    2nd QA bounce's own explicit ask: runRoleBenchmarkCli above proves the
//    orchestration, but main() itself - argv parsing, defaultDeps() wiring,
//    the usage/exit-1 guard - was never called by any test until this one,
//    the same gap notifyDeadLettersCli.test.js's stubbed-cwd/await main()/
//    capture-stdout/restore pattern already closes elsewhere) ─────────────

function mkTargetRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-run-role-benchmark-target-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  return root;
}

const FORCE_RESULT_ENV_KEY = 'RUN_ROLE_BENCHMARK_EXECUTOR_FORCE_RESULT';

async function runMain(argv, forcedExecutorResult) {
  const previousArgv = process.argv;
  const previousForceResult = process.env[FORCE_RESULT_ENV_KEY];
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', 'run-role-benchmark.js', ...argv];
    process.env[FORCE_RESULT_ENV_KEY] = JSON.stringify(forcedExecutorResult);
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    if (previousForceResult === undefined) delete process.env[FORCE_RESULT_ENV_KEY];
    else process.env[FORCE_RESULT_ENV_KEY] = previousForceResult;
  }
  const printed = writes.join('');
  return printed ? JSON.parse(printed) : null;
}

test('main() loads the real fixture, fakes only the claude subprocess, and really writes+commits the report', async () => {
  const targetRepo = mkTargetRepo();
  const modelsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-run-role-benchmark-models-')), 'models.json');
  fs.writeFileSync(modelsFile, JSON.stringify([{ id: 'a', provider: 'claude', model: 'sonnet' }]));

  const forcedResult = { success: true, costUsd: 0.02, tokens: { inputTokens: 5, outputTokens: 5 }, durationMs: 50 };
  const report = await runMain([FIXTURE_DIR, modelsFile, '1', '0', targetRepo], forcedResult);

  assert.equal(report.taskId, 'coder-task-01-word-frequency');
  // The real evaluator ran `node --test` against the UNMODIFIED fixture
  // (the faked executor never touches the scratch copy) - deterministically 0/6.
  assert.equal(report.models[0].runs[0].testsPassed, 0);
  assert.equal(report.models[0].runs[0].testsTotal, 6);
  assert.equal(report.models[0].meanCostUsd, 0.02, 'expected the forced executor result to flow through to the report');

  const writtenFiles = execFileSync('git', ['-C', targetRepo, 'log', '--name-only', '--format=', '-1'], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(writtenFiles.length, 1, 'expected a scoped commit touching exactly one file');
  const [reportRelPath] = writtenFiles;
  assert.match(reportRelPath, /^docs\/benchmarks\/\d{4}-\d{2}-\d{2}\.json$/);
  const committedReport = JSON.parse(fs.readFileSync(path.join(targetRepo, reportRelPath), 'utf8'));
  assert.equal(committedReport.taskId, 'coder-task-01-word-frequency');
});

test('main() prints usage and exits 1 when required arguments are missing', async () => {
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    await runMain([], {});
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});
