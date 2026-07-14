const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, reportDateKey, runRoleBenchmarkCli } = require('../out/tools/run-role-benchmark');

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
