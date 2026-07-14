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

// ── main() (BL-340 QA re-bounce: main() itself, not just runRoleBenchmarkCli,
//    must be called in-process by a test - engineering.prompt's CLI
//    main()-thin-wrapper rule). Real evaluator, real write, real git commit;
//    only the genuinely external model-executor boundary is faked, via the
//    RUN_ROLE_BENCHMARK_EXECUTOR_FORCE_RESULT env seam (mirrors
//    notify-dead-letters.ts's own TELEGRAM_NOTIFY_FORCE_RESULT convention
//    exactly - see notifyDeadLettersCli.test.js's identical
//    argv/env/capture-stdout/restore-in-finally shape) ─────────────────────

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function mkTargetRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-run-role-benchmark-target-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

function mkModelsFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-run-role-benchmark-models-'));
  const file = path.join(dir, 'models.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'model-a', provider: 'claude', model: 'fake-model', label: 'Fake' }]));
  return file;
}

const MAIN_ARGV_PREFIX = ['node', 'run-role-benchmark.js'];

async function runMain(args, forcedExecutorResult) {
  const previousArgv = process.argv;
  const previousEnv = process.env.RUN_ROLE_BENCHMARK_EXECUTOR_FORCE_RESULT;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = [...MAIN_ARGV_PREFIX, ...args];
    process.env.RUN_ROLE_BENCHMARK_EXECUTOR_FORCE_RESULT = JSON.stringify(forcedExecutorResult);
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    if (previousEnv === undefined) delete process.env.RUN_ROLE_BENCHMARK_EXECUTOR_FORCE_RESULT;
    else process.env.RUN_ROLE_BENCHMARK_EXECUTOR_FORCE_RESULT = previousEnv;
  }
  return writes.join('');
}

test('BL-340: main() runs end-to-end in-process - loads the fixture, runs the real benchmark orchestration with a faked executor, writes+commits+prints the real report', async () => {
  const targetRepo = mkTargetRepo();
  const modelsFile = mkModelsFile();

  const stdout = await runMain(
    [FIXTURE_DIR, modelsFile, '1', '0.5', targetRepo],
    { success: true, costUsd: 0.01, tokens: { inputTokens: 10, outputTokens: 10 }, durationMs: 100 }
  );

  const printed = JSON.parse(stdout);
  assert.equal(printed.taskId, 'coder-task-01-word-frequency');
  assert.equal(printed.models.length, 1);
  assert.equal(printed.models[0].modelId, 'model-a');
  // The REAL node:test evaluator ran against the REAL (unmodified) starting
  // stub - main()'s own orchestration is what's under test here, not model
  // quality, so a real "fails because nothing solved it" result IS the
  // proof that the real evaluator (not a mock) actually ran.
  assert.equal(printed.models[0].runs[0].testsTotal, 6);
  assert.equal(printed.models[0].runs[0].testsPassed, 0);

  const dateIso = reportDateKey({ generatedAtIso: printed.generatedAtIso });
  const reportPath = path.join(targetRepo, 'docs', 'benchmarks', `${dateIso}.json`);
  assert.ok(fs.existsSync(reportPath), 'expected the report to be written as a real file');
  const onDisk = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.deepEqual(onDisk, printed, 'expected the printed report to match what was actually written to disk');

  const log = git(targetRepo, ['log', '--oneline', '--', reportPath]);
  assert.equal(log.trim().split('\n').filter(Boolean).length, 1, 'expected exactly one real git commit touching the report file');
});

test('BL-340: main() prints usage and exits nonzero when required args are missing', async () => {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = [...MAIN_ARGV_PREFIX];
    process.exitCode = undefined;
    await main();
    assert.equal(process.exitCode, 1);
    assert.match(writes.join(''), /Usage: run-role-benchmark\.js/);
  } finally {
    process.stderr.write = originalErrWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
});
